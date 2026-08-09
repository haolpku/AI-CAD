import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputArg = process.argv.find((value) => value.startsWith("--input="))?.slice("--input=".length);
const outputArg = process.argv.find((value) => value.startsWith("--output="))?.slice("--output=".length);
const projectGroup = process.argv.find((value) => value.startsWith("--project-group="))?.slice("--project-group=".length);
if (!inputArg || !projectGroup) throw new Error("Required: --input=/path/to/project.GQI4 --project-group=stable-project-id");
const inputPath = path.resolve(inputArg);
const inputBytes = await fs.readFile(inputPath);
const sourceProjectHash = crypto.createHash("sha256").update(inputBytes).digest("hex");
const sourceProjectGroupHash = crypto.createHash("sha256").update(projectGroup).digest("hex");
const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), "aicad-experience-"));
const outputPath = outputArg
  ? path.resolve(outputArg)
  : path.join(projectDir, "data", "private", "experience-candidates", `${sourceProjectHash.slice(0, 16)}.json`);

const normalizeTemplate = (value) => String(value ?? "")
  .replace(/\d{1,3}-\d{1,3}#?/g, "{building}")
  .replace(/\d+(?:\.\d+)?/g, "{n}")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 160);
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed: ${(result.stderr || result.stdout).slice(0, 500)}`);
  return result.stdout;
};

try {
  run("bsdtar", ["-xf", inputPath, "-C", temporaryDir]);
  const cloudPath = path.join(temporaryDir, "cloudInput.db");
  const quantityPath = path.join(temporaryDir, "GQIQty.db");
  const propertyRows = JSON.parse(run("sqlite3", ["-json", cloudPath, "select ElementTypeID, SubTypeID, Code, Value from CADInfoPropDict;"]) || "[]");
  const schemaRows = JSON.parse(run("sqlite3", ["-json", quantityPath, "select name, sql from sqlite_master where type='table' order by name;"]) || "[]");
  const propertyFamilies = new Map();
  for (const row of propertyRows) {
    const code = String(row.Code ?? "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80);
    const template = normalizeTemplate(row.Value);
    if (!code || !template) continue;
    const entry = propertyFamilies.get(code) ?? { code, elementTypeCount: new Set(), subtypeCount: new Set(), templates: new Set() };
    entry.elementTypeCount.add(String(row.ElementTypeID));
    entry.subtypeCount.add(`${row.ElementTypeID}:${row.SubTypeID}`);
    entry.templates.add(template);
    propertyFamilies.set(code, entry);
  }
  const expressionFields = [...new Set(schemaRows.flatMap((row) =>
    [...String(row.sql ?? "").matchAll(/\[?([A-Za-z][A-Za-z0-9_]*)Expr\]?/g)].map((match) => match[1])))].sort();
  const candidate = {
    version: "gqi-experience-candidate-v0",
    tier: "T1-candidate",
    protocol: {
      containsProjectAnswers: false,
      exportsQuantityValues: false,
      benchmarkTruthAccess: "forbidden",
      inferenceEligible: false,
      heldoutValidated: false,
      supportProjectCount: 1,
    },
    provenance: { sourceArchiveHash: sourceProjectHash, sourceProjectGroupHash },
    propertyFamilies: [...propertyFamilies.values()].map((entry) => ({
      code: entry.code,
      elementTypeCount: entry.elementTypeCount.size,
      subtypeCount: entry.subtypeCount.size,
      templates: [...entry.templates].sort(),
    })).sort((left, right) => left.code.localeCompare(right.code)),
    quantitySchema: {
      tableNames: schemaRows.map((row) => row.name).filter(Boolean),
      expressionFieldStems: expressionFields,
    },
    promotion: {
      requiredSupportProjectCount: 2,
      requireProjectLevelHoldout: true,
      status: "blocked-until-cross-project-validation",
    },
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(candidate, null, 2)}\n`);
  console.log(JSON.stringify({ outputPath, tier: candidate.tier, inferenceEligible: false, propertyFamilyCount: candidate.propertyFamilies.length, expressionFieldCount: expressionFields.length }, null, 2));
} finally {
  await fs.rm(temporaryDir, { recursive: true, force: true });
}
