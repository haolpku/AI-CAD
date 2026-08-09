import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const configPath = path.join(projectDir, "config", "lighting-device-v0.json");
const config = JSON.parse(await fs.readFile(configPath, "utf8"));
const resolveFromConfig = (relativePath) => path.resolve(path.dirname(configPath), relativePath);
const cadPath = resolveFromConfig(config.cad);
const workbookPath = resolveFromConfig(config.truthWorkbook);
const outputDir = path.join(projectDir, "outputs", config.id);
const cadJsonPath = path.join(outputDir, "cad.json");

await fs.mkdir(outputDir, { recursive: true });

const conversion = spawnSync("dwgread", ["-v0", "-O", "JSON", "-o", cadJsonPath, cadPath], {
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});
if (conversion.status !== 0) {
  throw new Error(`DWG conversion failed: ${conversion.stderr || conversion.stdout}`);
}

const lastHandle = (value) => Array.isArray(value) && value.length ? value.at(-1) : null;
const cad = JSON.parse(await fs.readFile(cadJsonPath, "utf8"));
const objects = cad.OBJECTS ?? [];
const byHandle = new Map(objects.map((object) => [lastHandle(object.handle), object]));
const modelSpace = objects.find(
  (object) => object.object === "BLOCK_HEADER" && object.name === "*MODEL_SPACE",
);
if (!modelSpace) throw new Error("Model space was not found in the converted DWG.");

const modelEntities = (modelSpace.entities ?? [])
  .map((reference) => byHandle.get(lastHandle(reference)))
  .filter(Boolean);

const allowedLayers = new Set(config.cadLayers);
const rawLabels = new Map();
const unmapped = new Map();
const predictionEvidence = new Map(config.categories.map((category) => [category.id, new Map()]));

const attributeValues = (insert) => (insert.attribs ?? [])
  .map((reference) => byHandle.get(lastHandle(reference)))
  .map((attribute) => attribute?.text_value?.trim())
  .filter(Boolean);

const pickSemanticLabel = (values) => values.find(
  (value) => !/^(?:E|F|M|A|B|REMARK|\$TEXT\$|\d+|\d+℃)$/i.test(value),
) ?? values[0] ?? "";

let layerInsertCount = 0;
for (const entity of modelEntities) {
  if (entity.entity !== "INSERT") continue;
  const layerName = byHandle.get(lastHandle(entity.layer))?.name ?? "<unknown>";
  if (!allowedLayers.has(layerName)) continue;
  layerInsertCount += 1;
  const values = attributeValues(entity);
  const label = pickSemanticLabel(values);
  const blockName = byHandle.get(lastHandle(entity.block_header))?.name ?? "<unknown>";
  const signature = label || `<无语义属性:${blockName}>`;
  rawLabels.set(signature, (rawLabels.get(signature) ?? 0) + 1);

  const matched = config.categories.find((category) =>
    category.cadPatterns.some((pattern) => new RegExp(pattern).test(label)),
  );
  if (!matched) {
    unmapped.set(signature, (unmapped.get(signature) ?? 0) + 1);
    continue;
  }
  const evidence = predictionEvidence.get(matched.id);
  evidence.set(signature, (evidence.get(signature) ?? 0) + 1);
}

const input = await FileBlob.load(workbookPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const truthSheet = workbook.worksheets.getItem(config.truthSheet);
const truthRows = truthSheet.getUsedRange(true).values;

const truth = config.categories.map((category) => {
  const matches = truthRows.slice(1).filter((row) => {
    const itemName = String(row[0] ?? "");
    return category.truthPatterns.some((pattern) => new RegExp(pattern).test(itemName));
  });
  return {
    id: category.id,
    label: category.label,
    unit: category.unit,
    value: matches.reduce((sum, row) => sum + (Number(row.at(-1)) || 0), 0),
    evidence: matches.map((row) => ({ item: row[0], value: Number(row.at(-1)) || 0 })),
  };
});

const predictions = config.categories.map((category) => {
  const evidence = predictionEvidence.get(category.id);
  return {
    id: category.id,
    label: category.label,
    unit: category.unit,
    value: [...evidence.values()].reduce((sum, value) => sum + value, 0),
    evidence: [...evidence.entries()].map(([label, value]) => ({ label, value })),
  };
});

const rows = truth.map((truthItem) => {
  const prediction = predictions.find((item) => item.id === truthItem.id);
  const error = prediction.value - truthItem.value;
  return {
    id: truthItem.id,
    label: truthItem.label,
    unit: truthItem.unit,
    truth: truthItem.value,
    prediction: prediction.value,
    error,
    absoluteError: Math.abs(error),
    absolutePercentageError: truthItem.value ? Math.abs(error) / truthItem.value : null,
    exact: error === 0,
  };
});

const sum = (values) => values.reduce((total, value) => total + value, 0);
const truthTotal = sum(rows.map((row) => row.truth));
const absoluteErrorTotal = sum(rows.map((row) => row.absoluteError));
const metrics = {
  categoryCount: rows.length,
  exactCategoryCount: rows.filter((row) => row.exact).length,
  exactCategoryRate: rows.filter((row) => row.exact).length / rows.length,
  meanAbsoluteError: absoluteErrorTotal / rows.length,
  meanAbsolutePercentageError: sum(rows.map((row) => row.absolutePercentageError ?? 0)) / rows.length,
  weightedAbsolutePercentageError: truthTotal ? absoluteErrorTotal / truthTotal : null,
  truthTotal,
  predictionTotal: sum(rows.map((row) => row.prediction)),
};

const sortedCounts = (counter) => [...counter.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([label, count]) => ({ label, count }));

const inventory = {
  source: config.cad,
  converter: cad.created_by,
  modelSpaceEntityCount: modelEntities.length,
  selectedLayers: config.cadLayers,
  selectedLayerInsertCount: layerInsertCount,
  labelCounts: sortedCounts(rawLabels),
  unmappedLabelCounts: sortedCounts(unmapped),
};

const result = {
  benchmark: { id: config.id, title: config.title, split: config.split },
  sources: { cad: config.cad, truthWorkbook: config.truthWorkbook, truthSheet: config.truthSheet },
  metrics,
  rows,
  limitations: config.knownUnsupported,
};

const percent = (value) => `${(value * 100).toFixed(1)}%`;
const markdownRows = rows.map((row) =>
  `| ${row.label} | ${row.truth} | ${row.prediction} | ${row.error > 0 ? "+" : ""}${row.error} | ${row.absolutePercentageError == null ? "—" : percent(row.absolutePercentageError)} |`,
).join("\n");
const report = `# ${config.title}\n\n` +
  `> 当前数据划分：**${config.split}**。本项目用于规则校准，不能作为独立测试集宣称泛化能力。\n\n` +
  `## 结果\n\n` +
  `- 类别数：${metrics.categoryCount}\n` +
  `- 完全命中：${metrics.exactCategoryCount}/${metrics.categoryCount}（${percent(metrics.exactCategoryRate)}）\n` +
  `- MAE：${metrics.meanAbsoluteError.toFixed(2)} 个/类别\n` +
  `- MAPE：${percent(metrics.meanAbsolutePercentageError)}\n` +
  `- WAPE：${percent(metrics.weightedAbsolutePercentageError)}\n` +
  `- 真值总量：${metrics.truthTotal}；预测总量：${metrics.predictionTotal}\n\n` +
  `| 类别 | 广联达真值 | CAD基线 | 差值 | 绝对百分比误差 |\n` +
  `|---|---:|---:|---:|---:|\n${markdownRows}\n\n` +
  `## 当前边界\n\n${config.knownUnsupported.map((item) => `- ${item}`).join("\n")}\n\n` +
  `## 架构结论\n\n` +
  `几何提取、数量计算和评分应保持为确定性 workflow；Codex SDK 适合用于生成候选映射规则、解释未映射图块、辅助复核和生成报告，不应直接替代几何计算器。\n`;

await Promise.all([
  fs.writeFile(path.join(outputDir, "truth.json"), `${JSON.stringify(truth, null, 2)}\n`),
  fs.writeFile(path.join(outputDir, "predictions.json"), `${JSON.stringify(predictions, null, 2)}\n`),
  fs.writeFile(path.join(outputDir, "inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`),
  fs.writeFile(path.join(outputDir, "results.json"), `${JSON.stringify(result, null, 2)}\n`),
  fs.writeFile(path.join(outputDir, "report.md"), report),
]);

console.log(JSON.stringify({ outputDir, metrics }, null, 2));
