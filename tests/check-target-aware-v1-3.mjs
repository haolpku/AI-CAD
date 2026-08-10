import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await fs.readFile(path.join(projectDir, "scripts", "run-semantic-map-v1.mjs"), "utf8");
assert.match(source, /--registry=/);
assert.match(source, /missingCritical/);
assert.match(source, /negativeEvidence/);
assert.match(source, /attempt <= 3/);
const report = await fs.readFile(path.join(projectDir, "experiments", "target-aware-v1-3", "README.md"), "utf8");
assert.match(report, /v1\.3-A context gate/);
assert.match(report, /36\.85/);
assert.match(report, /35\.57/);
assert.match(report, /重要负结果/);
console.log("target-aware v1.3 checks passed");
