import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const leaderboardDir = path.join(projectDir, "leaderboard");
const submissionDir = path.join(leaderboardDir, "submissions");
const files = (await fs.readdir(submissionDir)).filter((file) => file.endsWith(".json"));
assert.ok(files.length >= 2);

for (const file of files) {
  const text = await fs.readFile(path.join(submissionDir, file), "utf8");
  const submission = JSON.parse(text);
  assert.equal(submission.benchmark.id, "full-quantity-v0");
  assert.match(submission.benchmark.targetHash, /^[a-f0-9]{64}$/);
  assert.ok(submission.scores.overall >= 0 && submission.scores.overall <= 100);
  assert.ok(submission.scores.core >= 0 && submission.scores.core <= 100);
  assert.ok(submission.scores.derived >= 0 && submission.scores.derived <= 100);
  assert.equal(Object.keys(submission.scores.disciplines).length, 5);
  assert.equal(Object.keys(submission.scores.groups).length, 15);
  assert.doesNotMatch(text, /"rows"\s*:|"truth"\s*:|"prediction"\s*:/);
  assert.doesNotMatch(text, /sk-[A-Za-z0-9]|\/Users\/|10-1#|台湖/);
}

const readme = await fs.readFile(path.join(leaderboardDir, "README.md"), "utf8");
assert.match(readme, /Group Score = Coverage/);
assert.match(readme, /Bench Score = 100/);
assert.match(readme, /90–100/);

console.log("leaderboard aggregate checks passed");
