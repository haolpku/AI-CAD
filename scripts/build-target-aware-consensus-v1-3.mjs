import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mappingDir = path.join(projectDir, "outputs", "full-quantity-v0", "hybrid-mappings-v1");
const model = process.argv.find((value) => value.startsWith("--model="))?.slice("--model=".length) ?? "gpt-5.6-sol";
const groups = ["power", "fire", "lighting", "lightning", "plumbing_equipment", "plumbing_fittings"];
const summary = [];
for (const group of groups) {
  const v12 = JSON.parse(await fs.readFile(path.join(mappingDir, `${model}--${group}--v1-2.json`), "utf8"));
  const v13 = JSON.parse(await fs.readFile(path.join(mappingDir, `${model}--${group}--v1-3.json`), "utf8"));
  const v13ByTarget = new Map(v13.mappings.map((mapping) => [mapping.id, mapping]));
  const mappings = v12.mappings.map((mapping) => {
    const verifier = v13ByTarget.get(mapping.id);
    const selected = [...(mapping.evidenceIds ?? [])].sort();
    const verified = [...(verifier?.evidenceIds ?? [])].sort();
    const agrees = mapping.evidenceType !== "none"
      && mapping.evidenceType === verifier?.evidenceType
      && JSON.stringify(selected) === JSON.stringify(verified);
    return agrees ? {
      ...mapping,
      confidence: Math.min(mapping.confidence, verifier.confidence),
      basis: `v1.2/v1.3 consensus: ${mapping.basis}`,
    } : {
      id: mapping.id,
      evidenceType: "none",
      evidenceIds: [],
      confidence: 0,
      basis: "v1.2/v1.3 disagreement or abstention",
    };
  });
  const output = {
    protocol: {
      benchmarkId: "full-quantity-v0",
      caseId: "case-001",
      version: "target-aware-consensus-v1.3",
      truthAccess: "forbidden",
      model,
      group,
      sources: [v12.protocol.version, v13.protocol.version],
    },
    mappings,
  };
  await fs.writeFile(path.join(mappingDir, `${model}--${group}--v1-3-consensus.json`), `${JSON.stringify(output, null, 2)}\n`);
  summary.push({ group, agreedMappings: mappings.filter((mapping) => mapping.evidenceType !== "none").length });
}
console.log(JSON.stringify(summary, null, 2));
