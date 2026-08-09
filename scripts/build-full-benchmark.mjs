import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(projectDir, "config", "full-quantity-v0.json");
const config = JSON.parse(await fs.readFile(configPath, "utf8"));
const publicDir = path.join(projectDir, "benchmarks", config.id);
const privateDir = path.join(projectDir, "data", "private", config.caseId, config.id);
const resolveFromConfig = (relativePath) => path.resolve(path.dirname(configPath), relativePath);
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const anonymizeItem = (value) => String(value ?? "")
  .replace(/[（(]\s*\d{1,3}-\d{1,3}#?\s*[）)]/g, "(CASE-001)")
  .replace(/\b\d{1,3}-\d{1,3}#(?=[^0-9]|$)/g, "CASE-001");

const columnName = (zeroBasedIndex) => {
  let value = zeroBasedIndex + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
};

const inferMetric = (headers, row, columnIndex) =>
  headers[1] === "工程量名称" && columnIndex === 3
    ? String(row[1] ?? "工程量")
    : String(headers[columnIndex] ?? "工程量");

const inferUnit = (headers, row, columnIndex, metric) => {
  if (headers[1] === "工程量名称" && columnIndex === 3) return String(row[2] ?? "");
  const match = metric.match(/\((m2|m3|m|个)\)$/i);
  return match?.[1] ?? "";
};

const primaryExclusions = config.evaluation.primaryExclusionPatterns.map((pattern) => new RegExp(pattern));
const derivedPatterns = config.evaluation.derivedMeasurementPatterns.map((pattern) => new RegExp(pattern));
const derivedUnits = new Set(config.evaluation.derivedUnits);
const targets = [];
const truthTargets = [];
const disciplineSummary = [];
let detailRowCount = 0;

for (const workbookConfig of config.workbooks) {
  const workbookPath = resolveFromConfig(workbookConfig.path);
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
  let disciplineRows = 0;
  let disciplineTargets = 0;
  let disciplinePrimaryTargets = 0;

  for (let sheetIndex = 0; sheetIndex < workbook.worksheets.items.length; sheetIndex += 1) {
    const sheet = workbook.worksheets.items[sheetIndex];
    const values = sheet.getUsedRange(true).values;
    const headers = values[0] ?? [];
    let context = [];
    let pendingHeadings = [];

    for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
      const row = values[rowIndex] ?? [];
      const numericColumns = row
        .map((value, columnIndex) => ({ value, columnIndex }))
        .filter(({ value, columnIndex }) => columnIndex > 0 && isNumber(value));
      if (!numericColumns.length) {
        const texts = row.filter((value) => typeof value === "string" && value.trim());
        if (texts.length && new Set(texts).size === 1) pendingHeadings.push(anonymizeItem(texts[0]).trim());
        continue;
      }
      if (pendingHeadings.length) {
        const prefixLength = Math.max(0, context.length - pendingHeadings.length);
        context = [...context.slice(0, prefixLength), ...pendingHeadings];
        pendingHeadings = [];
      }
      detailRowCount += 1;
      disciplineRows += 1;

      for (const { value, columnIndex } of numericColumns) {
        const measurement = inferMetric(headers, row, columnIndex);
        const unit = inferUnit(headers, row, columnIndex, measurement);
        const role = primaryExclusions.some((pattern) => pattern.test(measurement))
          ? "audit"
          : derivedUnits.has(unit) || derivedPatterns.some((pattern) => pattern.test(measurement))
            ? "derived"
            : "core";
        const id = [
          config.caseId,
          workbookConfig.discipline,
          `s${sheetIndex + 1}`,
          `r${rowIndex + 1}`,
          `c${columnIndex + 1}`,
        ].join(":");
        const target = {
          id,
          caseId: config.caseId,
          split: config.split,
          discipline: workbookConfig.discipline,
          disciplineLabel: workbookConfig.label,
          sheet: sheet.name,
          context,
          item: anonymizeItem(row[0]).trim(),
          measurement,
          unit,
          role,
          sourceCell: `${columnName(columnIndex)}${rowIndex + 1}`,
        };
        targets.push(target);
        truthTargets.push({ ...target, value });
        disciplineTargets += 1;
        if (role !== "audit") disciplinePrimaryTargets += 1;
      }
    }
  }

  disciplineSummary.push({
    discipline: workbookConfig.discipline,
    label: workbookConfig.label,
    detailRows: disciplineRows,
    scalarTargets: disciplineTargets,
    scoredTargets: disciplinePrimaryTargets,
  });
}

const countBy = (items, key) => Object.fromEntries(
  [...items.reduce((map, item) => map.set(item[key], (map.get(item[key]) ?? 0) + 1), new Map())]
    .sort(([left], [right]) => String(left).localeCompare(String(right))),
);
const scoredTargets = targets.filter((target) => target.role !== "audit");
const coreTargets = targets.filter((target) => target.role === "core");
const derivedTargets = targets.filter((target) => target.role === "derived");
const frozenInputs = [];
for (const input of config.inputs) {
  const bytes = await fs.readFile(resolveFromConfig(input.path));
  frozenInputs.push({ id: input.id, usedBy: input.usedBy, bytes: bytes.byteLength, sha256: sha256(bytes) });
}
const summary = {
  benchmark: { id: config.id, title: config.title, caseId: config.caseId, split: config.split },
  scope: {
    workbookCount: config.workbooks.length,
    cadInputCount: frozenInputs.length,
    sheetCount: new Set(targets.map((target) => `${target.discipline}:${target.sheet}`)).size,
    detailRows: detailRowCount,
    scalarTargets: targets.length,
    scoredTargets: scoredTargets.length,
    coreTargets: coreTargets.length,
    derivedTargets: derivedTargets.length,
    auditTargets: targets.length - scoredTargets.length,
  },
  byDiscipline: disciplineSummary,
  frozenInputs,
  byUnit: countBy(targets, "unit"),
  scoredByUnit: countBy(scoredTargets, "unit"),
  coreByUnit: countBy(coreTargets, "unit"),
  derivedByUnit: countBy(derivedTargets, "unit"),
  scoring: {
    defaultRoles: ["core", "derived"],
    roleWeights: config.evaluation.roleWeights,
    absoluteTolerances: config.evaluation.absoluteTolerances,
    relativeTolerance: config.evaluation.relativeTolerance,
    aggregateAcrossUnits: config.evaluation.aggregateAcrossUnits,
    metrics: config.evaluation.metrics,
  },
};
const publicManifest = {
  protocol: {
    truthAccess: "forbidden",
    targetCatalogAccess: "allowed",
    predictionMustBeFrozenBeforeScoring: true,
  },
  ...summary,
};
const truthDocument = { protocol: { benchmarkId: config.id, private: true }, summary, targets: truthTargets };
const truthText = `${JSON.stringify(truthDocument, null, 2)}\n`;
const targetText = `${JSON.stringify({ protocol: publicManifest.protocol, targets }, null, 2)}\n`;
const targetHash = sha256(targetText);
publicManifest.protocol.targetHash = targetHash;
const predictionTemplate = {
  protocol: {
    benchmarkId: config.id,
    caseId: config.caseId,
    targetHash,
    truthAccess: "forbidden",
  },
  predictions: targets.map(({ id }) => ({ id, value: null })),
};

await fs.mkdir(publicDir, { recursive: true });
await fs.mkdir(privateDir, { recursive: true });
await Promise.all([
  fs.writeFile(path.join(publicDir, "manifest.json"), `${JSON.stringify(publicManifest, null, 2)}\n`),
  fs.writeFile(path.join(publicDir, "targets.json"), targetText),
  fs.writeFile(path.join(publicDir, "prediction-template.json"), `${JSON.stringify(predictionTemplate, null, 2)}\n`),
  fs.writeFile(path.join(publicDir, "targets.sha256"), `${targetHash}  targets.json\n`),
  fs.writeFile(path.join(publicDir, "truth.sha256"), `${sha256(truthText)}  private/truth.json\n`),
  fs.writeFile(path.join(privateDir, "truth.json"), truthText),
]);

console.log(JSON.stringify(summary, null, 2));
