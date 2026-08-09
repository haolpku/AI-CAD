import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidencePath = path.join(projectDir, "outputs", "full-quantity-v0", "hybrid-evidence-v1.json");
const evidence = JSON.parse(await fs.readFile(evidencePath, "utf8"));

assert.equal(evidence.protocol.truthAccess, "forbidden");
assert.equal(evidence.protocol.version, "hybrid-evidence-v1");
assert.equal(evidence.drawings.length, 3);
assert.ok(evidence.drawings.every((drawing) => drawing.classifiedTitleCount > 0));

const blocks = evidence.drawings.flatMap((drawing) => drawing.blocks);
const routes = evidence.drawings.flatMap((drawing) => drawing.routes);
assert.equal(new Set(blocks.map((block) => block.id)).size, blocks.length);
assert.equal(new Set(routes.map((route) => route.id)).size, routes.length);
assert.ok(blocks.every((block) => block.uniqueCount === block.planCount + block.systemCount
  + block.legendCount + block.notesCount + block.unknownCount));
assert.ok(routes.every((route) => route.planLengthM >= 0 && route.totalLengthM >= 0));
assert.ok(routes.some((route) => route.componentCount > 0 && route.danglingEndpointCount >= 0));

const evidenceText = JSON.stringify(evidence);
assert.doesNotMatch(evidenceText, /10-1#|台湖|\/Users\//);

console.log("hybrid v1 evidence checks passed");
