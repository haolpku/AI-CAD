import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectDir, "outputs", "full-quantity-v0");
const irDir = path.join(outputRoot, "project-ir-v1-2");
const outputPath = path.join(outputRoot, "hybrid-evidence-v1-2.json");
const previous = JSON.parse(await fs.readFile(path.join(outputRoot, "hybrid-evidence-v1.json"), "utf8"));
const previousByDrawing = new Map(previous.drawings.map((drawing) => [drawing.id, drawing]));
const drawingIds = ["electrical-cad", "plumbing-cad", "hvac-cad"];
const distance = (left, right) => Math.hypot(left[0] - right[0], left[1] - right[1]);
const stableId = (prefix, ...parts) => `${prefix}-${crypto.createHash("sha256").update(parts.join("\u241f")).digest("hex").slice(0, 12)}`;
const sanitize = (value) => String(value ?? "")
  .replace(/\\P/g, " ")
  .replace(/[（(]\s*\d{1,3}-\d{1,3}#?\s*[）)]/g, "(CASE-001)")
  .replace(/\b\d{1,3}-\d{1,3}#(?=[^0-9]|$)/g, "CASE-001")
  .replace(/^\d{1,3}-\d{1,3}(?=[-#])/g, "CASE-001")
  .replace(/\d+组团/g, "Project")
  .replace(/\s+/g, " ")
  .trim();
const classifyTitle = (text) => {
  if (/总平面图|总图/.test(text)) return "site-plan";
  if (/平面图/.test(text)) return "plan";
  if (/系统图/.test(text)) return "system";
  if (/剖面图/.test(text)) return "section";
  if (/立面图/.test(text)) return "elevation";
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
  return nearest;
};
const snapKey = (point, tolerance = 1) => point ? `${Math.round(point[0] / tolerance)},${Math.round(point[1] / tolerance)}` : null;
const increment = (object, key, amount = 1) => { object[key] = (object[key] ?? 0) + amount; };
const recordsFrom = async (filePath) => {
  const records = [];
  const input = fsSync.createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) if (line.trim()) records.push(JSON.parse(line));
  return records;
};

const drawings = [];
for (const drawingId of drawingIds) {
  const records = await recordsFrom(path.join(irDir, `${drawingId}.instances.ndjson`));
  const titles = records.flatMap((record) => {
    if (!["TEXT", "MTEXT", "ATTRIB"].includes(record.type)) return [];
    const text = sanitize(record.geometry?.text);
    const type = classifyTitle(text);
    const point = record.geometry?.point;
    if (!type || !point || /图框/i.test(record.layer)) return [];
    return [{ type, text: text.slice(0, 100), point }];
  });
  const blocks = new Map();
  for (const record of records.filter((item) => item.type === "INSERT")) {
    const attributes = [...new Set((record.attributes ?? []).map(sanitize).filter(Boolean))];
    const blockName = sanitize(record.blockName) || "<unknown>";
    const semantic = attributes.join(" | ") || blockName;
    const layer = sanitize(record.layer) || "<unknown>";
    const key = `${semantic} @ ${layer}`;
    const aggregate = blocks.get(key) ?? {
      id: stableId("block12", drawingId, key),
      label: key,
      semantic,
      layer,
      totalCount: 0,
      uniqueCount: 0,
      planCount: 0,
      systemCount: 0,
      legendCount: 0,
      notesCount: 0,
      sectionCount: 0,
      elevationCount: 0,
      sitePlanCount: 0,
      unknownCount: 0,
      nestedCount: 0,
      maxDepth: 0,
      sheetTitles: {},
      _positions: new Set(),
    };
    aggregate.totalCount += 1;
    aggregate.maxDepth = Math.max(aggregate.maxDepth, record.depth);
    if (record.depth > 0) aggregate.nestedCount += 1;
    const position = record.geometry?.point;
    const positionKey = snapKey(position) ?? `missing:${record.stableId}`;
    if (!aggregate._positions.has(positionKey)) {
      aggregate._positions.add(positionKey);
      aggregate.uniqueCount += 1;
      const region = nearestRegion(position, titles);
      const countKey = region.type === "site-plan" ? "sitePlanCount" : `${region.type}Count`;
      increment(aggregate, countKey);
      if (region.title) increment(aggregate.sheetTitles, region.title);
    }
    blocks.set(key, aggregate);
  }
  const blockEvidence = [...blocks.values()].map((block) => {
    delete block._positions;
    block.sheetTitles = Object.entries(block.sheetTitles)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 12)
      .map(([title, count]) => ({ title, count }));
    return block;
  }).sort((left, right) => right.planCount - left.planCount || right.uniqueCount - left.uniqueCount);
  const previousDrawing = previousByDrawing.get(drawingId);
  drawings.push({
    id: drawingId,
    titleCount: titles.length,
    blocks: blockEvidence,
    routes: previousDrawing?.routes ?? [],
    quality: {
      expandedRecordCount: records.length,
      insertOccurrenceCount: records.filter((record) => record.type === "INSERT").length,
      nestedInsertOccurrenceCount: records.filter((record) => record.type === "INSERT" && record.depth > 0).length,
      routeSource: "frozen-v1-top-level-geometry",
    },
  });
  console.log(`${drawingId}: ${blockEvidence.length} block groups, ${blockEvidence.reduce((sum, block) => sum + block.planCount, 0)} plan occurrences`);
}

const result = {
  protocol: {
    benchmarkId: "full-quantity-v0",
    caseId: "case-001",
    version: "hybrid-evidence-v1.2",
    truthAccess: "forbidden",
    countEvidence: "recursive INSERT occurrences with world coordinates",
    routeEvidence: "frozen v1 geometry; nested symbol primitives excluded",
  },
  drawings,
};
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(`Wrote ${path.relative(projectDir, outputPath)}`);
