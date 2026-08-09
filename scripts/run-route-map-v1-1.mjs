import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const benchmarkDir = path.join(projectDir, "benchmarks", "full-quantity-v0");
const catalog = JSON.parse(await fs.readFile(path.join(benchmarkDir, "targets.json"), "utf8"));
const evidence = JSON.parse(await fs.readFile(path.join(projectDir, "outputs", "full-quantity-v0", "route-segments-v1-1.json"), "utf8"));
const apiKey = process.env.CAD_BENCH_API_KEY;
const baseUrl = (process.env.CAD_BENCH_BASE_URL ?? "https://api.openai.com").replace(/\/$/, "");
if (!apiKey) throw new Error("CAD_BENCH_API_KEY is required and must not be stored in the repository.");
const model = process.argv.slice(2).find((value) => !value.startsWith("--")) ?? "gpt-5.6-sol";
const reasoningEffort = process.argv.find((value) => value.startsWith("--reasoning="))?.slice("--reasoning=".length) ?? "medium";
const targets = catalog.targets.filter((target) => target.role === "core" && target.unit === "m" && target.sheet === "给排水管道系统汇总表");
const segments = evidence.drawings.flatMap((drawing) => drawing.segments).filter((segment) => segment.dn != null && segment.lengthM > 0);
const diameter = (item) => Number(String(item).match(/DN\s*(\d+(?:\.\d+)?)/i)?.[1] ?? String(item).match(/[-–](\d+(?:\.\d+)?)\s*$/)?.[1]);
const normalize = (value) => String(value).replace(/<空>|CASE-001|\s+/gi, "").toUpperCase();
const systemAliases = {
  J1: ["加压给水", "低区给水"], J: ["市政给水"], T: ["通气", "污水"], W: ["污水"],
  YW: ["压力污水", "有压污水"], ZJ1: ["加压中水", "低区中水"], ZJ: ["市政中水"],
  HEAT: ["采暖", "市政供水", "市政回水", "低区供水", "低区回水"],
};
const targetSystem = (target) => {
  const context = target.context.join(" ");
  if (/采暖/.test(context)) return "HEAT";
  return Object.keys(systemAliases).sort((left, right) => right.length - left.length).find((key) => new RegExp(`(?:^|[^A-Z])${key}(?:\\d+)?`, "i").test(context)) ?? "";
};
const candidatesFor = (target) => {
  const dn = diameter(target.item); const systemKey = targetSystem(target); const aliases = systemAliases[systemKey] ?? [];
  return segments.filter((segment) => segment.dn === dn).map((segment) => {
    const system = normalize(segment.system);
    const systemScore = aliases.reduce((score, alias) => score + (system.includes(normalize(alias)) ? 20 : 0), 0);
    const directRatio = segment.segmentCount ? segment.directSeedSegmentCount / segment.segmentCount : 0;
    return { segment, score: systemScore + 10 * directRatio + Math.min(segment.seedTexts.length, 5) };
  }).sort((left, right) => right.score - left.score || right.segment.lengthM - left.segment.lengthM).slice(0, 12).map(({ segment, score }) => ({ ...segment, relevance: Number(score.toFixed(3)) }));
};
const targetPayload = targets.map(({ id, context, item, measurement, unit }) => ({ id, context, item, measurement, unit, candidates: candidatesFor({ id, context, item, measurement, unit }) }));
const allowed = new Map(targetPayload.map((target) => [target.id, new Set(target.candidates.map((candidate) => candidate.id))]));
const prompt = `你是给排水CAD管线语义映射器，不得生成工程量数字。
每个候选已由程序按DN文字在拓扑图中分段，lengthM由CAD几何确定性计算。
你只需判断目标系统与候选system/layer是否对应。供水+回水同属一个采暖目标时可选多个。
不得选择DN不同的证据；系统不确定时返回none。
只返回JSON：{"mappings":[{"id":"目标ID","evidenceType":"route-segment|none","evidenceIds":[],"confidence":0到1,"basis":"不超过60字"}]}。`;
const request = { model, messages: [{ role: "system", content: prompt }, { role: "user", content: JSON.stringify({ benchmark: "full-quantity-v0", version: "v1.1", targets: targetPayload }) }], temperature: 0, max_tokens: 8000, response_format: { type: "json_object" }, reasoning_effort: reasoningEffort };
const startedAt = Date.now();
const response = await fetch(`${baseUrl}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify(request) });
const responseText = await response.text();
if (!response.ok) throw new Error(`${model}/route-v1.1 failed (${response.status}): ${responseText.slice(0, 1000)}`);
const body = JSON.parse(responseText); const raw = body.choices?.[0]?.message?.content;
const content = (Array.isArray(raw) ? raw.map((item) => typeof item === "string" ? item : item?.text ?? "").join("") : String(raw ?? "")).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
const parsed = JSON.parse(content); const seen = new Set(); const mappings = [];
for (const mapping of parsed.mappings ?? []) {
  if (!allowed.has(mapping.id) || seen.has(mapping.id)) continue; seen.add(mapping.id);
  const evidenceIds = [...new Set((mapping.evidenceIds ?? []).filter((id) => allowed.get(mapping.id).has(id)))];
  const evidenceType = mapping.evidenceType === "route-segment" && evidenceIds.length ? "route-segment" : "none";
  mappings.push({ id: mapping.id, evidenceType, evidenceIds: evidenceType === "none" ? [] : evidenceIds, confidence: Number.isFinite(Number(mapping.confidence)) ? Math.max(0, Math.min(1, Number(mapping.confidence))) : 0, basis: String(mapping.basis ?? "").slice(0, 180) });
}
for (const target of targets) if (!seen.has(target.id)) mappings.push({ id: target.id, evidenceType: "none", evidenceIds: [], confidence: 0, basis: "模型未返回" });
const result = { protocol: { benchmarkId: "full-quantity-v0", caseId: "case-001", version: "route-map-v1.1", truthAccess: "forbidden", model, reasoningEffort, elapsedMs: Date.now() - startedAt }, usage: body.usage ?? null, mappings };
const outputDir = path.join(projectDir, "outputs", "full-quantity-v0", "hybrid-mappings-v1"); await fs.mkdir(outputDir, { recursive: true });
const outputPath = path.join(outputDir, `${model.replace(/[^a-zA-Z0-9._-]/g, "_")}--route-v1-1.json`); await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, targets: targets.length, mapped: mappings.filter((mapping) => mapping.evidenceType !== "none").length, elapsedMs: result.protocol.elapsedMs, usage: result.usage }, null, 2));
