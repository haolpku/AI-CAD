import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await fs.readFile(path.join(projectDir, "config", "full-quantity-v0.json"), "utf8"));
const cadDir = path.join(projectDir, "outputs", config.id, "cad");
const outputPath = path.join(projectDir, "outputs", config.id, "hybrid-evidence-v1.json");
const drawingInputs = config.inputs.filter((input) => !input.usedBy.includes("supporting-context"));
const lastHandle = (value) => Array.isArray(value) && value.length ? value.at(-1) : null;
const point2 = (value) => Array.isArray(value) && value.length >= 2
  ? [Number(value[0]), Number(value[1])]
  : null;
const distance = (left, right) => Math.hypot(left[0] - right[0], left[1] - right[1]);
const midpoint = (left, right) => [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
const sanitize = (value) => String(value ?? "")
  .replace(/\\P/g, " ")
  .replace(/[（(]\s*\d{1,3}-\d{1,3}#?\s*[）)]/g, "(CASE-001)")
  .replace(/\b\d{1,3}-\d{1,3}#(?=[^0-9]|$)/g, "CASE-001")
  .replace(/^\d{1,3}-\d{1,3}(?=[-#])/g, "CASE-001")
  .replace(/\d+组团/g, "Project")
  .trim();
const stableId = (prefix, ...parts) => `${prefix}-${crypto.createHash("sha256").update(parts.join("\u241f")).digest("hex").slice(0, 12)}`;
const classifyTitle = (text) => {
  if (/平面图/.test(text)) return "plan";
  if (/系统图/.test(text)) return "system";
  if (/图例/.test(text)) return "legend";
  if (/设计说明|材料表|设备表/.test(text)) return "notes";
  return null;
};
const nearestRegion = (point, titles) => {
  if (!point || !titles.length) return { type: "unknown", title: null, distance: null };
  let nearest = null;
  for (const title of titles) {
    const separation = distance(point, title.point);
    if (!nearest || separation < nearest.distance) nearest = { ...title, distance: separation };
  }
  if (nearest.distance > 120_000) return { type: "unknown", title: null, distance: nearest.distance };
  return { type: nearest.type, title: nearest.text, distance: nearest.distance };
};
const increment = (object, key, amount = 1) => {
  if (object instanceof Map) object.set(key, (object.get(key) ?? 0) + amount);
  else object[key] = (object[key] ?? 0) + amount;
};
const segmentLengthWithBulge = (left, right, bulge = 0) => {
  const chord = distance(left, right);
  if (!bulge || chord === 0) return chord;
  const angle = 4 * Math.atan(Math.abs(bulge));
  return chord * angle / (2 * Math.sin(angle / 2));
};
const pointToSegmentDistance = (point, start, end) => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return distance(point, start);
  const ratio = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  return distance(point, [start[0] + ratio * dx, start[1] + ratio * dy]);
};
const snapKey = (point, tolerance = 5) => `${Math.round(point[0] / tolerance)},${Math.round(point[1] / tolerance)}`;
const routeAnnotationPattern = /(?:DN\s*\d+|BV\d|YJV|PVC|SC\d+|给水|中水|污水|采暖|冷热水|线缆|桥架|配管)/i;

const drawings = [];
for (const input of drawingInputs) {
  const cad = JSON.parse(await fs.readFile(path.join(cadDir, `${input.id}.json`), "utf8"));
  const objects = cad.OBJECTS ?? [];
  const byHandle = new Map(objects.map((object) => [lastHandle(object.handle), object]));
  const modelSpace = objects.find((object) => object.object === "BLOCK_HEADER" && object.name === "*MODEL_SPACE");
  const entities = (modelSpace?.entities ?? []).map((reference) => byHandle.get(lastHandle(reference))).filter(Boolean);
  const titles = entities.flatMap((entity) => {
    if (entity.entity !== "TEXT" && entity.entity !== "MTEXT") return [];
    const text = sanitize(entity.text_value ?? entity.text);
    const type = classifyTitle(text);
    const point = point2(entity.ins_pt);
    const layer = sanitize(byHandle.get(lastHandle(entity.layer))?.name);
    if (!type || !point || /图框/i.test(layer)) return [];
    return [{ text: text.slice(0, 100), type, point }];
  });
  const annotations = entities.flatMap((entity) => {
    if (entity.entity !== "TEXT" && entity.entity !== "MTEXT") return [];
    const text = sanitize(entity.text_value ?? entity.text);
    const point = point2(entity.ins_pt);
    if (!point || !routeAnnotationPattern.test(text) || text.length > 120) return [];
    const region = nearestRegion(point, titles);
    return region.type === "plan" ? [{ text, point }] : [];
  });

  const blocks = new Map();
  const routes = new Map();
  for (const entity of entities) {
    const layer = sanitize(byHandle.get(lastHandle(entity.layer))?.name ?? "<unknown>");
    if (entity.entity === "INSERT") {
      const point = point2(entity.ins_pt);
      const attributes = (entity.attribs ?? [])
        .map((reference) => sanitize(byHandle.get(lastHandle(reference))?.text_value))
        .filter(Boolean);
      const blockName = sanitize(byHandle.get(lastHandle(entity.block_header))?.name ?? "<unknown>");
      const semantic = [...new Set(attributes)].join(" | ") || blockName;
      const key = `${semantic} @ ${layer}`;
      const aggregate = blocks.get(key) ?? {
        id: stableId("block", input.id, key), label: key, semantic, layer,
        totalCount: 0, uniqueCount: 0, planCount: 0, systemCount: 0,
        legendCount: 0, notesCount: 0, unknownCount: 0, sheetTitles: {}, _positions: new Set(),
      };
      aggregate.totalCount += 1;
      const positionKey = point ? snapKey(point, 1) : `missing-${aggregate.totalCount}`;
      if (!aggregate._positions.has(positionKey)) {
        aggregate._positions.add(positionKey);
        aggregate.uniqueCount += 1;
        const region = nearestRegion(point, titles);
        increment(aggregate, `${region.type}Count`);
        if (region.title) increment(aggregate.sheetTitles, region.title);
      }
      blocks.set(key, aggregate);
    }

    const segments = [];
    if (entity.entity === "LINE") {
      const start = point2(entity.start);
      const end = point2(entity.end);
      if (start && end) segments.push({ start, end, length: distance(start, end) });
    } else if (entity.entity === "LWPOLYLINE") {
      const points = (entity.points ?? []).map(point2).filter(Boolean);
      const bulges = entity.bulges ?? [];
      for (let index = 1; index < points.length; index += 1) {
        segments.push({ start: points[index - 1], end: points[index], length: segmentLengthWithBulge(points[index - 1], points[index], bulges[index - 1] ?? 0) });
      }
      if ((entity.flag & 1) && points.length > 2) {
        segments.push({ start: points.at(-1), end: points[0], length: segmentLengthWithBulge(points.at(-1), points[0], bulges.at(-1) ?? 0) });
      }
    } else if (entity.entity === "ARC") {
      const center = point2(entity.center);
      const radius = Number(entity.radius);
      if (center && Number.isFinite(radius)) {
        const startAngle = Number(entity.start_angle);
        const endAngle = Number(entity.end_angle);
        const sweep = ((endAngle - startAngle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        segments.push({
          start: [center[0] + radius * Math.cos(startAngle), center[1] + radius * Math.sin(startAngle)],
          end: [center[0] + radius * Math.cos(endAngle), center[1] + radius * Math.sin(endAngle)],
          length: radius * sweep,
        });
      }
    }
    if (segments.length) {
      const route = routes.get(layer) ?? {
        id: stableId("route", input.id, layer), layer, totalLengthM: 0, planLengthM: 0,
        systemLengthM: 0, legendLengthM: 0, notesLengthM: 0, unknownLengthM: 0,
        segmentCount: 0, planSegmentCount: 0, nearbyAnnotations: [], _planEdges: [], _annotations: new Map(),
      };
      for (const segment of segments) {
        const region = nearestRegion(midpoint(segment.start, segment.end), titles);
        const lengthM = segment.length / 1000;
        route.totalLengthM += lengthM;
        route.segmentCount += 1;
        route[`${region.type}LengthM`] += lengthM;
        if (region.type === "plan") {
          route.planSegmentCount += 1;
          route._planEdges.push(segment);
        }
      }
      routes.set(layer, route);
    }
  }

  for (const annotation of annotations) {
    let nearest = null;
    for (const route of routes.values()) {
      for (const edge of route._planEdges) {
        const separation = pointToSegmentDistance(annotation.point, edge.start, edge.end);
        if (!nearest || separation < nearest.separation) nearest = { route, separation };
      }
    }
    if (nearest && nearest.separation <= 5_000) increment(nearest.route._annotations, annotation.text);
  }

  const blockEvidence = [...blocks.values()].map((block) => {
    delete block._positions;
    block.sheetTitles = Object.entries(block.sheetTitles)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 12)
      .map(([title, count]) => ({ title, count }));
    return block;
  }).sort((left, right) => right.planCount - left.planCount || right.uniqueCount - left.uniqueCount);
  const routeEvidence = [...routes.values()].map((route) => {
    const adjacency = new Map();
    for (const edge of route._planEdges) {
      const start = snapKey(edge.start);
      const end = snapKey(edge.end);
      if (!adjacency.has(start)) adjacency.set(start, new Set());
      if (!adjacency.has(end)) adjacency.set(end, new Set());
      adjacency.get(start).add(end);
      adjacency.get(end).add(start);
    }
    const visited = new Set();
    let componentCount = 0;
    for (const node of adjacency.keys()) {
      if (visited.has(node)) continue;
      componentCount += 1;
      const stack = [node];
      while (stack.length) {
        const current = stack.pop();
        if (visited.has(current)) continue;
        visited.add(current);
        stack.push(...adjacency.get(current));
      }
    }
    route.componentCount = componentCount;
    route.danglingEndpointCount = [...adjacency.values()].filter((neighbors) => neighbors.size === 1).length;
    route.nearbyAnnotations = [...route._annotations]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 30)
      .map(([text, count]) => ({ text, count }));
    delete route._planEdges;
    delete route._annotations;
    for (const key of Object.keys(route).filter((key) => key.endsWith("LengthM"))) route[key] = Number(route[key].toFixed(3));
    return route;
  }).sort((left, right) => right.planLengthM - left.planLengthM);

  drawings.push({
    id: input.id,
    usedBy: input.usedBy,
    modelSpaceEntityCount: entities.length,
    classifiedTitleCount: titles.length,
    titles: titles.map(({ text, type }) => ({ text, type })),
    blocks: blockEvidence,
    routes: routeEvidence,
  });
}

const document = {
  protocol: {
    benchmarkId: config.id,
    caseId: config.caseId,
    version: "hybrid-evidence-v1",
    truthAccess: "forbidden",
    source: "DWG model-space entities",
    spatialClassifier: "nearest non-title-block sheet title within 120m drawing units",
    routeGeometry: "LINE + LWPOLYLINE (including bulge arcs) + ARC",
  },
  drawings,
};
await fs.writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
console.log(JSON.stringify({
  outputPath,
  drawings: drawings.map((drawing) => ({
    id: drawing.id,
    titles: drawing.classifiedTitleCount,
    blocks: drawing.blocks.length,
    planBlocks: drawing.blocks.reduce((sum, block) => sum + block.planCount, 0),
    routes: drawing.routes.length,
    planRouteLengthM: Number(drawing.routes.reduce((sum, route) => sum + route.planLengthM, 0).toFixed(3)),
  })),
}, null, 2));
