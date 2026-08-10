import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const benchmarkId = "full-quantity-v0";
const outputRoot = path.join(projectDir, "outputs", benchmarkId);
const predictionDir = path.join(outputRoot, "predictions");
const truth = JSON.parse(await fs.readFile(path.join(projectDir, "data", "private", "case-001", benchmarkId, "truth.json"), "utf8"));
const targetHash = (await fs.readFile(path.join(projectDir, "benchmarks", benchmarkId, "targets.sha256"), "utf8")).split(/\s+/)[0];
const evaluatedTargets = truth.targets.filter((target) => target.role !== "audit");
const publishedFiles = [
  "gpt-5.6-sol--closed_world--full.json",
  "hybrid-v1-gated-t0.85.json",
  "gpt-5.6-sol--hybrid-v1-1.json",
  "hybrid-v1-2-count-on-v1-1-t0.85.json",
];

const allFiles = (await fs.readdir(predictionDir)).filter((file) => file.endsWith(".json") && !file.startsWith("oracle-"));
const eligibleFiles = [];
for (const file of allFiles) {
  try {
    const document = JSON.parse(await fs.readFile(path.join(predictionDir, file), "utf8"));
    if (document.protocol?.targetHash === targetHash && Array.isArray(document.predictions)) eligibleFiles.push(file);
  } catch {
    // Non-prediction JSON files are not oracle candidates.
  }
}

const writeSelector = async (name, files) => {
  const sources = await Promise.all(files.map(async (file) => {
    const document = JSON.parse(await fs.readFile(path.join(predictionDir, file), "utf8"));
    return { file, values: new Map((document.predictions ?? []).map((prediction) => [prediction.id, prediction.value])) };
  }));
  const predictions = evaluatedTargets.map((target) => {
    let best = null;
    for (const source of sources) {
      const value = source.values.get(target.id);
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const absoluteError = Math.abs(value - target.value);
      if (!best || absoluteError < best.absoluteError) best = { value, absoluteError, source: source.file };
    }
    return { id: target.id, value: best?.value ?? null, confidence: null, basis: `ORACLE truth-selected candidate: ${best?.source ?? "none"}` };
  });
  const result = {
    protocol: {
      benchmarkId,
      caseId: "case-001",
      targetHash,
      version: name,
      truthAccess: "required-oracle",
      leaderboardEligible: false,
      candidateCount: files.length,
    },
    predictions,
  };
  await fs.writeFile(path.join(predictionDir, `${name}.json`), `${JSON.stringify(result, null, 2)}\n`);
};

await writeSelector("oracle-published-method-selector", publishedFiles);
await writeSelector("oracle-all-existing-candidates", eligibleFiles);
await fs.writeFile(path.join(predictionDir, "oracle-perfect-model.json"), `${JSON.stringify({
  protocol: {
    benchmarkId,
    caseId: "case-001",
    targetHash,
    version: "oracle-perfect-model",
    truthAccess: "required-oracle",
    leaderboardEligible: false,
  },
  predictions: evaluatedTargets.map((target) => ({ id: target.id, value: target.value, confidence: 1, basis: "ORACLE exact modeled quantity" })),
}, null, 2)}\n`);

const names = ["oracle-published-method-selector", "oracle-all-existing-candidates", "oracle-perfect-model"];
const summary = { protocol: { truthAccess: "required-oracle", leaderboardEligible: false }, experiments: [] };
for (const name of names) {
  const predictionPath = path.join(predictionDir, `${name}.json`);
  const scorePath = path.join(outputRoot, `${name}--score.json`);
  const scoreRun = spawnSync(process.execPath, [path.join(projectDir, "scripts", "score-full-benchmark.mjs"), `--predictions=${predictionPath}`, `--output=${scorePath}`], { encoding: "utf8" });
  if (scoreRun.status !== 0) throw new Error(`Scoring ${name} failed: ${scoreRun.stderr || scoreRun.stdout}`);
  const score = JSON.parse(await fs.readFile(scorePath, "utf8"));
  summary.experiments.push({
    name,
    candidateCount: name === "oracle-published-method-selector" ? publishedFiles.length : name === "oracle-all-existing-candidates" ? eligibleFiles.length : 1,
    benchScore: score.benchScore,
    coreScore: 100 * score.byRole.find((role) => role.role === "core").score,
    derivedScore: 100 * score.byRole.find((role) => role.role === "derived").score,
    exactCount: score.rows.filter((row) => row.absoluteError <= 1e-9).length,
    toleranceHitCount: score.rows.filter((row) => row.withinTolerance).length,
  });
}
await fs.writeFile(path.join(outputRoot, "oracle-ceiling-v0-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
