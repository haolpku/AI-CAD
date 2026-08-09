import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const benchmarkDir = path.join(projectDir, "benchmarks", "full-quantity-v0");
const outputDir = path.join(projectDir, "outputs", "full-quantity-v0", "hybrid-mappings-v1");
const catalog = JSON.parse(await fs.readFile(path.join(benchmarkDir, "targets.json"), "utf8"));
const evidenceArg = process.argv.find((value) => value.startsWith("--evidence="))?.slice("--evidence=".length)
  ?? "outputs/full-quantity-v0/hybrid-evidence-v1.json";
const evidence = JSON.parse(await fs.readFile(path.resolve(projectDir, evidenceArg), "utf8"));
const apiKey = process.env.CAD_BENCH_API_KEY;
const baseUrl = (process.env.CAD_BENCH_BASE_URL ?? "https://api.openai.com").replace(/\/$/, "");
if (!apiKey) throw new Error("CAD_BENCH_API_KEY is required and must not be stored in the repository.");

const group = process.argv.find((value) => value.startsWith("--group="))?.slice("--group=".length) ?? "lighting";
const model = process.argv.slice(2).find((value) => !value.startsWith("--")) ?? "gpt-5.6-sol";
const reasoningEffort = process.argv.find((value) => value.startsWith("--reasoning="))?.slice("--reasoning=".length) ?? "medium";
const tag = process.argv.find((value) => value.startsWith("--tag="))?.slice("--tag=".length) ?? "";
const groupDiscipline = {
  power: "power-electrical",
  fire: "fire-low-voltage",
  lighting: "lighting-electrical",
  lightning: "lightning-grounding",
  plumbing_pipes: "plumbing-heating",
  plumbing_equipment: "plumbing-heating",
  plumbing_fittings: "plumbing-heating",
};
const plumbingSheets = {
  plumbing_pipes: new Set(["给排水管道系统汇总表"]),
  plumbing_equipment: new Set(["给排水设备系统汇总表"]),
  plumbing_fittings: new Set(["给排水管件系统汇总表"]),
};
const targets = catalog.targets.filter((target) =>
  target.role === "core"
  && target.discipline === groupDiscipline[group]
  && ["个", "m"].includes(target.unit)
  && (!plumbingSheets[group] || plumbingSheets[group].has(target.sheet)));
if (!targets.length) throw new Error(`Unknown or empty group: ${group}`);
const drawingIds = group.startsWith("plumbing") ? new Set(["plumbing-cad", "hvac-cad"]) : new Set(["electrical-cad"]);
const drawings = evidence.drawings.filter((drawing) => drawingIds.has(drawing.id));
const blockEvidence = drawings.flatMap((drawing) => drawing.blocks.map((item) => ({ drawing: drawing.id, ...item })));
const excludedRouteLayer = /(?:Project|图框|TITLE|TEXT|DOTE|WALL|COLUMN|STAIR|AXIS|PUB_|BOUNDARY|DIM)/i;
const electricalRouteLayer = /(?:WIRE|CABLE|BRIDGE|TEL|SIG|电|线|桥架|照明|动力|消防|防雷|接地)/i;
const plumbingRouteLayer = /(?:P-|M-|PIPE|WATR|DRAI|PLUM|给排水|水管|采暖|冷热水|冷凝水)/i;
const routeEvidence = drawings.flatMap((drawing) => drawing.routes
  .filter((item) => !excludedRouteLayer.test(item.layer)
    && (group.startsWith("plumbing") ? plumbingRouteLayer.test(item.layer) : electricalRouteLayer.test(item.layer)))
  .map((item) => ({ drawing: drawing.id, ...item })));
const stopTerms = new Set(["数量", "合计", "长度", "工程量", "汇总", "系统", "管道", "设备", "管件", "小计", "含预留", "空"]);
const termsFor = (target) => {
  const text = [target.item, ...target.context].join(" ")
    .replace(/<空>|CASE-001/gi, " ")
    .replace(/[()（）]/g, " ");
  const raw = text.match(/[A-Za-z]+\d*(?:[-+*xX]\d+)*|\d+(?:\.\d+)?|[\p{Script=Han}]{2,}/gu) ?? [];
  const bigrams = [...text.matchAll(/[\p{Script=Han}]{2,}/gu)].flatMap(([part]) =>
    [...part].slice(0, -1).map((character, index, characters) => `${character}${characters[index + 1]}`));
  return [...new Set([...raw, ...bigrams]
    .map((term) => term.toUpperCase())
    .filter((term) => term.length >= 2 && !stopTerms.has(term)))];
};
const relevance = (text, terms) => {
  const normalized = String(text).toUpperCase().replace(/\s+/g, "");
  return terms.reduce((score, term) => score + (normalized.includes(term.replace(/\s+/g, "")) ? Math.min(term.length, 12) : 0), 0);
};
const candidatesFor = (target) => {
  const terms = termsFor(target);
  const source = target.unit === "个" ? blockEvidence : routeEvidence;
  const textOf = target.unit === "个"
    ? (item) => `${item.semantic} ${item.layer} ${item.sheetTitles.map((row) => row.title).join(" ")}`
    : (item) => `${item.layer} ${item.nearbyAnnotations.map((row) => row.text).join(" ")}`;
  return source.map((item) => ({ item, score: relevance(textOf(item), terms) }))
    .filter(({ item, score }) => score > 0 && (target.unit === "个" ? item.planCount > 0 : item.planLengthM > 0))
    .sort((left, right) => right.score - left.score
      || (target.unit === "个" ? right.item.planCount - left.item.planCount : right.item.planLengthM - left.item.planLengthM))
    .slice(0, 10)
    .map(({ item, score }) => target.unit === "个"
      ? { id: item.id, drawing: item.drawing, label: item.label, relevance: score, planCount: item.planCount, systemCount: item.systemCount, legendCount: item.legendCount, unknownCount: item.unknownCount, sheetTitles: item.sheetTitles }
      : { id: item.id, drawing: item.drawing, layer: item.layer, relevance: score, planLengthM: item.planLengthM, componentCount: item.componentCount, danglingEndpointCount: item.danglingEndpointCount, nearbyAnnotations: item.nearbyAnnotations });
};
const targetPayload = targets.map(({ id, disciplineLabel, sheet, context, item, measurement, unit }) => ({
  id, disciplineLabel, sheet, context, item, measurement, unit,
  evidenceType: unit === "个" ? "block" : "route",
  candidates: candidatesFor({ id, disciplineLabel, sheet, context, item, measurement, unit }),
}));
const allowedEvidence = new Map(targetPayload.map((target) => [target.id, new Set(target.candidates.map((candidate) => candidate.id))]));
const systemPrompt = `你是CAD工程量语义映射器，不是数值预测器。
对每个目标，只能从其 candidates 中选择真正代表该工程量的证据ID。
数量目标只选 block；长度目标只选 route。需合并多个同类证据时可选多个ID。
严禁生成、修改、估算或缩放任何工程量数字。如果候选证据不足或可能把图例/系统图当成平面实体，返回 none。
只返回JSON：{"mappings":[{"id":"目标ID","evidenceType":"block|route|none","evidenceIds":[],"confidence":0到1,"basis":"不超过60字"}]}。`;
const request = {
  model,
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: JSON.stringify({ benchmark: "full-quantity-v0", group, targets: targetPayload }) },
  ],
  temperature: 0,
  max_tokens: 12000,
  response_format: { type: "json_object" },
  reasoning_effort: reasoningEffort,
};
const startedAt = Date.now();
const response = await fetch(`${baseUrl}/v1/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
  body: JSON.stringify(request),
});
const responseText = await response.text();
if (!response.ok) throw new Error(`${model}/${group} failed (${response.status}): ${responseText.slice(0, 1000)}`);
const body = JSON.parse(responseText);
const rawContent = body.choices?.[0]?.message?.content;
const content = (Array.isArray(rawContent)
  ? rawContent.map((item) => typeof item === "string" ? item : item?.text ?? "").join("")
  : String(rawContent ?? "")).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
const parsed = JSON.parse(content);
const targetMap = new Map(targets.map((target) => [target.id, target]));
const seen = new Set();
const mappings = [];
for (const mapping of parsed.mappings ?? []) {
  if (!targetMap.has(mapping.id) || seen.has(mapping.id)) continue;
  seen.add(mapping.id);
  const target = targetMap.get(mapping.id);
  const expectedType = target.unit === "个" ? "block" : "route";
  const evidenceIds = [...new Set((mapping.evidenceIds ?? []).filter((id) => allowedEvidence.get(mapping.id).has(id)))];
  const evidenceType = mapping.evidenceType === expectedType && evidenceIds.length ? expectedType : "none";
  mappings.push({
    id: mapping.id,
    evidenceType,
    evidenceIds: evidenceType === "none" ? [] : evidenceIds,
    confidence: Number.isFinite(Number(mapping.confidence)) ? Math.max(0, Math.min(1, Number(mapping.confidence))) : 0,
    basis: String(mapping.basis ?? "").slice(0, 180),
  });
}
for (const target of targets) {
  if (!seen.has(target.id)) mappings.push({ id: target.id, evidenceType: "none", evidenceIds: [], confidence: 0, basis: "模型未返回映射" });
}
const result = {
  protocol: { benchmarkId: "full-quantity-v0", caseId: "case-001", version: tag ? `semantic-map-${tag}` : "semantic-map-v1", evidence: evidenceArg, truthAccess: "forbidden", model, group, reasoningEffort, elapsedMs: Date.now() - startedAt },
  usage: body.usage ?? null,
  mappings,
};
await fs.mkdir(outputDir, { recursive: true });
const safeModel = model.replace(/[^a-zA-Z0-9._-]/g, "_");
const outputPath = path.join(outputDir, `${safeModel}--${group}${tag ? `--${tag}` : ""}.json`);
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, targets: targets.length, mapped: mappings.filter((mapping) => mapping.evidenceType !== "none").length, elapsedMs: result.protocol.elapsedMs, usage: result.usage }, null, 2));
