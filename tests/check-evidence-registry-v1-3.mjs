import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requirements = JSON.parse(await fs.readFile(path.join(projectDir, "benchmarks", "full-quantity-v0", "data-requirements-v1-3.json"), "utf8"));
assert.equal(requirements.protocol.truthAccess, "forbidden");
assert.equal(requirements.protocol.containsQuantityValues, false);
assert.equal(requirements.summary.catalogTargetCount, 380);
assert.equal(requirements.summary.scoredTargetCount, 366);
assert.equal(requirements.targets.length, 380);
assert.ok(requirements.targets.every((target) => target.required.length > 0 && target.formula));
assert.ok(requirements.targets.filter((target) => target.targetType === "device-count").every((target) => target.unit === "个"));

const registry = JSON.parse(await fs.readFile(path.join(projectDir, "outputs", "full-quantity-v0", "evidence-registry-v1-3.json"), "utf8"));
assert.equal(registry.protocol.truthAccess, "forbidden");
assert.equal(registry.protocol.containsQuantityValues, false);
assert.equal(registry.summary.scoredTargetCount, 366);
assert.equal(registry.targetContexts.length, 380);
assert.equal(new Set(registry.graph.nodes.map((node) => node.id)).size, registry.graph.nodes.length);
assert.ok(registry.graph.edges.some((edge) => edge.type === "derived-from"));
assert.ok(registry.targetContexts.every((context) => context.contextCompleteness >= 0 && context.contextCompleteness <= 1));
assert.ok(registry.targetContexts.filter((context) => context.targetType === "conductor-length").every((context) => context.missingCritical.includes("circuit-route")));
const publicManifestText = await fs.readFile(path.join(projectDir, "preprocessing", "v1-3", "manifest.json"), "utf8");
assert.doesNotMatch(publicManifestText, /"targetContexts"|"truth"\s*:|\/Users\/|sk-[A-Za-z0-9]|10-1#|台湖/);
console.log("evidence registry v1.3 checks passed");
