import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const benchmarkDir = path.join(projectDir, "benchmarks", "full-quantity-v0");
const outputDir = path.join(projectDir, "outputs", "full-quantity-v0", "predictions");
const targetText = await fs.readFile(path.join(benchmarkDir, "targets.json"), "utf8");
const catalog = JSON.parse(targetText);
const evidenceText = await fs.readFile(path.join(projectDir, "outputs", "full-quantity-v0", "cad-evidence.json"), "utf8");
const evidence = JSON.parse(evidenceText);
const apiKey = process.env.CAD_BENCH_API_KEY;
const baseUrl = (process.env.CAD_BENCH_BASE_URL ?? "https://api.openai.com").replace(/\/$/, "");
if (!apiKey) throw new Error("CAD_BENCH_API_KEY is required and must not be stored in the repository.");

const group = process.argv.find((value) => value.startsWith("--group="))?.slice("--group=".length) ?? "electrical";
const mode = process.argv.find((value) => value.startsWith("--mode="))?.slice("--mode=".length) ?? "evidence_only";
const model = process.argv.slice(2).find((value) => !value.startsWith("--")) ?? "gpt-5.6-sol";
const reasoningEffort = process.argv.find((value) => value.startsWith("--reasoning="))?.slice("--reasoning=".length) ?? "high";
const electricalDisciplines = new Set(["power-electrical", "fire-low-voltage", "lighting-electrical", "lightning-grounding"]);
const groupDiscipline = {
  power: "power-electrical",
  fire: "fire-low-voltage",
  lighting: "lighting-electrical",
  lightning: "lightning-grounding",
  plumbing: "plumbing-heating",
  plumbing_pipes: "plumbing-heating",
  plumbing_equipment: "plumbing-heating",
  plumbing_fittings: "plumbing-heating",
};
const plumbingSheets = {
  plumbing_pipes: new Set(["给排水管道系统汇总表", "给排水专业刷油保温保护层系统汇总表"]),
  plumbing_equipment: new Set(["给排水设备系统汇总表"]),
  plumbing_fittings: new Set(["给排水管件系统汇总表"]),
};
const selectedTargets = catalog.targets.filter((target) =>
  target.role !== "audit" && (group === "electrical"
    ? electricalDisciplines.has(target.discipline)
    : target.discipline === groupDiscipline[group]
      && (!plumbingSheets[group] || plumbingSheets[group].has(target.sheet))));
if (!selectedTargets.length) throw new Error(`Unknown or empty group: ${group}`);
const selectedDrawingIds = group.startsWith("plumbing")
  ? new Set(["plumbing-cad", "hvac-cad"])
  : new Set(["electrical-cad"]);
const targetTerms = [...new Set(selectedTargets.flatMap((target) =>
  [target.item, target.measurement, ...target.context]
    .flatMap((value) => String(value).match(/[A-Za-z]+\d*|\d+(?:\.\d+)?|[\p{Script=Han}]{2,}/gu) ?? [])
    .filter((term) => term.length >= 2)))];
const evidenceScore = (label) => targetTerms.reduce((score, term) => score + (label.includes(term) ? Math.min(term.length, 8) : 0), 0);
const termsFor = (values) => [...new Set(values.flatMap((value) => {
  const normalized = String(value).replace(/<空>|\s+/g, "");
  const raw = normalized.match(/[A-Za-z]+\d*|\d+(?:\.\d+)?|[\p{Script=Han}]{2,}/gu) ?? [];
  const chineseBigrams = [...normalized.matchAll(/[\p{Script=Han}]{2,}/gu)].flatMap(([text]) =>
    [...text].slice(0, -1).map((character, index, chars) => `${character}${chars[index + 1]}`));
  return [...raw, ...chineseBigrams].filter((term) => term.length >= 2);
}))];
const scoreForTerms = (label, terms) => terms.reduce((score, term) => score + (label.includes(term) ? Math.min(term.length, 8) : 0), 0);
const selectEvidenceRows = (rows, relevantLimit, fallbackLimit) => {
  const fallback = rows.slice(0, fallbackLimit);
  const relevant = rows
    .map((row) => ({ row, score: evidenceScore(row.label) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.row.value - left.row.value)
    .slice(0, relevantLimit)
    .map((item) => item.row);
  return [...new Map([...fallback, ...relevant].map((row) => [row.label, row])).values()];
};
const selectedEvidence = {
  protocol: evidence.protocol,
  drawings: evidence.drawings.filter((drawing) => selectedDrawingIds.has(drawing.id)).map((drawing) => ({
    ...drawing,
    blockLabels: selectEvidenceRows(drawing.blockLabels, 220, 40),
    relevantTexts: selectEvidenceRows(drawing.relevantTexts, 260, 40),
    layers: drawing.layers.filter((layer, index) => index < 40 || evidenceScore(layer.layer) > 0),
  })),
};
const candidateEvidence = selectedTargets.map((target) => {
  const terms = termsFor([target.item, target.measurement, ...target.context]);
  const select = (rows, labelOf, limit) => rows
    .map((row) => ({ row, score: scoreForTerms(labelOf(row), terms) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || (right.row.value ?? right.row.entityCount ?? 0) - (left.row.value ?? left.row.entityCount ?? 0))
    .slice(0, limit)
    .map((item) => ({ ...item.row, relevance: item.score }));
  const drawings = selectedEvidence.drawings;
  return {
    id: target.id,
    blocks: select(drawings.flatMap((drawing) => drawing.blockLabels.map((row) => ({ drawing: drawing.id, ...row }))), (row) => row.label, 5),
    texts: select(drawings.flatMap((drawing) => drawing.relevantTexts.map((row) => ({ drawing: drawing.id, ...row }))), (row) => row.label, 5),
    layers: select(drawings.flatMap((drawing) => drawing.layers.map((row) => ({ drawing: drawing.id, ...row }))), (row) => row.layer, 4),
  };
});
const targetHash = (await fs.readFile(path.join(benchmarkDir, "targets.sha256"), "utf8")).split(/\s+/)[0];
const evidenceHash = crypto.createHash("sha256").update(evidenceText).digest("hex");

const modeRule = mode.startsWith("closed")
  ? "闭集尽量全覆盖：每个目标都返回非负数值。证据不足时可利用同一CAD内的图层、图块、文字、几何长度以及目标之间的工程关系作保守估计，但不得使用标准答案或外部同类项目数量。"
  : "严格证据模式：只有CAD证据足以支撑时才返回数值；无法可靠映射时返回null，禁止用典型项目数量猜测。";
const systemPrompt = `你是建筑机电CAD工程量预测器。${modeRule}
输入仅包含冻结的目标目录和从DWG模型空间提取的证据，不包含广联达真值。
数量目标必须输出整数；长度、面积、体积最多保留3位小数；所有数值必须非负。
图块/文字可能包含图例、系统图和外部参照重复，图层也可能错误，必须避免明显重复计数。
LINE/LWPOLYLINE长度是按图层汇总的CAD弦长，只能在语义匹配后用于相应管线目标。
Derived目标可由已判断的Core几何或数量关系推导。
只返回JSON对象：{"predictions":[{"id":"完整目标ID","value":数值或null,"confidence":0到1,"basis":"不超过60字"}]}。
必须为输入中的每个目标ID返回一次且仅一次，不要输出输入外ID。`;
const userPayload = {
  benchmark: "full-quantity-v0",
  group,
  mode,
  targets: selectedTargets.map(({ id, disciplineLabel, sheet, context, item, measurement, unit, role }) =>
    ({ id, disciplineLabel, sheet, context, item, measurement, unit, role,
      ...(mode === "closed_retrieval"
        ? { candidates: candidateEvidence.find((candidate) => candidate.id === id) }
        : {}) })),
  cadEvidence: selectedEvidence,
};
const payload = {
  model,
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: JSON.stringify(userPayload) },
  ],
  temperature: 0,
  max_tokens: 16000,
  response_format: { type: "json_object" },
  reasoning_effort: reasoningEffort,
};
const startedAt = Date.now();
const response = await fetch(`${baseUrl}/v1/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
  body: JSON.stringify(payload),
});
const bodyText = await response.text();
if (!response.ok) throw new Error(`${model}/${group}/${mode} failed (${response.status}): ${bodyText.slice(0, 1000)}`);
const body = JSON.parse(bodyText);
const content = body.choices?.[0]?.message?.content;
const rawContent = Array.isArray(content)
  ? content.map((item) => typeof item === "string" ? item : item?.text ?? "").join("")
  : String(content ?? "");
// Some OpenAI-compatible gateways/models wrap JSON in a Markdown fence even
// when response_format=json_object is requested. Accept that harmless variant
// while keeping malformed or non-JSON responses as hard failures.
const jsonContent = rawContent.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
const parsed = JSON.parse(jsonContent);
const targetMap = new Map(selectedTargets.map((target) => [target.id, target]));
const returned = new Map();
for (const item of parsed.predictions ?? []) {
  if (!targetMap.has(item.id) || returned.has(item.id)) continue;
  const target = targetMap.get(item.id);
  let value = typeof item.value === "number" && Number.isFinite(item.value) ? Math.max(0, item.value) : null;
  if (value != null) value = target.unit === "个" ? Math.round(value) : Number(value.toFixed(3));
  returned.set(item.id, {
    id: item.id,
    value,
    confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : null,
    basis: String(item.basis ?? "").slice(0, 180),
  });
}
const predictions = selectedTargets.map((target) => returned.get(target.id)
  ?? { id: target.id, value: null, confidence: null, basis: "模型未返回该目标" });
const result = {
  protocol: {
    benchmarkId: "full-quantity-v0",
    caseId: "case-001",
    targetHash,
    evidenceHash,
    truthAccess: "forbidden",
    model,
    group,
    mode,
    reasoningEffort,
    elapsedMs: Date.now() - startedAt,
  },
  usage: body.usage ?? null,
  predictions,
};
await fs.mkdir(outputDir, { recursive: true });
const safeModel = model.replace(/[^a-zA-Z0-9._-]/g, "_");
const outputPath = path.join(outputDir, `${safeModel}--${mode}--${group}.json`);
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, targets: selectedTargets.length, predicted: predictions.filter((item) => item.value != null).length, elapsedMs: result.protocol.elapsedMs, usage: result.usage }, null, 2));
