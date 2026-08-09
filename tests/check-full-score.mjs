import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const benchmarkDir = path.join(projectDir, "benchmarks", "full-quantity-v0");
const truth = JSON.parse(await fs.readFile(
  path.join(projectDir, "data", "private", "case-001", "full-quantity-v0", "truth.json"),
  "utf8",
));
const targetHash = (await fs.readFile(path.join(benchmarkDir, "targets.sha256"), "utf8")).split(/\s+/)[0];
const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), "cad-bench-score-"));

try {
  const predictionPath = path.join(temporaryDir, "perfect.json");
  const scorePath = path.join(temporaryDir, "score.json");
  const prediction = {
    protocol: { benchmarkId: "full-quantity-v0", targetHash, truthAccess: "test-only" },
    predictions: truth.targets
      .filter((target) => target.role !== "audit")
      .map((target) => ({ id: target.id, value: target.value })),
  };
  await fs.writeFile(predictionPath, `${JSON.stringify(prediction)}\n`);
  await execFileAsync(process.execPath, [
    path.join(projectDir, "scripts", "score-full-benchmark.mjs"),
    `--predictions=${predictionPath}`,
    `--output=${scorePath}`,
  ], { cwd: projectDir });
  const score = JSON.parse(await fs.readFile(scorePath, "utf8"));
  assert.equal(score.benchScore, 100);
  assert.equal(score.overallCoverage, 1);
  assert.ok(score.byRole.every((role) => role.score === 1));
} finally {
  await fs.rm(temporaryDir, { recursive: true });
}

console.log("full benchmark scoring checks passed");
