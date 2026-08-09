import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await fs.readFile(path.join(projectDir, "config", "full-quantity-v0.json"), "utf8"));
const cadDir = path.join(projectDir, "outputs", config.id, "cad");
const outputDir = path.join(projectDir, "outputs", config.id, "project-ir-v1-2");
const publicDir = path.join(projectDir, "preprocessing", "v1-2");
const maxDepth = Number(process.env.AICAD_IR_MAX_DEPTH ?? 8);
const maxInstances = Number(process.env.AICAD_IR_MAX_INSTANCES ?? 2_000_000);
const identity = [1, 0, 0, 1, 0, 0];
const lastHandle = (value) => Array.isArray(value) && value.length ? String(value.at(-1)) : null;
const point2 = (value) => Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))
  ? [Number(value[0]), Number(value[1])]
  : null;
const cleanText = (value) => String(value ?? "").replace(/\\P/g, " ").replace(/\s+/g, " ").trim();
const hash = (...parts) => crypto.createHash("sha256").update(parts.join("\u241f")).digest("hex").slice(0, 16);
const multiply = (left, right) => [
  left[0] * right[0] + left[2] * right[1],
  left[1] * right[0] + left[3] * right[1],
  left[0] * right[2] + left[2] * right[3],
  left[1] * right[2] + left[3] * right[3],
  left[0] * right[4] + left[2] * right[5] + left[4],
  left[1] * right[4] + left[3] * right[5] + left[5],
];
const transformPoint = (matrix, point) => point ? [
  matrix[0] * point[0] + matrix[2] * point[1] + matrix[4],
  matrix[1] * point[0] + matrix[3] * point[1] + matrix[5],
] : null;
const insertMatrix = (entity, block) => {
  const insertion = point2(entity.ins_pt) ?? [0, 0];
  const base = point2(block?.base_pt) ?? [0, 0];
  const scale = Array.isArray(entity.scale) ? [Number(entity.scale[0] ?? 1), Number(entity.scale[1] ?? entity.scale[0] ?? 1)] : [1, 1];
  const angle = Number(entity.rotation ?? 0);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const local = [cos * scale[0], sin * scale[0], -sin * scale[1], cos * scale[1], insertion[0], insertion[1]];
  return multiply(local, [1, 0, 0, 1, -base[0], -base[1]]);
};
const updateBounds = (bounds, point) => {
  if (!point) return;
  bounds.minX = Math.min(bounds.minX, point[0]);
  bounds.minY = Math.min(bounds.minY, point[1]);
  bounds.maxX = Math.max(bounds.maxX, point[0]);
  bounds.maxY = Math.max(bounds.maxY, point[1]);
};
const increment = (object, key, amount = 1) => { object[key] = (object[key] ?? 0) + amount; };
const titleType = (text) => {
  if (/总平面图|总图/.test(text)) return "site-plan";
  if (/平面图/.test(text)) return "plan";
  if (/系统图/.test(text)) return "system";
  if (/剖面图/.test(text)) return "section";
  if (/立面图/.test(text)) return "elevation";
  if (/图例/.test(text)) return "legend";
  if (/设计说明|材料表|设备表/.test(text)) return "notes";
  return null;
};
const floorToken = (text) => text.match(/地下[一二三四五六七八九十]+层|负[一二三四五六七八九十]+层|首层|[一二三四五六七八九十]+层|屋面层|屋顶层|机房层|B\d+|F\d+/i)?.[0] ?? null;
const boundReference = (name) => name.includes("$0$") ? name.split("$0$")[0].replace(/\d+组团/g, "PROJECT").slice(0, 80) : null;
const worldGeometry = (entity, matrix) => {
  const type = entity.entity;
  if (type === "LINE") return { start: transformPoint(matrix, point2(entity.start)), end: transformPoint(matrix, point2(entity.end)) };
  if (type === "LWPOLYLINE") return { points: (entity.points ?? []).map(point2).filter(Boolean).map((point) => transformPoint(matrix, point)), bulges: entity.bulges ?? [], closed: Boolean(entity.flag & 1) };
  if (type === "ARC" || type === "CIRCLE") return { center: transformPoint(matrix, point2(entity.center)), radius: Number(entity.radius ?? 0), startAngle: entity.start_angle, endAngle: entity.end_angle };
  if (["TEXT", "MTEXT", "ATTRIB", "POINT"].includes(type)) return { point: transformPoint(matrix, point2(entity.ins_pt ?? entity.point)), text: cleanText(entity.text_value ?? entity.text) || undefined };
  if (type === "INSERT") return { point: transformPoint(matrix, point2(entity.ins_pt)) };
  return null;
};
const safeBounds = (bounds) => Number.isFinite(bounds.minX) ? bounds : null;
const roundedBounds = (bounds) => bounds && Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, Number(value.toFixed(3))]));
const writeLine = async (stream, value) => {
  if (!stream.write(`${JSON.stringify(value)}\n`)) await once(stream, "drain");
};

await fs.mkdir(outputDir, { recursive: true });
const drawingSummaries = [];

for (const input of config.inputs) {
  const jsonPath = path.join(cadDir, `${input.id}.json`);
  const outputPath = path.join(outputDir, `${input.id}.instances.ndjson`);
  let cad;
  try {
    cad = JSON.parse(await fs.readFile(jsonPath, "utf8"));
  } catch {
    drawingSummaries.push({
      id: input.id,
      role: input.usedBy.includes("supporting-context") ? "supporting-context" : "quantity-source",
      usedBy: input.usedBy,
      parseStatus: "unavailable",
      errorCode: input.id === "architecture-cad" ? "LIBREDWG_READ_0X940" : "CAD_JSON_UNAVAILABLE",
      rawEntityCount: 0,
      expandedInstanceCount: 0,
    });
    continue;
  }

  const objects = cad.OBJECTS ?? [];
  const byHandle = new Map(objects.map((object) => [lastHandle(object.handle), object]));
  const blocks = objects.filter((object) => object.object === "BLOCK_HEADER");
  const modelSpace = blocks.find((block) => block.name === "*MODEL_SPACE");
  const stream = fsSync.createWriteStream(outputPath, { encoding: "utf8" });
  const countsByType = {};
  const countsByDepth = {};
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const titles = [];
  const floors = {};
  const referenceNames = {};
  const seenIds = new Set();
  let duplicateStableIdCount = 0;
  let expandedInstanceCount = 0;
  let nestedInstanceCount = 0;
  let insertOccurrenceCount = 0;
  let nestedInsertOccurrenceCount = 0;
  let cycleSkipCount = 0;
  let depthSkipCount = 0;
  let instanceLimitHit = false;

  const visit = async (references, matrix, blockPath, occurrencePath, depth, ancestors) => {
    if (depth > maxDepth) { depthSkipCount += 1; return; }
    for (let index = 0; index < (references ?? []).length; index += 1) {
      if (expandedInstanceCount >= maxInstances) { instanceLimitHit = true; return; }
      const entity = byHandle.get(lastHandle(references[index]));
      if (!entity?.entity) continue;
      const sourceHandle = lastHandle(entity.handle);
      const layer = cleanText(byHandle.get(lastHandle(entity.layer))?.name) || "<unknown>";
      const instancePath = [...occurrencePath, `${sourceHandle}:${index}`];
      const stableId = `${input.id}-${hash(input.id, ...instancePath)}`;
      if (seenIds.has(stableId)) duplicateStableIdCount += 1;
      seenIds.add(stableId);
      const geometry = worldGeometry(entity, matrix);
      for (const point of [geometry?.point, geometry?.start, geometry?.end, geometry?.center, ...(geometry?.points ?? [])]) updateBounds(bounds, point);
      const record = {
        stableId,
        drawingId: input.id,
        sourceHandle,
        type: entity.entity,
        layer,
        depth,
        blockPath,
        occurrencePath: instancePath,
        transform: matrix.map((value) => Number(value.toFixed(12))),
        geometry,
      };
      increment(countsByType, entity.entity);
      increment(countsByDepth, String(depth));
      expandedInstanceCount += 1;
      if (depth > 0) nestedInstanceCount += 1;

      if (["TEXT", "MTEXT", "ATTRIB"].includes(entity.entity)) {
        const text = cleanText(entity.text_value ?? entity.text);
        const kind = titleType(text);
        const floor = floorToken(text);
        if (floor) increment(floors, floor);
        if (kind && geometry?.point) titles.push({ type: kind, floor, point: geometry.point, textHash: hash(input.id, text) });
      }

      if (entity.entity === "INSERT") {
        insertOccurrenceCount += 1;
        if (depth > 0) nestedInsertOccurrenceCount += 1;
        const block = byHandle.get(lastHandle(entity.block_header));
        const blockName = cleanText(block?.name) || "<unknown>";
        record.blockNameHash = hash(input.id, blockName);
        record.blockName = blockName;
        record.attributes = (entity.attribs ?? [])
          .map((reference) => cleanText(byHandle.get(lastHandle(reference))?.text_value))
          .filter(Boolean);
        const reference = boundReference(blockName);
        if (reference) increment(referenceNames, reference);
        const childMatrix = multiply(matrix, insertMatrix(entity, block));
        await writeLine(stream, record);
        const blockHandle = lastHandle(block?.handle);
        if (blockHandle && ancestors.has(blockHandle)) { cycleSkipCount += 1; continue; }
        if (block?.entities?.length) {
          const nextAncestors = new Set(ancestors);
          if (blockHandle) nextAncestors.add(blockHandle);
          await visit(block.entities, childMatrix, [...blockPath, blockName], [...instancePath, `block:${blockHandle}`], depth + 1, nextAncestors);
        }
      } else {
        await writeLine(stream, record);
      }
    }
  };

  await visit(modelSpace?.entities ?? [], identity, ["*MODEL_SPACE"], ["model"], 0, new Set([lastHandle(modelSpace?.handle)]));
  stream.end();
  await once(stream, "finish");
  const drawingBounds = safeBounds(bounds);
  drawingSummaries.push({
    id: input.id,
    role: input.usedBy.includes("supporting-context") ? "supporting-context" : "quantity-source",
    usedBy: input.usedBy,
    parseStatus: "complete",
    rawObjectCount: objects.length,
    modelSpaceReferenceCount: modelSpace?.entities?.length ?? 0,
    expandedInstanceCount,
    nestedInstanceCount,
    nestedRecoveryRatio: expandedInstanceCount ? Number((nestedInstanceCount / expandedInstanceCount).toFixed(6)) : 0,
    insertOccurrenceCount,
    nestedInsertOccurrenceCount,
    stableIdUniqueCount: seenIds.size,
    duplicateStableIdCount,
    countsByType,
    countsByDepth,
    bounds: roundedBounds(drawingBounds),
    titleCandidateCount: titles.length,
    titleTypeCounts: titles.reduce((result, title) => (increment(result, title.type), result), {}),
    floorMentionCounts: floors,
    boundReferenceFingerprints: Object.entries(referenceNames).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([name, count]) => ({ fingerprint: hash(name), count })),
    cycleSkipCount,
    depthSkipCount,
    instanceLimitHit,
  });
  console.log(`${input.id}: ${expandedInstanceCount} instances (${nestedInstanceCount} nested), ${titles.length} title candidates`);
}

const graphEdges = [];
for (const source of drawingSummaries) {
  for (const discipline of source.usedBy) {
    graphEdges.push({ type: "used-by", source: source.id, target: discipline });
  }
}
for (let leftIndex = 0; leftIndex < drawingSummaries.length; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < drawingSummaries.length; rightIndex += 1) {
    const left = drawingSummaries[leftIndex];
    const right = drawingSummaries[rightIndex];
    const leftRefs = new Set((left.boundReferenceFingerprints ?? []).map((item) => item.fingerprint));
    const sharedReferences = (right.boundReferenceFingerprints ?? []).filter((item) => leftRefs.has(item.fingerprint)).length;
    const sharedFloors = Object.keys(left.floorMentionCounts ?? {}).filter((floor) => floor in (right.floorMentionCounts ?? {})).length;
    if (sharedReferences) graphEdges.push({ type: "shared-bound-reference", source: left.id, target: right.id, strength: sharedReferences });
    if (sharedFloors) graphEdges.push({ type: "shared-floor-vocabulary", source: left.id, target: right.id, strength: sharedFloors });
  }
}

const completeDrawings = drawingSummaries.filter((drawing) => drawing.parseStatus === "complete");
const manifest = {
  schemaVersion: "1.2",
  benchmarkId: config.id,
  generatedAt: new Date().toISOString(),
  policy: {
    rawCadRemainsPrivate: true,
    rawObjectsRemainAuthoritative: true,
    recursiveBlockExpansion: true,
    worldCoordinateNormalization: true,
    stableOccurrenceIds: true,
    aggregationAfterSemanticBinding: true,
    maxDepth,
    maxInstancesPerDrawing: maxInstances,
  },
  quality: {
    configuredDrawingCount: config.inputs.length,
    parsedDrawingCount: completeDrawings.length,
    parseCoverage: Number((completeDrawings.length / config.inputs.length).toFixed(6)),
    expandedInstanceCount: completeDrawings.reduce((sum, drawing) => sum + drawing.expandedInstanceCount, 0),
    nestedRecoveredInstanceCount: completeDrawings.reduce((sum, drawing) => sum + drawing.nestedInstanceCount, 0),
    duplicateStableIdCount: completeDrawings.reduce((sum, drawing) => sum + drawing.duplicateStableIdCount, 0),
    titleCandidateCount: completeDrawings.reduce((sum, drawing) => sum + drawing.titleCandidateCount, 0),
    projectGraphEdgeCount: graphEdges.length,
  },
  drawings: drawingSummaries,
  projectGraph: {
    nodes: drawingSummaries.map(({ id, role, usedBy, parseStatus }) => ({ id, role, usedBy, parseStatus })),
    edges: graphEdges,
  },
};
await fs.writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
const publicManifest = {
  schemaVersion: manifest.schemaVersion,
  benchmarkId: manifest.benchmarkId,
  protocol: {
    truthAccess: "forbidden",
    rawCadPublished: false,
    intermediateInstancesPublished: false,
  },
  quality: manifest.quality,
  drawings: manifest.drawings.map((drawing) => ({
    id: drawing.id,
    role: drawing.role,
    parseStatus: drawing.parseStatus,
    errorCode: drawing.errorCode,
    modelSpaceReferenceCount: drawing.modelSpaceReferenceCount ?? 0,
    expandedInstanceCount: drawing.expandedInstanceCount,
    nestedInstanceCount: drawing.nestedInstanceCount ?? 0,
    nestedRecoveryRatio: drawing.nestedRecoveryRatio ?? 0,
    insertOccurrenceCount: drawing.insertOccurrenceCount ?? 0,
    nestedInsertOccurrenceCount: drawing.nestedInsertOccurrenceCount ?? 0,
    titleCandidateCount: drawing.titleCandidateCount ?? 0,
    floorVocabularySize: Object.keys(drawing.floorMentionCounts ?? {}).length,
    duplicateStableIdCount: drawing.duplicateStableIdCount ?? 0,
    cycleSkipCount: drawing.cycleSkipCount ?? 0,
    depthSkipCount: drawing.depthSkipCount ?? 0,
    instanceLimitHit: drawing.instanceLimitHit ?? false,
  })),
  projectGraph: {
    nodeCount: manifest.projectGraph.nodes.length,
    edgeCount: manifest.projectGraph.edges.length,
    edgeTypeCounts: manifest.projectGraph.edges.reduce((result, edge) => (increment(result, edge.type), result), {}),
  },
  limitations: [
    "architecture-cad cannot be decoded by the current LibreDWG version; embedded bound-reference context remains available in discipline drawings",
    "title and floor candidates are spatial evidence, not authoritative sheet boundaries",
    "world-coordinate normalization does not by itself establish cross-drawing semantic equivalence",
  ],
};
await fs.mkdir(publicDir, { recursive: true });
await fs.writeFile(path.join(publicDir, "manifest.json"), `${JSON.stringify(publicManifest, null, 2)}\n`);
console.log(`Wrote ${path.relative(projectDir, path.join(outputDir, "manifest.json"))}`);
