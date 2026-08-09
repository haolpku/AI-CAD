import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const experimentDir = path.join(projectDir, "experiments", "route-length-v0");
const prediction = JSON.parse(await fs.readFile(path.join(experimentDir, "prediction.json"), "utf8"));
const workbookPath = path.join(projectDir, "data", "private", "case-001", "lighting.xlsx");
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
const rows = workbook.worksheets.getItem("电气管线工程量汇总表").getUsedRange(true).values;
const findValue = (itemPattern, measurePattern) => rows
  .filter((row) => itemPattern.test(String(row[0] ?? "")) && measurePattern.test(String(row[1] ?? "")))
  .reduce((sum, row) => sum + (Number(row.at(-1)) || 0), 0);

const truth = {
  pvc20M: findValue(/^PVC-20$/, /^长度合计/),
  steel20M: findValue(/^焊接钢管-20$/, /^长度合计/),
  nhBv25M: findValue(/NH-BV2\.5/, /^线\/缆合计/),
  zrBv25M: findValue(/ZR-BV2\.5/, /^线\/缆合计/)
};
truth.pooledPipeM = truth.pvc20M + truth.steel20M;
const predicted = prediction.pooledLightingRoute.valueM;
const report = {
  protocol: {predictionTruthAccess: prediction.protocol.truthAccess, scoreReadsTruthAfterPrediction: true},
  pooledPipe: {
    truthM: truth.pooledPipeM,
    predictedRouteM: predicted,
    errorM: predicted - truth.pooledPipeM,
    absolutePercentageError: Math.abs(predicted - truth.pooledPipeM) / truth.pooledPipeM
  },
  diagnosticOnly: {
    emergencyWirePerRouteRatio: truth.nhBv25M / prediction.layerLengthsM["WIRE-应急"],
    normalWirePerRouteRatio: truth.zrBv25M / prediction.layerLengthsM["WIRE-照明"],
    note: "这些比率仅用于解释，未反馈给预测器。"
  },
  truth
};
await fs.writeFile(path.join(experimentDir, "score.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
