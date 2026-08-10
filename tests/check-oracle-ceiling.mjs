import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const report = await fs.readFile(path.join(projectDir, "experiments", "oracle-ceiling-v0", "README.md"), "utf8");
assert.match(report, /45\.91/);
assert.match(report, /leaderboardEligible = false/);
assert.match(report, /禁止进入 leaderboard/);
const leaderboardFiles = await fs.readdir(path.join(projectDir, "leaderboard", "submissions"));
assert.ok(leaderboardFiles.every((file) => !file.includes("oracle")));
console.log("oracle ceiling isolation checks passed");
