import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scoreArg = process.argv.find((value) => value.startsWith("--score="))?.slice("--score=".length);
const outputArg = process.argv.find((value) => value.startsWith("--output="))?.slice("--output=".length);
const method = process.argv.find((value) => value.startsWith("--method="))?.slice("--method=".length);
const model = process.argv.find((value) => value.startsWith("--model="))?.slice("--model=".length);
const protocol = process.argv.find((value) => value.startsWith("--protocol="))?.slice("--protocol=".length) ?? "";
if (!scoreArg || !outputArg || !method || !model) {
  throw new Error("Required: --score=path --output=path --method=name --model=name [--protocol=text]");
}

const score = JSON.parse(await fs.readFile(path.resolve(projectDir, scoreArg), "utf8"));
const manifest = JSON.parse(await fs.readFile(path.join(projectDir, "benchmarks", "full-quantity-v0", "manifest.json"), "utf8"));
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const roleWeight = Object.fromEntries(score.byRole.map((role) => [role.role, role.weight]));
const groups = Object.fromEntries(score.byRole.flatMap((role) => role.groups.map((group) => [
  `${role.role}/${group.name}`,
  {
    score: round(100 * group.groupScore, 4),
    targets: group.targetCount,
    wape: round(group.wape),
    toleranceHitRate: round(group.toleranceHitRate),
  },
])));
const disciplines = [...new Set(score.byRole.flatMap((role) => role.groups.map((group) => group.name.split("|")[0])))];
const disciplineScores = Object.fromEntries(disciplines.map((discipline) => {
  const roles = score.byRole.flatMap((role) => {
    const roleGroups = role.groups.filter((group) => group.name.startsWith(`${discipline}|`));
    if (!roleGroups.length) return [];
    const groupWeight = roleGroups.reduce((sum, group) => sum + Math.sqrt(group.targetCount), 0);
    const roleScore = roleGroups.reduce((sum, group) => sum + group.groupScore * Math.sqrt(group.targetCount), 0) / groupWeight;
    return [{ weight: roleWeight[role.role], score: roleScore }];
  });
  const totalRoleWeight = roles.reduce((sum, role) => sum + role.weight, 0);
  const disciplineScore = roles.reduce((sum, role) => sum + role.weight * role.score, 0) / totalRoleWeight;
  return [discipline, round(100 * disciplineScore, 4)];
}));

const submission = {
  benchmark: {
    id: manifest.benchmark.id,
    split: manifest.benchmark.split,
    targetHash: manifest.protocol.targetHash,
  },
  method,
  model,
  protocol,
  scores: {
    overall: round(score.benchScore, 4),
    core: round(100 * score.byRole.find((role) => role.role === "core").score, 4),
    derived: round(100 * score.byRole.find((role) => role.role === "derived").score, 4),
    coverage: round(score.overallCoverage),
    disciplines: disciplineScores,
    groups,
  },
};
const outputPath = path.resolve(projectDir, outputArg);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(submission, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, overall: submission.scores.overall, disciplines: submission.scores.disciplines, groupCount: Object.keys(groups).length }, null, 2));
