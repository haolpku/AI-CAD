import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const benchmarkDir = path.join(projectDir, "benchmarks", "full-quantity-v0");
const outputDir = path.join(projectDir, "outputs", "full-quantity-v0");
const publicDir = path.join(projectDir, "preprocessing", "v1-3");
const requirements = JSON.parse(await fs.readFile(path.join(benchmarkDir, "data-requirements-v1-3.json"), "utf8"));
const catalog = JSON.parse(await fs.readFile(path.join(benchmarkDir, "targets.json"), "utf8"));
const ir = JSON.parse(await fs.readFile(path.join(projectDir, "preprocessing", "v1-2", "manifest.json"), "utf8"));
const hybrid = JSON.parse(await fs.readFile(path.join(outputDir, "hybrid-evidence-v1-2.json"), "utf8"));
const segments = JSON.parse(await fs.readFile(path.join(outputDir, "route-segments-v1-1.json"), "utf8"));
const schema = JSON.parse(await fs.readFile(path.join(projectDir, "experience-base", "relationship-schema-v1.json"), "utf8"));
const targetById = new Map(catalog.targets.map((target) => [target.id, target]));
const weight = schema.statusWeights;
const drawingFor = (discipline) => discipline === "plumbing-heating" ? ["plumbing-cad", "hvac-cad"] : ["electrical-cad"];
const parsedDrawing = new Set(ir.drawings.filter((drawing) => drawing.parseStatus === "complete").map((drawing) => drawing.id));
const hybridByDrawing = new Map(hybrid.drawings.map((drawing) => [drawing.id, drawing]));
const segmentDrawings = new Set(segments.drawings.map((drawing) => drawing.id));
const sourceRow = (target) => Number(String(target.sourceCell).match(/\d+$/)?.[0]);
const sameRowCoreLength = (target) => catalog.targets.some((candidate) =>
  candidate.role === "core" && candidate.unit === "m" && candidate.sheet === target.sheet && sourceRow(candidate) === sourceRow(target));
const contextCoreLength = (target) => catalog.targets.some((candidate) =>
  candidate.role === "core" && candidate.unit === "m" && candidate.discipline === target.discipline
  && candidate.context.join("|") === target.context.join("|"));
const dependencyIds = (target) => catalog.targets.filter((candidate) => {
  if (candidate.role !== "core" || candidate.unit !== "m" || candidate.discipline !== target.discipline) return false;
  if (candidate.sheet === target.sheet && sourceRow(candidate) === sourceRow(target)) return true;
  return ["insulation-volume", "protective-area"].includes(requirements.targets.find((item) => item.id === target.id)?.targetType)
    && candidate.context.join("|") === target.context.join("|");
}).map((candidate) => candidate.id);
const hasNumericStandard = (target) => /DN\s*\d+|[-–]\s*\d+(?:\.\d+)?\s*$|\d+[*xX]\d+/i.test(target.item);
const status = (value, reason, evidence = []) => ({ status: value, reason, evidence });

const resolveVariable = (variable, requirement) => {
  const target = targetById.get(requirement.id);
  const drawings = drawingFor(target.discipline);
  const drawingAvailable = drawings.some((drawing) => parsedDrawing.has(drawing));
  const drawingEvidence = drawings.filter((drawing) => parsedDrawing.has(drawing)).map((drawing) => `drawing:${drawing}`);
  const titleCount = drawings.reduce((sum, drawing) => sum + (hybridByDrawing.get(drawing)?.titleCount ?? 0), 0);
  const blockCount = drawings.reduce((sum, drawing) => sum + (hybridByDrawing.get(drawing)?.blocks?.length ?? 0), 0);
  const routeCount = drawings.reduce((sum, drawing) => sum + (hybridByDrawing.get(drawing)?.routes?.length ?? 0), 0);
  const hasSegments = drawings.some((drawing) => segmentDrawings.has(drawing));
  const availableFormula = new Set(["surface-area-formula", "insulation-volume-formula", "protective-area-formula", "audit-sum-formula"]);
  if (variable === "discipline-drawing") return status(drawingAvailable ? "available" : "missing", drawingAvailable ? "discipline CAD parsed" : "discipline CAD unavailable", drawingEvidence);
  if (variable === "plan-frame") return status(titleCount ? "partial" : "missing", titleCount ? "title anchors exist but frame boundaries are not authoritative" : "no plan/frame evidence", ["evidence:title-candidates"]);
  if (variable === "floor") return status("partial", "floor vocabulary exists but entity-to-floor assignment is not authoritative", ["evidence:floor-vocabulary"]);
  if (variable === "semantic-block-instance") return status(blockCount ? "available" : "missing", `${blockCount} recursive block evidence groups`, ["evidence:recursive-blocks"]);
  if (variable === "stable-occurrence-id") return status("available", "v1.2 occurrence IDs have zero observed collisions", ["evidence:project-ir-v1.2"]);
  if (variable === "countability-gate") return status("partial", "plan/system/legend proximity is available; bound-reference and cross-view rejection remain incomplete", ["evidence:sheet-role-candidates"]);
  if (["horizontal-route", "route-topology"].includes(variable)) return status(routeCount ? "available" : "missing", routeCount ? `${routeCount} route groups with topology summaries` : "no route geometry", ["evidence:hybrid-routes-v1"]);
  if (variable === "system") return status(hasSegments && target.discipline === "plumbing-heating" ? "partial" : "partial", "system labels exist but are not bound to every entity", ["evidence:route-labels"]);
  if (variable === "diameter") return status(hasNumericStandard(target) ? "partial" : "missing", hasNumericStandard(target) ? "target standard is parsed; geometry binding remains partial" : "diameter not resolved", ["evidence:target-standard", ...(hasSegments ? ["evidence:dn-segments-v1.1"] : [])]);
  if (["conduit-standard", "conductor-standard", "grounding-route-type"].includes(variable)) return status("partial", "target standard/type is known but route binding is incomplete", ["evidence:target-catalog"]);
  if (variable === "junction-or-fitting-instance") return status(blockCount ? "partial" : "missing", "candidate inserts exist; topology-to-fitting classification is incomplete", ["evidence:recursive-blocks"]);
  if (variable === "base-length-dependency") {
    const found = sameRowCoreLength(target) || contextCoreLength(target);
    return status(found ? "partial" : "missing", found ? "base length target can be linked, but its predicted value may be incomplete" : "no base length dependency resolved", ["evidence:target-dependency"]);
  }
  if (variable === "surface-selection") return status(/内表面积|外表面积/.test(target.measurement) ? "available" : "missing", "surface type comes from target measurement", ["evidence:target-catalog"]);
  if (availableFormula.has(variable)) return status("available", "versioned deterministic formula is implemented", ["experience:formula-v1"]);
  if (variable === "material-outside-diameter") return status(hasNumericStandard(target) ? "partial" : "missing", "nominal diameter can be parsed; material-specific outside diameter table is incomplete", ["experience:outside-diameter-map"]);
  if (variable === "insulation-thickness") return status(/[-–]\s*\d+(?:\.\d+)?\s*$/.test(target.item) ? "partial" : "missing", "thickness-like token may be parsed but semantic binding needs validation", ["evidence:target-standard"]);
  if (variable === "component-targets") return status("available", "component targets share the frozen public catalog", ["evidence:target-catalog"]);
  if (["source-device", "terminal-device"].includes(variable)) return status(blockCount ? "partial" : "missing", "device candidates exist but circuit endpoint binding is missing", ["evidence:recursive-blocks"]);
  if (variable === "circuit-number") return status("partial", "circuit-like annotations exist but are not organized into a circuit graph", ["evidence:cad-text"]);
  if (variable === "room") return status("missing", "architecture drawing is unavailable and room containment is not built");
  if (["circuit-route", "bridge-assignment", "vertical-length", "entry-length", "reserved-length", "conductor-multiplicity", "riser-link", "floor-height", "standard-floor-multiplier", "attachment-rule", "termination-policy", "additional-length"].includes(variable)) {
    return status("missing", `${variable} is not yet modeled`);
  }
  return status("missing", `${variable} has no registered evidence provider`);
};

const nodes = [];
const edges = [];
const nodeIds = new Set();
const addNode = (node) => { if (!nodeIds.has(node.id)) { nodeIds.add(node.id); nodes.push(node); } };
for (const drawing of ir.drawings) addNode({ id: `drawing:${drawing.id}`, type: "drawing", parseStatus: drawing.parseStatus });
const contexts = requirements.targets.map((requirement) => {
  addNode({ id: `target:${requirement.id}`, type: "target", targetType: requirement.targetType, discipline: requirement.discipline, role: requirement.role });
  addNode({ id: `formula:${requirement.formula}`, type: "formula" });
  edges.push({ type: "computed-by", source: `target:${requirement.id}`, target: `formula:${requirement.formula}` });
  for (const dependencyId of dependencyIds(targetById.get(requirement.id))) {
    edges.push({ type: "derived-from", source: `target:${requirement.id}`, target: `target:${dependencyId}` });
  }
  const required = requirement.required.map((variable) => {
    const resolved = resolveVariable(variable, requirement);
    addNode({ id: `variable:${variable}`, type: "variable" });
    edges.push({ type: "requires", source: `target:${requirement.id}`, target: `variable:${variable}`, status: resolved.status });
    for (const evidence of resolved.evidence) {
      addNode({ id: evidence, type: evidence.startsWith("drawing:") ? "drawing" : evidence.startsWith("experience:") ? "experience" : "evidence" });
      edges.push({ type: "supported-by", source: `variable:${variable}`, target: evidence });
    }
    return { variable, ...resolved };
  });
  const optional = requirement.optional.map((variable) => {
    const resolved = resolveVariable(variable, requirement);
    addNode({ id: `variable:${variable}`, type: "variable" });
    edges.push({ type: "optional", source: `target:${requirement.id}`, target: `variable:${variable}`, status: resolved.status });
    return { variable, ...resolved };
  });
  for (const negative of requirement.negativeEvidence) {
    addNode({ id: `negative:${negative}`, type: "evidence" });
    edges.push({ type: "rejects", source: `target:${requirement.id}`, target: `negative:${negative}` });
  }
  const requiredScore = required.length ? required.reduce((sum, item) => sum + weight[item.status], 0) / required.length : 1;
  const optionalScore = optional.length ? optional.reduce((sum, item) => sum + weight[item.status], 0) / optional.length : 1;
  return {
    id: requirement.id,
    role: requirement.role,
    discipline: requirement.discipline,
    targetType: requirement.targetType,
    formula: requirement.formula,
    contextCompleteness: Number(requiredScore.toFixed(6)),
    optionalCompleteness: Number(optionalScore.toFixed(6)),
    required,
    optional,
    missingCritical: required.filter((item) => item.status === "missing").map((item) => item.variable),
    retrievalPlan: [...new Set(required.flatMap((item) => item.evidence))],
  };
});

const scoredContexts = contexts.filter((context) => context.role !== "audit");
const typeSummary = Object.values(scoredContexts.reduce((result, context) => {
  const item = result[context.targetType] ?? { targetType: context.targetType, targetCount: 0, completenessTotal: 0, missingCritical: {} };
  item.targetCount += 1;
  item.completenessTotal += context.contextCompleteness;
  for (const variable of context.missingCritical) item.missingCritical[variable] = (item.missingCritical[variable] ?? 0) + 1;
  result[context.targetType] = item;
  return result;
}, {})).map((item) => ({
  targetType: item.targetType,
  targetCount: item.targetCount,
  meanContextCompleteness: Number((item.completenessTotal / item.targetCount).toFixed(6)),
  topMissingCritical: Object.entries(item.missingCritical).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([variable, count]) => ({ variable, count })),
})).sort((left, right) => right.targetCount - left.targetCount);
const missingCounts = scoredContexts.flatMap((context) => context.missingCritical).reduce((result, variable) => {
  result[variable] = (result[variable] ?? 0) + 1;
  return result;
}, {});
const summary = {
  scoredTargetCount: scoredContexts.length,
  meanContextCompleteness: Number((scoredContexts.reduce((sum, context) => sum + context.contextCompleteness, 0) / scoredContexts.length).toFixed(6)),
  targetsWithAllRequiredAvailable: scoredContexts.filter((context) => context.required.every((item) => item.status === "available")).length,
  targetsWithPartialOrMissing: scoredContexts.filter((context) => context.required.some((item) => item.status !== "available")).length,
  targetsWithNoCriticalMissing: scoredContexts.filter((context) => context.missingCritical.length === 0).length,
  targetsWithCriticalMissing: scoredContexts.filter((context) => context.missingCritical.length > 0).length,
  graphNodeCount: nodes.length,
  graphEdgeCount: edges.length,
  topMissingCritical: Object.entries(missingCounts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([variable, count]) => ({ variable, count })),
  byTargetType: typeSummary,
};
const registry = {
  protocol: { benchmarkId: "full-quantity-v0", version: "evidence-registry-v1.3", truthAccess: "forbidden", containsQuantityValues: false },
  summary,
  graph: { schemaVersion: schema.version, nodes, edges },
  targetContexts: contexts,
};
await fs.writeFile(path.join(outputDir, "evidence-registry-v1-3.json"), `${JSON.stringify(registry, null, 2)}\n`);
await fs.mkdir(publicDir, { recursive: true });
await fs.writeFile(path.join(publicDir, "manifest.json"), `${JSON.stringify({
  protocol: registry.protocol,
  summary,
  statusMeaning: {
    available: "evidence provider exists and is structurally usable",
    partial: "some evidence exists but binding/coverage is incomplete",
    missing: "no current evidence provider",
  },
}, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
