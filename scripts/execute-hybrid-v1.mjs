import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(projectDir, "outputs", "full-quantity-v0", "predictions");
const benchmarkDir = path.join(projectDir, "benchmarks", "full-quantity-v0");
const catalog = JSON.parse(await fs.readFile(path.join(benchmarkDir, "targets.json"), "utf8"));
const evidenceArg = process.argv.find((value) => value.startsWith("--evidence="))?.slice("--evidence=".length)
  ?? "outputs/full-quantity-v0/hybrid-evidence-v1.json";
const evidence = JSON.parse(await fs.readFile(path.resolve(projectDir, evidenceArg), "utf8"));
const registryArg = process.argv.find((value) => value.startsWith("--registry="))?.slice("--registry=".length);
const registry = registryArg ? JSON.parse(await fs.readFile(path.resolve(projectDir, registryArg), "utf8")) : null;
const contextByTarget = new Map((registry?.targetContexts ?? []).map((context) => [context.id, context]));
const baseArg = process.argv.find((value) => value.startsWith("--base="))?.slice("--base=".length)
  ?? "outputs/full-quantity-v0/predictions/gpt-5.6-sol--closed_world--full.json";
const mappingArgs = process.argv.filter((value) => value.startsWith("--mapping=")).map((value) => value.slice("--mapping=".length));
const segmentedEvidenceArg = process.argv.find((value) => value.startsWith("--segmented-evidence="))?.slice("--segmented-evidence=".length);
const threshold = Number(process.argv.find((value) => value.startsWith("--threshold="))?.slice("--threshold=".length) ?? 0.75);
const contextThreshold = Number(process.argv.find((value) => value.startsWith("--context-threshold="))?.slice("--context-threshold=".length) ?? 0.6);
const applyDerived = !process.argv.includes("--no-derived");
const tag = process.argv.find((value) => value.startsWith("--tag="))?.slice("--tag=".length) ?? "hybrid-v1";
if (!mappingArgs.length) throw new Error("Pass one or more --mapping=path arguments.");
if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("threshold must be between 0 and 1.");

const base = JSON.parse(await fs.readFile(path.resolve(projectDir, baseArg), "utf8"));
const mappingDocuments = await Promise.all(mappingArgs.map(async (mappingPath) =>
  JSON.parse(await fs.readFile(path.resolve(projectDir, mappingPath), "utf8"))));
if (mappingDocuments.some((document) => document.protocol?.truthAccess !== "forbidden")) {
  throw new Error("Every semantic mapping must declare truthAccess=forbidden.");
}
const targetHash = (await fs.readFile(path.join(benchmarkDir, "targets.sha256"), "utf8")).split(/\s+/)[0];
if (base.protocol?.targetHash !== targetHash) throw new Error("Base prediction target hash does not match.");
const targetMap = new Map(catalog.targets.map((target) => [target.id, target]));
const evidenceMap = new Map(evidence.drawings.flatMap((drawing) => [
  ...drawing.blocks.map((item) => [item.id, { type: "block", drawing: drawing.id, ...item }]),
  ...drawing.routes.map((item) => [item.id, { type: "route", drawing: drawing.id, ...item }]),
]));
if (segmentedEvidenceArg) {
  const segmentedEvidence = JSON.parse(await fs.readFile(path.resolve(projectDir, segmentedEvidenceArg), "utf8"));
  if (segmentedEvidence.protocol?.truthAccess !== "forbidden") throw new Error("Segmented evidence must declare truthAccess=forbidden.");
  for (const item of segmentedEvidence.drawings.flatMap((drawing) => drawing.segments)) {
    evidenceMap.set(item.id, { type: "route-segment", ...item });
  }
}
const predictionMap = new Map((base.predictions ?? []).map((prediction) => [prediction.id, { ...prediction }]));
const decisions = [];
const allEligibleMappings = mappingDocuments.flatMap((document) => document.mappings ?? []).filter((mapping) =>
  targetMap.has(mapping.id)
  && mapping.confidence >= threshold
  && ["block", "route", "route-segment"].includes(mapping.evidenceType)
  && (!registry || ((contextByTarget.get(mapping.id)?.missingCritical?.length ?? 1) === 0
    && Number(contextByTarget.get(mapping.id)?.contextCompleteness ?? 0) >= contextThreshold)));
const mappingPriority = { block: 1, route: 1, "route-segment": 2 };
const eligibleByTarget = new Map();
for (const mapping of allEligibleMappings) {
  const current = eligibleByTarget.get(mapping.id);
  if (!current || mappingPriority[mapping.evidenceType] > mappingPriority[current.evidenceType]) eligibleByTarget.set(mapping.id, mapping);
}
const eligibleMappings = [...eligibleByTarget.values()];
const routeUseCount = new Map();
for (const mapping of eligibleMappings.filter((item) => item.evidenceType.startsWith("route"))) {
  for (const evidenceId of new Set(mapping.evidenceIds ?? [])) routeUseCount.set(evidenceId, (routeUseCount.get(evidenceId) ?? 0) + 1);
}
for (const mapping of eligibleMappings) {
  const target = targetMap.get(mapping.id);
  if (mapping.evidenceType.startsWith("route") && (mapping.evidenceIds ?? []).some((id) => routeUseCount.get(id) > 1)) {
    decisions.push({ id: mapping.id, stage: "rejected-shared-route", confidence: mapping.confidence, evidenceIds: mapping.evidenceIds });
    continue;
  }
  const selected = [...new Set(mapping.evidenceIds ?? [])].map((id) => evidenceMap.get(id)).filter(Boolean);
  if (!selected.length || selected.some((item) => item.type !== mapping.evidenceType)) continue;
  const rawValue = mapping.evidenceType === "block"
    ? selected.reduce((sum, item) => sum + item.planCount, 0)
    : mapping.evidenceType === "route-segment"
      ? selected.reduce((sum, item) => sum + item.lengthM, 0)
      : selected.reduce((sum, item) => sum + item.planLengthM, 0);
  const value = target.unit === "个" ? Math.round(rawValue) : Number(rawValue.toFixed(3));
  if (!Number.isFinite(value) || value < 0) continue;
  const previous = predictionMap.get(mapping.id);
  predictionMap.set(mapping.id, {
    id: mapping.id,
    value,
    confidence: mapping.confidence,
    basis: `deterministic ${mapping.evidenceType} sum: ${mapping.evidenceIds.join(",")}`,
  });
  decisions.push({ id: mapping.id, stage: "semantic-evidence", previous: previous?.value ?? null, value, confidence: mapping.confidence, evidenceIds: mapping.evidenceIds });
}

const sourceRow = (target) => Number(String(target.sourceCell).match(/\d+$/)?.[0]);
const diameterMm = (item) => {
  const explicit = String(item).match(/DN\s*(\d+(?:\.\d+)?)/i);
  if (explicit) return Number(explicit[1]);
  const trailing = String(item).match(/[-–](\d+(?:\.\d+)?)\s*$/);
  return trailing ? Number(trailing[1]) : null;
};
const outsideDiameterMm = (nominal, item) => {
  if (!Number.isFinite(nominal)) return null;
  if (/塑|聚乙烯|PVC|PE/i.test(item)) return nominal;
  const steel = new Map([[15, 21.3], [20, 26.9], [25, 33.7], [32, 42.4], [40, 48.3], [50, 60.3], [65, 76.1], [70, 76.1], [75, 88.9], [80, 88.9], [100, 114.3], [125, 139.7], [150, 168.3], [200, 219.1]]);
  return steel.get(nominal) ?? nominal;
};
const contextKey = (target) => `${target.discipline}|${target.context.join("|")}`;
const corePipeTargets = catalog.targets.filter((target) =>
  target.role === "core" && target.unit === "m" && target.sheet === "给排水管道系统汇总表");
const sameRowLength = (target) => catalog.targets.find((candidate) =>
  candidate.sheet === target.sheet
  && candidate.discipline === target.discipline
  && sourceRow(candidate) === sourceRow(target)
  && candidate.role === "core"
  && candidate.unit === "m");

if (applyDerived) {
  for (const target of catalog.targets.filter((item) => item.role === "derived" && ["m2", "m3"].includes(item.unit))) {
    let value = null;
    let formula = null;
    if (target.sheet === "给排水管道系统汇总表") {
      const lengthTarget = sameRowLength(target);
      const length = predictionMap.get(lengthTarget?.id)?.value;
      const nominal = diameterMm(target.item);
      const diameter = target.measurement.startsWith("内表面积") ? nominal : outsideDiameterMm(nominal, target.item);
      if (Number.isFinite(length) && Number.isFinite(diameter)) {
        value = Math.PI * diameter / 1000 * length;
        formula = `${target.measurement.startsWith("内") ? "inner" : "outer"}-surface(length,diameter)`;
      }
    } else if (target.sheet === "给排水专业刷油保温保护层系统汇总表") {
      const matchingPipes = corePipeTargets.filter((pipe) => contextKey(pipe) === contextKey(target));
      const insulationSibling = catalog.targets.find((candidate) =>
        candidate.sheet === target.sheet && contextKey(candidate) === contextKey(target) && /保温体积/.test(candidate.measurement));
      const thickness = Number(String(insulationSibling?.item ?? "").match(/[-–](\d+(?:\.\d+)?)\s*$/)?.[1] ?? 10);
      const parts = matchingPipes.flatMap((pipe) => {
        const length = predictionMap.get(pipe.id)?.value;
        const nominal = diameterMm(pipe.item);
        const outside = outsideDiameterMm(nominal, pipe.item);
        return Number.isFinite(length) && Number.isFinite(outside) ? [{ length, outside }] : [];
      });
      if (parts.length) {
        if (/保温体积/.test(target.measurement)) {
          value = parts.reduce((sum, part) => sum + Math.PI / 4 * (((part.outside + 2 * thickness) / 1000) ** 2 - (part.outside / 1000) ** 2) * part.length, 0);
          formula = "insulation-volume(pipe-length,outside-diameter,thickness)";
        } else if (/保护层面积/.test(target.measurement)) {
          value = parts.reduce((sum, part) => sum + Math.PI * (part.outside + 2 * thickness) / 1000 * part.length, 0);
          formula = "jacket-surface(pipe-length,insulated-diameter)";
        } else if (/外表面积/.test(target.measurement)) {
          value = parts.reduce((sum, part) => sum + Math.PI * part.outside / 1000 * part.length, 0);
          formula = "outer-surface(pipe-length,outside-diameter)";
        }
      }
    }
    if (Number.isFinite(value) && value >= 0) {
      const rounded = Number(value.toFixed(3));
      const previous = predictionMap.get(target.id);
      predictionMap.set(target.id, { id: target.id, value: rounded, confidence: 0.9, basis: `deterministic formula: ${formula}` });
      decisions.push({ id: target.id, stage: "derived-formula", previous: previous?.value ?? null, value: rounded, formula });
    }
  }
}

const predictions = catalog.targets.filter((target) => target.role !== "audit").map((target) =>
  predictionMap.get(target.id) ?? { id: target.id, value: null, confidence: null, basis: "no base prediction" });
const result = {
  protocol: {
    benchmarkId: "full-quantity-v0",
    caseId: "case-001",
    targetHash,
    truthAccess: "forbidden",
    version: "hybrid-v1",
    base: baseArg,
    semanticMappingSources: mappingDocuments.map((document) => document.protocol),
    confidenceThreshold: threshold,
    deterministicDerivedFormulas: applyDerived,
    segmentedEvidence: segmentedEvidenceArg ?? null,
    evidence: evidenceArg,
    registry: registryArg ?? null,
    contextThreshold: registry ? contextThreshold : null,
  },
  predictions,
  decisions,
};
await fs.mkdir(outputDir, { recursive: true });
const outputPath = path.join(outputDir, `${tag}.json`);
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, predictions: predictions.length, semanticOverrides: decisions.filter((decision) => decision.stage === "semantic-evidence").length, derivedOverrides: decisions.filter((decision) => decision.stage === "derived-formula").length }, null, 2));
