import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(projectDir, "config", "full-quantity-v0.json");
const config = JSON.parse(await fs.readFile(configPath, "utf8"));
const outputDir = path.join(projectDir, "outputs", config.id, "cad");
const evidencePath = path.join(projectDir, "outputs", config.id, "cad-evidence.json");
const refresh = process.argv.includes("--refresh");
const includeSupporting = process.argv.includes("--all");
const resolveFromConfig = (relativePath) => path.resolve(path.dirname(configPath), relativePath);
const lastHandle = (value) => Array.isArray(value) && value.length ? value.at(-1) : null;
const distance = (a, b) => Math.hypot((a?.[0] ?? 0) - (b?.[0] ?? 0), (a?.[1] ?? 0) - (b?.[1] ?? 0));
const sanitize = (value) => String(value ?? "")
  .replace(/[（(]\s*\d{1,3}-\d{1,3}#?\s*[）)]/g, "(CASE-001)")
  .replace(/\b\d{1,3}-\d{1,3}#(?=[^0-9]|$)/g, "CASE-001")
  .replace(/^\d{1,3}-\d{1,3}(?=[-#])/g, "CASE-001")
  .replace(/\d+组团/g, "Project")
  .replace(/^[\p{Script=Han}]+\s*\d{1,3}-\d{1,3}#?$/u, "Case-001")
  .trim();
const increment = (map, key, amount = 1) => map.set(key, (map.get(key) ?? 0) + amount);
const ranked = (map, limit = 600) => [...map]
  .sort((left, right) => right[1] - left[1])
  .slice(0, limit)
  .map(([label, value]) => ({ label, value }));
const relevantText = /(?:DN\d+|BV\d|YJV|PVC|SC\d|LED|开关|插座|灯|箱|风机|风扇|阀|水管|配管|电线|电缆|桥架|防雷|接地|弯头|三通|套管|系统|回路|配电)/i;

await fs.mkdir(outputDir, { recursive: true });
const drawings = [];
for (const input of config.inputs.filter((item) => includeSupporting || !item.usedBy.includes("supporting-context"))) {
  const dwgPath = resolveFromConfig(input.path);
  const jsonPath = path.join(outputDir, `${input.id}.json`);
  const temporaryJsonPath = `${jsonPath}.tmp`;
  try {
    if (refresh) throw new Error("refresh");
    await fs.access(jsonPath);
  } catch {
    await fs.rm(temporaryJsonPath, { force: true });
    const conversion = spawnSync("dwgread", ["-v0", "-O", "JSON", "-o", temporaryJsonPath, dwgPath], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    if (conversion.status !== 0) {
      await fs.rm(temporaryJsonPath, { force: true });
      drawings.push({
        id: input.id,
        usedBy: input.usedBy,
        parseStatus: "unavailable",
        errorCode: /0x940/i.test(`${conversion.stderr}${conversion.stdout}`) ? "LIBREDWG_READ_0X940" : "DWG_CONVERSION_FAILED",
        modelSpaceEntityCount: 0,
        blockLabels: [],
        relevantTexts: [],
        layers: [],
      });
      continue;
    }
    await fs.rename(temporaryJsonPath, jsonPath);
  }

  const cad = JSON.parse(await fs.readFile(jsonPath, "utf8"));
  const objects = cad.OBJECTS ?? [];
  const byHandle = new Map(objects.map((object) => [lastHandle(object.handle), object]));
  const modelSpace = objects.find((object) => object.object === "BLOCK_HEADER" && object.name === "*MODEL_SPACE");
  const entities = (modelSpace?.entities ?? []).map((ref) => byHandle.get(lastHandle(ref))).filter(Boolean);
  const blockLabels = new Map();
  const textLabels = new Map();
  const layerStats = new Map();

  for (const entity of entities) {
    const layer = sanitize(byHandle.get(lastHandle(entity.layer))?.name ?? "<unknown>");
    const layerStat = layerStats.get(layer) ?? { entityCount: 0, insertCount: 0, lineLengthM: 0, entityTypes: {} };
    layerStat.entityCount += 1;
    layerStat.entityTypes[entity.entity] = (layerStat.entityTypes[entity.entity] ?? 0) + 1;

    let length = 0;
    if (entity.entity === "LINE") length = distance(entity.start, entity.end);
    if (entity.entity === "LWPOLYLINE") {
      const points = entity.points ?? [];
      for (let index = 1; index < points.length; index += 1) length += distance(points[index - 1], points[index]);
      if ((entity.flag & 1) && points.length > 2) length += distance(points.at(-1), points[0]);
    }
    layerStat.lineLengthM += length / 1000;

    if (entity.entity === "INSERT") {
      layerStat.insertCount += 1;
      const values = (entity.attribs ?? [])
        .map((ref) => sanitize(byHandle.get(lastHandle(ref))?.text_value))
        .filter(Boolean);
      const blockName = sanitize(byHandle.get(lastHandle(entity.block_header))?.name ?? "<unknown>");
      const semantic = [...new Set(values)].join(" | ") || blockName;
      increment(blockLabels, `${semantic} @ ${layer}`);
    }
    if (entity.entity === "TEXT" || entity.entity === "MTEXT") {
      const text = sanitize(entity.text_value ?? entity.text ?? "");
      if (text && relevantText.test(text) && text.length <= 180) increment(textLabels, `${text} @ ${layer}`);
    }
    layerStats.set(layer, layerStat);
  }

  drawings.push({
    id: input.id,
    usedBy: input.usedBy,
    parseStatus: "complete",
    modelSpaceEntityCount: entities.length,
    blockLabels: ranked(blockLabels),
    relevantTexts: ranked(textLabels),
    layers: [...layerStats].map(([layer, stats]) => ({ layer, ...stats }))
      .sort((left, right) => right.entityCount - left.entityCount),
  });
}

const evidence = {
  protocol: {
    benchmarkId: config.id,
    caseId: config.caseId,
    truthAccess: "forbidden",
    source: "DWG model-space entities only",
    assumedDrawingUnit: "mm",
  },
  drawings,
};
await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ evidencePath, drawings: drawings.map((item) => ({ id: item.id, entities: item.modelSpaceEntityCount, blocks: item.blockLabels.length, texts: item.relevantTexts.length, layers: item.layers.length })) }, null, 2));
