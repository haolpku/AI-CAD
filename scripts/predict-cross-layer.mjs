import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const experimentDir = path.join(projectDir, "experiments", "llm-mapping-v0");
const input = JSON.parse(await fs.readFile(path.join(experimentDir, "input-all-layers.json"), "utf8"));
const config = JSON.parse(await fs.readFile(path.join(projectDir, "config", "lighting-cross-layer-rules-v0.json"), "utf8"));
const values = Object.fromEntries(config.rules.map((rule) => [rule.id, 0]));
const assignments = [];

for (const source of input.cadEvidence.sourceLabels) {
  const matched = config.rules.find((rule) => rule.patterns.some((pattern) => new RegExp(pattern).test(source.label)));
  assignments.push({
    source_label: source.label,
    target_id: matched?.id ?? null,
    confidence: matched ? 1 : null,
    reason: matched ? "版本化闭集语义规则" : "未命中目标类别规则"
  });
  if (matched) values[matched.id] += source.count;
}

const output = {
  protocol: {
    model: "deterministic-hybrid",
    mode: "cross-layer-semantic",
    truthAccess: "forbidden",
    retrievalMode: input.protocol.retrievalMode
  },
  assignments,
  values
};
await fs.writeFile(
  path.join(experimentDir, "all-layers--deterministic-hybrid--cross-layer-semantic.json"),
  `${JSON.stringify(output, null, 2)}\n`
);
console.log(JSON.stringify(values));
