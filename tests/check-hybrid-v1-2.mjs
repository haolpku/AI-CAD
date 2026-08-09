import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidence = JSON.parse(await fs.readFile(path.join(projectDir, "outputs", "full-quantity-v0", "hybrid-evidence-v1-2.json"), "utf8"));
assert.equal(evidence.protocol.version, "hybrid-evidence-v1.2");
assert.equal(evidence.protocol.truthAccess, "forbidden");
assert.equal(evidence.drawings.length, 3);
const blocks = evidence.drawings.flatMap((drawing) => drawing.blocks);
assert.equal(new Set(blocks.map((block) => block.id)).size, blocks.length);
assert.ok(blocks.some((block) => block.nestedCount > 0));
assert.ok(evidence.drawings.every((drawing) => drawing.quality.routeSource === "frozen-v1-top-level-geometry"));
assert.ok(evidence.drawings.every((drawing) => drawing.quality.expandedRecordCount > 0));
const text = JSON.stringify(evidence);
assert.doesNotMatch(text, /"truth"\s*:|\/Users\/|sk-[A-Za-z0-9]|10-1#|台湖/);
console.log("hybrid v1.2 evidence checks passed");
