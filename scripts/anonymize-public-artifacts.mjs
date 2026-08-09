import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const experimentDir = path.join(projectDir, "experiments", "llm-mapping-v0");
const inputPath = path.join(experimentDir, "input-all-layers.json");
const publicInput = await fs.readFile(inputPath, "utf8");
const publicInputHash = crypto.createHash("sha256").update(publicInput).digest("hex");

const anonymize = (value) => {
  if (typeof value === "string") {
    return value
      .replace(/^[\p{Script=Han}]+\s*\d{1,3}-\d{1,3}#?$/u, "Case-001")
      .replace(/^\d{1,3}-\d{1,3}(?=[-#])/g, "CASE-001");
  }
  if (Array.isArray(value)) return value.map(anonymize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, anonymize(item)]));
  }
  return value;
};

const files = (await fs.readdir(experimentDir))
  .filter((name) => name.startsWith("all-layers") && name.includes("--") && name.endsWith(".json"));

for (const file of files) {
  const filePath = path.join(experimentDir, file);
  const artifact = anonymize(JSON.parse(await fs.readFile(filePath, "utf8")));
  artifact.protocol ??= {};
  if (artifact.protocol.inputHash && artifact.protocol.inputHash !== publicInputHash) {
    artifact.protocol.sourceInputHash = artifact.protocol.inputHash;
  }
  artifact.protocol.inputHash = publicInputHash;
  artifact.protocol.anonymizedForPublication = true;
  await fs.writeFile(filePath, `${JSON.stringify(artifact, null, 2)}\n`);
}

console.log(JSON.stringify({ files: files.length, publicInputHash }));
