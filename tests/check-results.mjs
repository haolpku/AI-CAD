import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(projectDir, "outputs", "lighting-device-v0");
const result = JSON.parse(await fs.readFile(path.join(outputDir, "results.json"), "utf8"));
const inventory = JSON.parse(await fs.readFile(path.join(outputDir, "inventory.json"), "utf8"));

assert.equal(result.benchmark.split, "calibration");
assert.equal(result.rows.length, 10);
assert.equal(result.metrics.categoryCount, 10);
assert.equal(result.metrics.truthTotal, 156);
assert.equal(result.metrics.predictionTotal, 127);
assert.equal(result.rows.find((row) => row.id === "wall_light")?.prediction, 4);
assert.equal(result.rows.find((row) => row.id === "explosion_proof_light")?.exact, true);
assert.ok(result.metrics.weightedAbsolutePercentageError >= 0);
assert.ok(result.metrics.weightedAbsolutePercentageError <= 1);
assert.equal(inventory.selectedLayers[0], "EQUIP-照明");
assert.ok(inventory.selectedLayerInsertCount > 0);

console.log("benchmark result checks passed");
