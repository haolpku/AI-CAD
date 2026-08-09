import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const benchmarkId = "full-quantity-v0";
const caseId = "case-001";
const config = JSON.parse(await fs.readFile(path.join(projectDir, "config", "full-quantity-v0.json"), "utf8"));
const predictionArg = process.argv.find((value) => value.startsWith("--predictions="));
const outputArg = process.argv.find((value) => value.startsWith("--output="));
const includeAudit = process.argv.includes("--all");
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
const evaluatedTruth = truth.targets.filter((target) => includeAudit || target.role !== "audit");

const scoreRows = evaluatedTruth.map((target) => {
  const rawPrediction = predictionMap.get(target.id);
  const predicted = typeof rawPrediction === "number" && Number.isFinite(rawPrediction) ? rawPrediction : null;
  const error = predicted == null ? null : predicted - target.value;
  const absoluteError = error == null ? null : Math.abs(error);
  const tolerance = Math.max(
    Number(config.evaluation.absoluteTolerances[target.unit] ?? 0),
    Math.abs(target.value) * Number(config.evaluation.relativeTolerance ?? 0),
  );
  return {
    id: target.id,
    discipline: target.discipline,
    unit: target.unit,
    role: target.role,
    truth: target.value,
    prediction: predicted,
    error,
    absoluteError,
    tolerance,
    withinTolerance: absoluteError == null ? null : absoluteError <= tolerance,
  };
});

const summarize = (rows) => {
  const predictedRows = rows.filter((row) => row.prediction != null);
  const truthAbsoluteTotal = predictedRows.reduce((sum, row) => sum + Math.abs(row.truth), 0);
  const absoluteErrorTotal = predictedRows.reduce((sum, row) => sum + row.absoluteError, 0);
  const coverage = rows.length ? predictedRows.length / rows.length : null;
  const wape = truthAbsoluteTotal ? absoluteErrorTotal / truthAbsoluteTotal : null;
  const toleranceHitRate = predictedRows.length
    ? predictedRows.filter((row) => row.withinTolerance).length / predictedRows.length
    : null;
  const quality = predictedRows.length
    ? 0.7 * Math.max(0, 1 - wape) + 0.3 * toleranceHitRate
    : 0;
  return {
    targetCount: rows.length,
    predictedCount: predictedRows.length,
    coverage,
    mae: predictedRows.length ? absoluteErrorTotal / predictedRows.length : null,
    wape,
    toleranceHitRate,
    exactRate: predictedRows.length
      ? predictedRows.filter((row) => row.absoluteError <= 1e-9).length / predictedRows.length
      : null,
    groupScore: coverage == null ? null : coverage * quality,
  };
};

const groupBy = (rows, key) => [...rows.reduce((map, row) => {
  const group = map.get(row[key]) ?? [];
  group.push(row);
  map.set(row[key], group);
  return map;
}, new Map())].map(([name, group]) => ({ name, ...summarize(group) }));

const roleScores = ["core", "derived"].map((role) => {
  const roleRows = scoreRows.filter((row) => row.role === role);
  const groups = [...roleRows.reduce((map, row) => {
    const key = `${row.discipline}|${row.unit}`;
    const group = map.get(key) ?? [];
    group.push(row);
    map.set(key, group);
    return map;
  }, new Map())].map(([name, rows]) => ({ name, ...summarize(rows) }));
  const weightTotal = groups.reduce((sum, group) => sum + Math.sqrt(group.targetCount), 0);
  const score = weightTotal
    ? groups.reduce((sum, group) => sum + group.groupScore * Math.sqrt(group.targetCount), 0) / weightTotal
    : 0;
  return { role, weight: config.evaluation.roleWeights[role], score, groups };
});
const benchScore = 100 * roleScores.reduce((sum, role) => sum + role.weight * role.score, 0);

const result = {
  benchmark: { id: benchmarkId, caseId, scope: includeAudit ? "all" : "core+derived" },
  benchScore,
  overallCoverage: summarize(scoreRows).coverage,
  byRole: roleScores,
  byUnit: groupBy(scoreRows, "unit"),
  byDiscipline: groupBy(scoreRows, "discipline"),
  note: "Bench Score = 80% Core + 20% Derived；每层按专业×单位分组，以sqrt(目标数)加权。组分数=覆盖率×[70%×max(0,1-WAPE)+30%×容差命中率]。Audit不计总分。",
  rows: scoreRows,
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, benchScore, overallCoverage: result.overallCoverage, byRole: result.byRole }, null, 2));
