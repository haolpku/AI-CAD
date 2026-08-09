import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const experimentDir = path.join(projectDir, "experiments", "llm-mapping-v0");
const inputArg = process.argv.find((value) => value.startsWith("--input="));
const tagArg = process.argv.find((value) => value.startsWith("--tag="));
const inputName = inputArg?.slice("--input=".length) || "input.json";
const outputTag = tagArg?.slice("--tag=".length) || "selected-layer";
const inputText = await fs.readFile(path.join(experimentDir, inputName), "utf8");
const input = JSON.parse(inputText);
const apiKey = process.env.CAD_BENCH_API_KEY;
const baseUrl = (process.env.CAD_BENCH_BASE_URL ?? "https://api.openai.com").replace(/\/$/, "");
if (!apiKey) throw new Error("CAD_BENCH_API_KEY is required and must not be stored in the repository.");

const requestedModels = process.argv.slice(2).filter((value) => !value.startsWith("--"));
const models = requestedModels.length ? requestedModels : ["gpt-5.6-sol"];
const modes = process.argv.includes("--both")
  ? ["strict", "contextual"]
  : process.argv.includes("--closed-world") ? ["closed_world"] : ["contextual"];
const inputHash = crypto.createHash("sha256").update(inputText).digest("hex");

const prompts = {
  strict: "采用严格证据标准：只有源标签与目标类别存在明确同义或直接上下位关系时才映射；有任何歧义就设为null。",
  contextual: "采用建筑电气专业上下文：可以解释常见CAD简称和同义词，但不得根据典型项目数量猜测，也不得把不同设备仅因同图层而合并。",
  closed_world: "采用闭集专业分类：目标类别是本次需要统计的全部类别。对语义上属于某一目标类别但名称较泛的对象，映射到唯一最接近的目标；例如目标中只有一种小型通风器具类别时，普通‘风扇’可归入换气扇，但风机盘管、排烟风机等不同设备不得归入。对确实无关的对象仍设为null。"
};

const extractJson = (content) => {
  const text = Array.isArray(content)
    ? content.map((item) => typeof item === "string" ? item : item?.text ?? "").join("")
    : String(content ?? "");
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse((fenced?.[1] ?? text).trim());
};

const validateAndAggregate = (response) => {
  const sourceCounts = new Map(input.cadEvidence.sourceLabels.map((item) => [item.label, item.count]));
  const validTargets = new Set(input.targetCategories.map((item) => item.id));
  const seen = new Set();
  const assignments = [];
  for (const item of response.assignments ?? []) {
    if (!sourceCounts.has(item.source_label) || seen.has(item.source_label)) continue;
    const target = validTargets.has(item.target_id) ? item.target_id : null;
    assignments.push({
      source_label: item.source_label,
      target_id: target,
      confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : null,
      reason: String(item.reason ?? "").slice(0, 300)
    });
    seen.add(item.source_label);
  }
  for (const [sourceLabel] of sourceCounts) {
    if (!seen.has(sourceLabel)) assignments.push({source_label: sourceLabel, target_id: null, confidence: null, reason: "模型未返回该标签"});
  }
  const values = Object.fromEntries(input.targetCategories.map((item) => [item.id, 0]));
  for (const assignment of assignments) {
    if (assignment.target_id) values[assignment.target_id] += sourceCounts.get(assignment.source_label);
  }
  return { assignments, values };
};

for (const model of models) {
  for (const mode of modes) {
    const system = `你是建筑电气CAD工程量分类器。${prompts[mode]}\n` +
      "只返回JSON对象，格式为：{\"assignments\":[{\"source_label\":\"原标签\",\"target_id\":\"目标id或null\",\"confidence\":0到1,\"reason\":\"简短依据\"}]}。" +
      "必须为每个sourceLabels条目返回一次且仅一次；不要输出目标工程量预测，程序会按原始计数汇总。";
    const payload = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(input) }
      ],
      temperature: 0,
      max_tokens: 8000,
      response_format: { type: "json_object" }
    };
    if (model.startsWith("gpt-5.6")) payload.reasoning_effort = "high";
    const startedAt = Date.now();
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload)
    });
    const bodyText = await response.text();
    if (!response.ok) throw new Error(`${model}/${mode} failed (${response.status}): ${bodyText.slice(0, 1000)}`);
    const body = JSON.parse(bodyText);
    const parsed = extractJson(body.choices?.[0]?.message?.content);
    const normalized = validateAndAggregate(parsed);
    const output = {
      protocol: { inputHash, truthAccess: "forbidden", model, mode, elapsedMs: Date.now() - startedAt },
      usage: body.usage ?? null,
      ...normalized
    };
    const safeName = `${outputTag}--${model.replace(/[^a-zA-Z0-9._-]/g, "_")}--${mode}.json`;
    await fs.writeFile(path.join(experimentDir, safeName), `${JSON.stringify(output, null, 2)}\n`);
    console.log(JSON.stringify({model, mode, values: normalized.values, elapsedMs: output.protocol.elapsedMs}));
  }
}
