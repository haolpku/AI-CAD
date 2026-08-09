import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const benchmarkId = "full-quantity-v0";
const caseId = "case-001";
const predictionArg = process.argv.find((value) => value.startsWith("--predictions="));
const outputArg = process.argv.find((value) => value.startsWith("--output="));
const includeAll = process.argv.includes("--all");
const predictionPath = path.resolve(projectDir, predictionArg?.slice("--predictions=".length)
  ?? `benchmarks/${benchmarkId}/prediction-template.json`);
const outputPath = path.resolve(projectDir, outputArg?.slice("--output=".length)
  ?? `outputs/${benchmarkId}/score.json`);
const truthPath = path.join(projectDir, "data", "private", caseId, benchmarkId, "truth.json");
const truth = JSON.parse(await fs.readFile(truthPath, "utf8"));
const prediction = JSON.parse(await fs.readFile(predictionPath, "utf8"));
const targetHash = (await fs.readFile(path.join(projectDir, "benchmarks", benchmarkId, "targets.sha256"), "utf8"))
  .split(/\s+/)[0];
if (prediction.protocol?.benchmarkId !== benchmarkId) throw new Error(`Expected benchmarkId ${benchmarkId}.`);
if (prediction.protocol?.targetHash !== targetHash) throw new Error("Prediction targetHash does not match the frozen target catalog.");
const predictionItems = prediction.predictions ?? [];
if (new Set(predictionItems.map((item) => item.id)).size !== predictionItems.length) {
  throw new Error("Prediction contains duplicate target IDs.");
}
const truthIds = new Set(truth.targets.map((target) => target.id));
const unknownIds = predictionItems.map((item) => item.id).filter((id) => !truthIds.has(id));
if (unknownIds.length) throw new Error(`Prediction contains unknown target IDs: ${unknownIds.slice(0, 3).join(", ")}`);
const predictionMap = new Map(predictionItems.map((item) => [item.id, item.value]));
const evaluatedTruth = truth.targets.filter((target) => includeAll || target.role === "primary");

const scoreRows = evaluatedTruth.map((target) => {
  const rawPrediction = predictionMap.get(target.id);
  const predicted = typeof rawPrediction === "number" && Number.isFinite(rawPrediction) ? rawPrediction : null;
  const error = predicted == null ? null : predicted - target.value;
  return {
    id: target.id,
    discipline: target.discipline,
    unit: target.unit,
    truth: target.value,
    prediction: predicted,
    error,
    absoluteError: error == null ? null : Math.abs(error),
  };
});

const summarize = (rows) => {
  const predictedRows = rows.filter((row) => row.prediction != null);
  const truthAbsoluteTotal = predictedRows.reduce((sum, row) => sum + Math.abs(row.truth), 0);
  const absoluteErrorTotal = predictedRows.reduce((sum, row) => sum + row.absoluteError, 0);
  return {
    targetCount: rows.length,
    predictedCount: predictedRows.length,
    coverage: rows.length ? predictedRows.length / rows.length : null,
    mae: predictedRows.length ? absoluteErrorTotal / predictedRows.length : null,
    wape: truthAbsoluteTotal ? absoluteErrorTotal / truthAbsoluteTotal : null,
    exactRate: predictedRows.length
      ? predictedRows.filter((row) => row.absoluteError <= 1e-9).length / predictedRows.length
      : null,
  };
};

const groupBy = (rows, key) => [...rows.reduce((map, row) => {
  const group = map.get(row[key]) ?? [];
  group.push(row);
  map.set(row[key], group);
  return map;
}, new Map())].map(([name, group]) => ({ name, ...summarize(group) }));

const result = {
  benchmark: { id: benchmarkId, caseId, scope: includeAll ? "all" : "primary" },
  overallCoverage: summarize(scoreRows).coverage,
  byUnit: groupBy(scoreRows, "unit"),
  byDiscipline: groupBy(scoreRows, "discipline"),
  note: "不同单位不得合并计算WAPE；overall只报告覆盖率。",
  rows: scoreRows,
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, overallCoverage: result.overallCoverage, byUnit: result.byUnit }, null, 2));
