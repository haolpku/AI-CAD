import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = JSON.parse(await fs.readFile(path.join(projectDir, "experience-base", "base-v0.json"), "utf8"));
assert.equal(base.protocol.containsProjectAnswers, false);
assert.equal(base.protocol.benchmarkTruthAccess, "forbidden");
assert.equal(new Set(base.experiences.map((experience) => experience.id)).size, base.experiences.length);
for (const experience of base.experiences) {
  assert.ok(["T0-schema", "T2-promoted"].includes(experience.tier));
  if (experience.tier === "T2-promoted" || (experience.inferenceEligible && experience.supportProjectCount > 0)) {
    assert.ok(experience.supportProjectCount >= 2, `${experience.id} needs at least two training projects`);
    assert.equal(experience.heldoutValidated, true, `${experience.id} needs project-level held-out validation`);
  }
}
const text = JSON.stringify(base);
assert.doesNotMatch(text, /target[-_]?id|"truth"\s*:|"predictions?"\s*:|quantityValue|sourceProjectHash|sourceCell|\/Users\/|sk-[A-Za-z0-9]|10-1#|台湖/i);
console.log("experience base checks passed");
