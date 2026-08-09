import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cadPath = path.join(projectDir, "outputs", "lighting-device-v0", "cad.json");
const outputPath = path.join(projectDir, "experiments", "route-length-v0", "prediction.json");
const cad = JSON.parse(await fs.readFile(cadPath, "utf8"));
const objects = cad.OBJECTS ?? [];
const lastHandle = (value) => Array.isArray(value) && value.length ? value.at(-1) : null;
const byHandle = new Map(objects.map((object) => [lastHandle(object.handle), object]));
const modelSpace = objects.find((object) => object.object === "BLOCK_HEADER" && object.name === "*MODEL_SPACE");
const entities = (modelSpace?.entities ?? []).map((ref) => byHandle.get(lastHandle(ref))).filter(Boolean);
const distance = (a, b) => Math.hypot((a?.[0] ?? 0) - (b?.[0] ?? 0), (a?.[1] ?? 0) - (b?.[1] ?? 0));
const lengths = new Map();

for (const entity of entities) {
  const layer = byHandle.get(lastHandle(entity.layer))?.name ?? "<unknown>";
  let length = 0;
  if (entity.entity === "LINE") length = distance(entity.start, entity.end);
  if (entity.entity === "LWPOLYLINE") {
    const points = entity.points ?? [];
    for (let index = 1; index < points.length; index += 1) length += distance(points[index - 1], points[index]);
    if ((entity.flag & 1) && points.length > 2) length += distance(points.at(-1), points[0]);
  }
  if (length) lengths.set(layer, (lengths.get(layer) ?? 0) + length / 1000);
}

const selectedLayers = ["WIRE", "WIRE-照明", "WIRE-应急"];
const output = {
  protocol: {truthAccess: "forbidden", geometry: "model-space LINE and LWPOLYLINE chord length", assumedDrawingUnit: "mm"},
  layerLengthsM: Object.fromEntries([...lengths].sort((a, b) => b[1] - a[1])),
  pooledLightingRoute: {
    layers: selectedLayers,
    valueM: selectedLayers.reduce((sum, layer) => sum + (lengths.get(layer) ?? 0), 0)
  }
};
await fs.mkdir(path.dirname(outputPath), {recursive: true});
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output.pooledLightingRoute));
