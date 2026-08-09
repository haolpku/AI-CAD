import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cadDir = path.join(projectDir, "outputs", "full-quantity-v0", "cad");
const outputPath = path.join(projectDir, "outputs", "full-quantity-v0", "route-segments-v1-1.json");
const drawingsToRead = ["plumbing-cad", "hvac-cad"];
const numericArg = (name, fallback) => {
  const value = Number(process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  return value;
};
const snapToleranceMm = numericArg("snap-mm", 10);
const annotationRadiusMm = numericArg("annotation-radius-mm", 1000);
const maxPropagationDistanceMm = numericArg("max-propagation-mm", 100000);
const conflictToleranceMm = numericArg("conflict-mm", 500);
const lastHandle = (value) => Array.isArray(value) && value.length ? value.at(-1) : null;
const point2 = (value) => Array.isArray(value) && value.length >= 2 ? [Number(value[0]), Number(value[1])] : null;
const distance = (left, right) => Math.hypot(left[0] - right[0], left[1] - right[1]);
const midpoint = (left, right) => [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
const sanitize = (value) => String(value ?? "").replace(/\\P/g, " ")
  .replace(/[（(]\s*\d{1,3}-\d{1,3}#?\s*[）)]/g, "(CASE-001)")
  .replace(/\b\d{1,3}-\d{1,3}#(?=[^0-9]|$)/g, "CASE-001")
  .replace(/\d+组团/g, "Project").trim();
const stableId = (...parts) => `segment-${crypto.createHash("sha256").update(parts.join("\u241f")).digest("hex").slice(0, 12)}`;
const classifyTitle = (text) => {
  if (/平面图/.test(text)) return "plan";
  if (/系统图/.test(text)) return "system";
  if (/图例/.test(text)) return "legend";
  if (/设计说明|材料表|设备表/.test(text)) return "notes";
  return null;
};
const nearestRegion = (point, titles) => {
  let nearest = null;
  for (const title of titles) {
    const separation = distance(point, title.point);
    if (!nearest || separation < nearest.distance) nearest = { ...title, distance: separation };
  }
  return nearest && nearest.distance <= 120_000 ? nearest.type : "unknown";
};
const pointToSegmentDistance = (point, start, end) => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return distance(point, start);
  const ratio = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  return distance(point, [start[0] + ratio * dx, start[1] + ratio * dy]);
};
const segmentLengthWithBulge = (left, right, bulge = 0) => {
  const chord = distance(left, right);
  if (!bulge || chord === 0) return chord;
  const angle = 4 * Math.atan(Math.abs(bulge));
  return chord * angle / (2 * Math.sin(angle / 2));
};
const snapKey = (point, tolerance = snapToleranceMm) => `${Math.round(point[0] / tolerance)},${Math.round(point[1] / tolerance)}`;
const excludedLayer = /(?:Project|图框|TITLE|TEXT|DOTE|WALL|COLUMN|STAIR|AXIS|PUB_|BOUNDARY|DIM|标注|填充|排水沟|ANNO|CPNT)/i;
const mepLayer = /(?:P-|M-|PIPE|WATR|DRAI|PLUM|给排水|水管|采暖|冷热水|冷凝水|污水|中水)/i;
const isRouteLayer = (layer) => mepLayer.test(layer) && !excludedLayer.test(layer);
const dnValues = (text) => [...new Set([...String(text).matchAll(/DN\s*(\d+(?:\.\d+)?)/gi)].map((match) => Number(match[1])))];

const outputDrawings = [];
for (const drawingId of drawingsToRead) {
  const cad = JSON.parse(await fs.readFile(path.join(cadDir, `${drawingId}.json`), "utf8"));
  const objects = cad.OBJECTS ?? [];
  const byHandle = new Map(objects.map((object) => [lastHandle(object.handle), object]));
  const modelSpace = objects.find((object) => object.object === "BLOCK_HEADER" && object.name === "*MODEL_SPACE");
  const entities = (modelSpace?.entities ?? []).map((reference) => byHandle.get(lastHandle(reference))).filter(Boolean);
  const titles = entities.flatMap((entity) => {
    if (!['TEXT', 'MTEXT'].includes(entity.entity)) return [];
    const text = sanitize(entity.text_value ?? entity.text);
    const type = classifyTitle(text);
    const point = point2(entity.ins_pt);
    const layer = sanitize(byHandle.get(lastHandle(entity.layer))?.name);
    return type && point && !/图框/i.test(layer) ? [{ text, type, point }] : [];
  });
  const annotations = entities.flatMap((entity) => {
    if (!['TEXT', 'MTEXT'].includes(entity.entity)) return [];
    const text = sanitize(entity.text_value ?? entity.text);
    const point = point2(entity.ins_pt);
    const dns = dnValues(text);
    return point && dns.length && nearestRegion(point, titles) === "plan" ? [{ text, point, dns }] : [];
  });
  const byLayer = new Map();
  for (const entity of entities) {
    const layer = sanitize(byHandle.get(lastHandle(entity.layer))?.name ?? "<unknown>");
    if (!isRouteLayer(layer)) continue;
    const segments = [];
    if (entity.entity === "LINE") {
      const start = point2(entity.start); const end = point2(entity.end);
      if (start && end) segments.push({ start, end, lengthMm: distance(start, end) });
    } else if (entity.entity === "LWPOLYLINE") {
      const points = (entity.points ?? []).map(point2).filter(Boolean); const bulges = entity.bulges ?? [];
      for (let index = 1; index < points.length; index += 1) segments.push({ start: points[index - 1], end: points[index], lengthMm: segmentLengthWithBulge(points[index - 1], points[index], bulges[index - 1] ?? 0) });
      if ((entity.flag & 1) && points.length > 2) segments.push({ start: points.at(-1), end: points[0], lengthMm: segmentLengthWithBulge(points.at(-1), points[0], bulges.at(-1) ?? 0) });
    } else if (entity.entity === "ARC") {
      const center = point2(entity.center); const radius = Number(entity.radius);
      if (center && Number.isFinite(radius)) {
        const startAngle = Number(entity.start_angle); const endAngle = Number(entity.end_angle);
        const sweep = ((endAngle - startAngle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        segments.push({ start: [center[0] + radius * Math.cos(startAngle), center[1] + radius * Math.sin(startAngle)], end: [center[0] + radius * Math.cos(endAngle), center[1] + radius * Math.sin(endAngle)], lengthMm: radius * sweep });
      }
    }
    for (const segment of segments) {
      if (nearestRegion(midpoint(segment.start, segment.end), titles) !== "plan" || segment.lengthMm <= 0) continue;
      const list = byLayer.get(layer) ?? [];
      list.push({ ...segment, index: list.length, startKey: snapKey(segment.start), endKey: snapKey(segment.end), seeds: [] });
      byLayer.set(layer, list);
    }
  }

  const aggregates = [];
  for (const [layer, segments] of byLayer) {
    const nodeEdges = new Map();
    for (const segment of segments) {
      for (const node of [segment.startKey, segment.endKey]) {
        if (!nodeEdges.has(node)) nodeEdges.set(node, []);
        nodeEdges.get(node).push(segment.index);
      }
    }
    const adjacency = segments.map(() => new Set());
    for (const edgeIndexes of nodeEdges.values()) {
      for (const left of edgeIndexes) for (const right of edgeIndexes) if (left !== right) adjacency[left].add(right);
    }
    for (const annotation of annotations) {
      let nearest = null;
      for (const segment of segments) {
        const separation = pointToSegmentDistance(annotation.point, segment.start, segment.end);
        if (!nearest || separation < nearest.separation) nearest = { segment, separation };
      }
      if (nearest && nearest.separation <= annotationRadiusMm) {
        for (const dn of annotation.dns) nearest.segment.seeds.push({ dn, text: annotation.text, separation: nearest.separation });
      }
    }

    const best = segments.map(() => null);
    const queue = [];
    for (const segment of segments) for (const seed of segment.seeds) queue.push({ edge: segment.index, dn: seed.dn, distance: 0, seedText: seed.text });
    while (queue.length) {
      queue.sort((left, right) => left.distance - right.distance);
      const state = queue.shift();
      const current = best[state.edge];
      if (current && state.distance > current.distance + conflictToleranceMm) continue;
      if (current && current.dn !== state.dn && Math.abs(state.distance - current.distance) <= conflictToleranceMm) {
        current.ambiguous = true;
        continue;
      }
      if (!current || state.distance < current.distance) {
        best[state.edge] = { dn: state.dn, distance: state.distance, seedText: state.seedText, ambiguous: false };
        for (const neighbor of adjacency[state.edge]) {
          const nextDistance = state.distance + (segments[state.edge].lengthMm + segments[neighbor].lengthMm) / 2;
          if (nextDistance <= maxPropagationDistanceMm) queue.push({ ...state, edge: neighbor, distance: nextDistance });
        }
      }
    }

    const grouped = new Map();
    for (const segment of segments) {
      const assignment = best[segment.index];
      const dn = assignment && !assignment.ambiguous ? assignment.dn : null;
      const key = dn == null ? "unknown" : String(dn);
      const group = grouped.get(key) ?? { dn, lengthM: 0, segmentCount: 0, directSeedSegmentCount: 0, maxPropagationDistanceM: 0, seedTexts: new Map() };
      group.lengthM += segment.lengthMm / 1000;
      group.segmentCount += 1;
      if (segment.seeds.some((seed) => seed.dn === dn)) group.directSeedSegmentCount += 1;
      if (assignment) {
        group.maxPropagationDistanceM = Math.max(group.maxPropagationDistanceM, assignment.distance / 1000);
        group.seedTexts.set(assignment.seedText, (group.seedTexts.get(assignment.seedText) ?? 0) + 1);
      }
      grouped.set(key, group);
    }
    for (const group of grouped.values()) aggregates.push({
      id: stableId(drawingId, layer, group.dn ?? "unknown"), drawing: drawingId, layer,
      system: layer.replace(/^(?:水-给排水-|暖-)/, "").replace(/-系统\d*$/, ""),
      dn: group.dn,
      lengthM: Number(group.lengthM.toFixed(3)),
      segmentCount: group.segmentCount,
      directSeedSegmentCount: group.directSeedSegmentCount,
      maxPropagationDistanceM: Number(group.maxPropagationDistanceM.toFixed(3)),
      seedTexts: [...group.seedTexts].sort((left, right) => right[1] - left[1]).slice(0, 12).map(([text, count]) => ({ text, count })),
    });
  }
  outputDrawings.push({ id: drawingId, annotationCount: annotations.length, routeLayerCount: byLayer.size, segments: aggregates.sort((left, right) => right.lengthM - left.lengthM) });
}

const result = {
  protocol: { benchmarkId: "full-quantity-v0", caseId: "case-001", version: "route-segments-v1.1", truthAccess: "forbidden", snapToleranceMm, annotationRadiusMm, maxPropagationDistanceMm, conflictToleranceMm },
  drawings: outputDrawings,
};
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, drawings: outputDrawings.map((drawing) => ({ id: drawing.id, annotations: drawing.annotationCount, routeLayers: drawing.routeLayerCount, aggregates: drawing.segments.length, knownLengthM: Number(drawing.segments.filter((segment) => segment.dn != null).reduce((sum, segment) => sum + segment.lengthM, 0).toFixed(3)), unknownLengthM: Number(drawing.segments.filter((segment) => segment.dn == null).reduce((sum, segment) => sum + segment.lengthM, 0).toFixed(3)) })) }, null, 2));
