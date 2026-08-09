# AI-CAD

面向CAD施工图AI工程量计算的无泄漏评测基准。项目把CAD图纸作为输入，把专业算量软件导出的工程量表作为冻结真值，评估不读取专有算量模型数据库的预测流程。

> A leakage-resistant benchmark for AI-assisted quantity takeoff from CAD drawings.

## 当前范围

- 数据：匿名化的`Case-001`电气DWG及照明工程量真值
- 任务：照明设备与开关的数量统计
- 数据划分：`calibration`（校准集）
- 预测：仅使用 DWG 模型空间内 `EQUIP-照明` 图层的图块属性
- 真值：从广联达导出的“电气设备工程量汇总表”读取
- 暂不评价：电线、配管、桥架长度

由于目前只有一个项目，而且规则是在该项目上建立的，它是 benchmark 的种子数据与校准集，还不是能证明泛化能力的正式测试集。

## 全量工程量基准

`benchmarks/full-quantity-v0/`冻结5份CAD作为预测输入，并把5份广联达导出工作簿标准化为全量目标目录：326个原始明细行展开为380个标量目标。默认评分排除14个重复的线缆合计，得到366个主目标，覆盖数量、长度、面积和体积。公开目录只包含目标定义、CAD哈希和真值哈希，不包含原始文件或全量真值；本地评分器在预测冻结后才读取`data/private/`中的真值。

```bash
npm run benchmark:full:build
npm run benchmark:full:score -- --predictions=path/to/predictions.json
npm test
```

## 运行

依赖：Node.js 18+、LibreDWG 的 `dwgread`、`@oai/artifact-tool`。

原始DWG、Excel、GQI4和压缩包不进入公开仓库。将本地授权数据放置为：

```text
data/private/case-001/electrical.dwg
data/private/case-001/lighting.xlsx
```

`data/private/`已被`.gitignore`排除。

```bash
npm run benchmark
```

输出位于 `outputs/lighting-device-v0/`：

- `truth.json`：广联达真值
- `predictions.json`：CAD 基线预测
- `inventory.json`：CAD 图层、属性标签与未映射项
- `results.json`：逐项误差和整体指标
- `report.md`：可粘贴到飞书的阶段报告

## 推荐架构

核心采用确定性 workflow：

1. DWG 转换为实体 JSON
2. 只取模型空间，解析图层、图块、属性和几何
3. 用版本化规则映射为工程量类别
4. 计算数量/长度/面积
5. 与冻结真值比较并输出指标

Codex SDK 放在 workflow 外围，用于：候选规则生成、未映射对象解释、人工复核建议和报告生成。评分阶段不得读取 GQI4 内部数据库，也不得根据真值临时改预测，以避免数据泄漏。

## LLM 无泄漏实验

`experiments/llm-mapping-v0/` 将模型调用与评分拆成独立阶段：

1. `prepare-llm-input*.mjs` 只生成 CAD 证据与目标类别本体；
2. `run-llm-predict.mjs` 只读取冻结输入并调用 API，不包含任何真值路径；
3. `score-llm-experiment.mjs` 在预测完成后才读取 `truth.json`；
4. `check-leakage.mjs` 检查代码和产物的数据边界。

当前 calibration case 的最好结果来自跨图层闭集语义分类：MAE `1.20` 个/类别，WAPE `7.7%`。`gpt-5.6-sol` 两次独立运行产生了相同的类别计数；确定性规则版本也得到相同结果。正式泛化成绩仍需冻结规则后在新项目上测试。

调用兼容 OpenAI Chat Completions 的服务时，通过环境变量传入配置，密钥不得写入仓库：

```bash
CAD_BENCH_API_KEY=... \
CAD_BENCH_BASE_URL=https://api.openai.com \
node scripts/run-llm-predict.mjs --input=input-all-layers.json --tag=all-layers --closed-world gpt-5.6-sol
```

提交公开实验产物前可运行 `node scripts/anonymize-public-artifacts.mjs`，它会保留原始输入哈希作为来源记录，并将公开匿名输入的哈希写入主字段。
