import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputArgs = process.argv.filter((value) => value.startsWith("--input=")).map((value) => value.slice("--input=".length));
const tag = process.argv.find((value) => value.startsWith("--tag="))?.slice("--tag=".length) ?? "merged";
if (!inputArgs.length) throw new Error("Pass at least one --input=path.");
const documents = await Promise.all(inputArgs.map(async (input) => JSON.parse(await fs.readFile(path.resolve(projectDir, input), "utf8"))));
const targetHash = documents[0].protocol.targetHash;
if (documents.some((document) => document.protocol.targetHash !== targetHash)) throw new Error("Target hashes do not match.");
const predictions = documents.flatMap((document) => document.predictions);
if (new Set(predictions.map((item) => item.id)).size !== predictions.length) throw new Error("Merged predictions contain duplicate IDs.");
const result = {
  protocol: {
    benchmarkId: "full-quantity-v0",
    caseId: "case-001",
    targetHash,
    truthAccess: "forbidden",
    sources: documents.map((document) => document.protocol),
  },
  predictions,
};
const outputPath = path.join(projectDir, "outputs", "full-quantity-v0", "predictions", `${tag}.json`);
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, predictions: predictions.length }));
