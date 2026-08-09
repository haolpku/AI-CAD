import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inventoryPath = path.join(projectDir, "outputs", "lighting-device-v0", "inventory.json");
const ontologyPath = path.join(projectDir, "config", "lighting-ontology-v0.json");
const experimentDir = path.join(projectDir, "experiments", "llm-mapping-v0");

const inventory = JSON.parse(await fs.readFile(inventoryPath, "utf8"));
const ontology = JSON.parse(await fs.readFile(ontologyPath, "utf8"));
const input = {
  protocol: {
    split: "calibration",
    truthAccess: "forbidden",
    allowedInputs: ["CAD派生图块属性标签", "每个标签在目标图层中的原始出现次数", "预先定义的目标类别本体"],
    forbiddenInputs: ["广联达Excel", "GQI4内部数据库", "广联达工程量数值", "基于评分结果反向修改本次预测"]
  },
  task: ontology.task,
  rules: ontology.rules,
  targetCategories: ontology.categories,
  cadEvidence: {
    selectedLayers: inventory.selectedLayers,
    selectedLayerInsertCount: inventory.selectedLayerInsertCount,
    sourceLabels: inventory.labelCounts
  }
};
const serialized = `${JSON.stringify(input, null, 2)}\n`;
await fs.mkdir(experimentDir, { recursive: true });
await fs.writeFile(path.join(experimentDir, "input.json"), serialized);
await fs.writeFile(
  path.join(experimentDir, "input.sha256"),
  `${crypto.createHash("sha256").update(serialized).digest("hex")}  input.json\n`,
);
console.log(path.join(experimentDir, "input.json"));
