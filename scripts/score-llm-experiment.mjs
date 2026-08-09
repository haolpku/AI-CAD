import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const experimentDir = path.join(projectDir, "experiments", "llm-mapping-v0");
const truth = JSON.parse(await fs.readFile(path.join(projectDir, "outputs", "lighting-device-v0", "truth.json"), "utf8"));
const truthMap = new Map(truth.map((item) => [item.id, item.value]));
const files = (await fs.readdir(experimentDir)).filter((name) => name.endsWith(".json") && name.includes("--"));

const scoreValues = (values) => {
  const rows = [...truthMap].map(([id, truthValue]) => {
    const prediction = Number(values[id] ?? 0);
    const error = prediction - truthValue;
    return { id, truth: truthValue, prediction, error, absoluteError: Math.abs(error) };
  });
  const absoluteError = rows.reduce((sum, row) => sum + row.absoluteError, 0);
  const truthTotal = rows.reduce((sum, row) => sum + row.truth, 0);
  return {
    rows,
    metrics: {
      exactRate: rows.filter((row) => row.error === 0).length / rows.length,
      mae: absoluteError / rows.length,
      wape: absoluteError / truthTotal,
      truthTotal,
      predictionTotal: rows.reduce((sum, row) => sum + row.prediction, 0)
    }
  };
};

const runs = [];
for (const file of files) {
  const prediction = JSON.parse(await fs.readFile(path.join(experimentDir, file), "utf8"));
  runs.push({
    file,
    model: prediction.protocol.model,
    mode: prediction.protocol.mode,
    scope: prediction.protocol.retrievalMode ?? (file.startsWith("all-layers") ? "all-layers" : "selected-layer"),
    ...scoreValues(prediction.values)
  });
}
runs.sort((a, b) => a.metrics.wape - b.metrics.wape);

const reportLines = [
  "# LLM无泄漏映射实验",
  "",
  "> 模型请求只读取 `input.json`；广联达真值仅由本评分脚本在请求完成后读取。当前项目仍是 calibration set，最优结果不能视为独立测试集成绩。",
  "",
  "| 排名 | 模型 | 模式 | 检索范围 | Exact | MAE | WAPE | 预测总量 |",
  "|---:|---|---|---|---:|---:|---:|---:|"
];
runs.forEach((run, index) => reportLines.push(
  `| ${index + 1} | ${run.model} | ${run.mode} | ${run.scope} | ${(run.metrics.exactRate * 100).toFixed(1)}% | ${run.metrics.mae.toFixed(2)} | ${(run.metrics.wape * 100).toFixed(1)}% | ${run.metrics.predictionTotal} |`
));
if (runs[0]) {
  reportLines.push("", "## 当前最佳逐项结果", "", `模型：${runs[0].model} / ${runs[0].mode}`, "", "| 类别ID | 真值 | 预测 | 差值 |", "|---|---:|---:|---:|");
  for (const row of runs[0].rows) reportLines.push(`| ${row.id} | ${row.truth} | ${row.prediction} | ${row.error > 0 ? "+" : ""}${row.error} |`);
}
await fs.writeFile(path.join(experimentDir, "scores.json"), `${JSON.stringify(runs, null, 2)}\n`);
await fs.writeFile(path.join(experimentDir, "report.md"), `${reportLines.join("\n")}\n`);
console.log(JSON.stringify(runs.map((run) => ({model: run.model, mode: run.mode, metrics: run.metrics})), null, 2));
