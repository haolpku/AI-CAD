import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const experimentDir = path.join(projectDir, "experiments", "llm-mapping-v0");
const predictorSource = await fs.readFile(path.join(projectDir, "scripts", "run-llm-predict.mjs"), "utf8");
assert.doesNotMatch(predictorSource, /truth\.json|\.xlsx|GQI4|工程量_解压/);
assert.match(predictorSource, /CAD_BENCH_API_KEY/);
const routePredictorSource = await fs.readFile(path.join(projectDir, "scripts", "extract-route-geometry.mjs"), "utf8");
assert.doesNotMatch(routePredictorSource, /truth\.json|\.xlsx|GQI4|工程量_解压/);
const fullPredictorSource = await fs.readFile(path.join(projectDir, "scripts", "run-full-llm-predict.mjs"), "utf8");
assert.doesNotMatch(fullPredictorSource, /truth\.json|\.xlsx|GQI4|工程量_解压/);
assert.match(fullPredictorSource, /CAD_BENCH_API_KEY/);
const fullEvidenceSource = await fs.readFile(path.join(projectDir, "scripts", "prepare-full-cad-evidence.mjs"), "utf8");
assert.doesNotMatch(fullEvidenceSource, /truth\.json|\.xlsx|GQI4|工程量_解压/);

for (const inputName of ["input.json", "input-all-layers.json"]) {
  const input = JSON.parse(await fs.readFile(path.join(experimentDir, inputName), "utf8"));
  assert.equal(input.protocol.truthAccess, "forbidden");
  assert.ok(input.cadEvidence.sourceLabels.length > 0);
  assert.ok(input.targetCategories.length > 0);
}

const files = await fs.readdir(experimentDir);
for (const name of files.filter((file) => file.includes("--") && file.endsWith(".json"))) {
  const prediction = JSON.parse(await fs.readFile(path.join(experimentDir, name), "utf8"));
  assert.equal(prediction.protocol.truthAccess, "forbidden");
}

console.log("leakage boundary checks passed");
