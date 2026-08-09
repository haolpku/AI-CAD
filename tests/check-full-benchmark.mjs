import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(projectDir, "benchmarks", "full-quantity-v0");
const privateTruthPath = path.join(projectDir, "data", "private", "case-001", "full-quantity-v0", "truth.json");
const manifest = JSON.parse(await fs.readFile(path.join(publicDir, "manifest.json"), "utf8"));
const targetText = await fs.readFile(path.join(publicDir, "targets.json"), "utf8");
const catalog = JSON.parse(targetText);
const predictionTemplate = JSON.parse(await fs.readFile(path.join(publicDir, "prediction-template.json"), "utf8"));
const privateTruthText = await fs.readFile(privateTruthPath, "utf8");
const privateTruth = JSON.parse(privateTruthText);

assert.equal(manifest.scope.workbookCount, 5);
assert.equal(manifest.scope.cadInputCount, 5);
assert.equal(manifest.scope.sheetCount, 11);
assert.equal(manifest.scope.detailRows, 326);
assert.equal(manifest.scope.scalarTargets, 380);
assert.equal(manifest.scope.scoredTargets, 366);
assert.equal(manifest.scope.coreTargets, 277);
assert.equal(manifest.scope.derivedTargets, 89);
assert.equal(manifest.scope.auditTargets, 14);
assert.ok(manifest.frozenInputs.every((input) => input.bytes > 0 && /^[a-f0-9]{64}$/.test(input.sha256)));
assert.equal(catalog.targets.length, 380);
assert.equal(privateTruth.targets.length, 380);
assert.equal(new Set(catalog.targets.map((target) => target.id)).size, 380);
assert.ok(catalog.targets.every((target) => !("value" in target)));
assert.ok(catalog.targets.every((target) => Array.isArray(target.context) && target.context.length > 0));
assert.ok(catalog.targets.filter((target) => target.item === "<空>").every((target) => target.context.length >= 2));
assert.doesNotMatch(targetText, /10-1#|台湖|\/Users\//);
assert.equal(catalog.protocol.truthAccess, "forbidden");
const expectedTargetHash = (await fs.readFile(path.join(publicDir, "targets.sha256"), "utf8")).split(/\s+/)[0];
const actualTargetHash = crypto.createHash("sha256").update(targetText).digest("hex");
assert.equal(actualTargetHash, expectedTargetHash);
assert.equal(predictionTemplate.protocol.targetHash, expectedTargetHash);

const expectedTruthHash = (await fs.readFile(path.join(publicDir, "truth.sha256"), "utf8")).split(/\s+/)[0];
const actualTruthHash = crypto.createHash("sha256").update(privateTruthText).digest("hex");
assert.equal(actualTruthHash, expectedTruthHash);

console.log("full benchmark checks passed");
