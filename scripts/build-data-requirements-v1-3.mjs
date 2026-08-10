import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const benchmarkDir = path.join(projectDir, "benchmarks", "full-quantity-v0");
const targets = JSON.parse(await fs.readFile(path.join(benchmarkDir, "targets.json"), "utf8"));
const recipes = JSON.parse(await fs.readFile(path.join(projectDir, "experience-base", "requirement-recipes-v1.json"), "utf8"));

const classify = (target) => {
  const context = target.context.join(" ");
  if (target.role === "audit") return "audit-total";
  if (/线缆端头/.test(target.measurement)) return "terminal-count";
  if (/断接卡子/.test(target.measurement)) return "route-attachment-count";
  if (target.discipline === "lightning-grounding" && target.unit === "m") return "grounding-route-length";
  if (/保温体积/.test(target.measurement)) return "insulation-volume";
  if (/保护层面积/.test(target.measurement)) return "protective-area";
  if (/表面积/.test(target.measurement)) return "surface-area";
  if (target.sheet === "给排水管件系统汇总表") return "fitting-count";
  if (["给排水设备系统汇总表", "电气设备工程量汇总表", "消防设备工程量汇总表"].includes(target.sheet)) return "device-count";
  if (target.sheet === "给排水管道系统汇总表") return "pipe-length";
  if (/电气管线工程量汇总表/.test(target.sheet)) {
    if (/电线|电缆/.test(context) || /线缆/.test(target.measurement)) return "conductor-length";
    return "conduit-length";
  }
  return target.unit === "个" ? "device-count" : "pipe-length";
};
const targetRequirements = targets.targets.map((target) => {
  const targetType = classify(target);
  const recipe = recipes.recipes[targetType];
  if (!recipe) throw new Error(`Missing recipe for ${targetType}`);
  return {
    id: target.id,
    role: target.role,
    discipline: target.discipline,
    unit: target.unit,
    targetType,
    required: recipe.required,
    optional: recipe.optional,
    negativeEvidence: recipe.negativeEvidence,
    formula: recipe.formula,
  };
});
const typeCounts = targetRequirements.reduce((result, target) => {
  result[target.targetType] = (result[target.targetType] ?? 0) + 1;
  return result;
}, {});
const result = {
  protocol: {
    benchmarkId: "full-quantity-v0",
    version: "data-requirements-v1.3",
    truthAccess: "forbidden",
    containsQuantityValues: false,
    source: "public target catalog + versioned experience recipes",
  },
  summary: {
    catalogTargetCount: targetRequirements.length,
    scoredTargetCount: targetRequirements.filter((target) => target.role !== "audit").length,
    typeCounts,
  },
  targets: targetRequirements,
};
await fs.writeFile(path.join(benchmarkDir, "data-requirements-v1-3.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result.summary, null, 2));
