import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const experimentDir = path.join(projectDir, "experiments", "llm-mapping-v0");
const cadPath = path.join(projectDir, "outputs", "lighting-device-v0", "cad.json");
const ontology = JSON.parse(await fs.readFile(path.join(projectDir, "config", "lighting-ontology-v0.json"), "utf8"));
const cad = JSON.parse(await fs.readFile(cadPath, "utf8"));
const objects = cad.OBJECTS ?? [];
const lastHandle = (value) => Array.isArray(value) && value.length ? value.at(-1) : null;
const byHandle = new Map(objects.map((object) => [lastHandle(object.handle), object]));
const modelSpace = objects.find((object) => object.object === "BLOCK_HEADER" && object.name === "*MODEL_SPACE");
const entities = (modelSpace?.entities ?? []).map((ref) => byHandle.get(lastHandle(ref))).filter(Boolean);
const labels = new Map();
const anonymize = (value) => value
  .replace(/^[\p{Script=Han}]+\s*\d{1,3}-\d{1,3}#?$/u, "Case-001")
  .replace(/^\d{1,3}-\d{1,3}(?=[-#])/g, "CASE-001");
const pickLabel = (values) => values.find(
  (value) => !/^(?:E|F|M|A|B|REMARK|\$TEXT\$|\d+|\d+℃)$/i.test(value),
) ?? values[0] ?? "";

for (const entity of entities) {
  if (entity.entity !== "INSERT") continue;
  const values = (entity.attribs ?? [])
    .map((ref) => byHandle.get(lastHandle(ref))?.text_value?.trim())
    .filter(Boolean);
  const label = anonymize(pickLabel(values));
  if (!label) continue;
  const layer = byHandle.get(lastHandle(entity.layer))?.name ?? "<unknown>";
  const current = labels.get(label) ?? {label, count: 0, layers: {}};
  current.count += 1;
  current.layers[layer] = (current.layers[layer] ?? 0) + 1;
  labels.set(label, current);
}

const input = {
  protocol: {
    split: "calibration",
    truthAccess: "forbidden",
    retrievalMode: "semantic_recall_across_all_layers",
    allowedInputs: ["CAD模型空间全部带属性图块的语义标签", "原始计数", "标签所在图层分布", "目标类别本体"],
    forbiddenInputs: ["广联达Excel", "GQI4内部数据库", "广联达工程量数值", "评分结果"]
  },
  task: ontology.task,
  rules: [
    ...ontology.rules,
    "图层名称只能作为弱证据：实际设备可能被画在EQUIP-动力、Defpoints等非预期图层",
    "图例、系统图和重复引用可能造成额外图块；无法仅凭标签判断时保留映射但降低confidence"
  ],
  targetCategories: ontology.categories,
  cadEvidence: {
    modelSpaceEntityCount: entities.length,
    sourceLabels: [...labels.values()].sort((a, b) => b.count - a.count)
  }
};
const serialized = `${JSON.stringify(input, null, 2)}\n`;
const name = "input-all-layers.json";
await fs.writeFile(path.join(experimentDir, name), serialized);
await fs.writeFile(
  path.join(experimentDir, "input-all-layers.sha256"),
  `${crypto.createHash("sha256").update(serialized).digest("hex")}  ${name}\n`,
);
console.log(JSON.stringify({path: path.join(experimentDir, name), sourceLabels: input.cadEvidence.sourceLabels.length}));
