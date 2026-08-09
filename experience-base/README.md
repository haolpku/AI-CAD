# Experience Base

经验库保存“如何从 CAD 建模”，不保存“某个项目的工程量答案”。它与 benchmark 真值严格分离。

## Three tiers

| Tier | Content | Prediction-time access |
|---|---|---|
| T0 schema | 软件字段含义、单位维度、通用关系类型 | 允许 |
| T1 candidate | 从单个 GQI4 提取的匿名化词形、映射和公式候选 | 禁止；仅存`data/private/` |
| T2 promoted | 至少两个训练项目支持、完成留出项目验证的稳定规则 | 允许 |

当前仓库只公开 T0。Case-001 产生的任何候选都只能是 T1，不能因为它提高了 Case-001 分数就晋级。

## What an experience may describe

- CAD 特征到构件属性的映射，例如图层/文字/图块共同决定`system`或`standard`；
- 图纸、图框、楼层、专业和构件之间的结构关系；
- 图例、系统图、建筑绑定底图等负证据；
- 符号化公式需要哪些输入，例如水平、垂直、桥架内和预留长度；
- 规则适用的专业、构件类型、证据要求和不确定性。

## Forbidden content

- target ID、逐项目真值、预测修正值或目标行号；
- 项目名、楼号、原始坐标、CAD handle 或可回连到私有图纸的实体 ID；
- 从 Case-001 误差反推的倍率、常数或规则；
- 单项目支持却标记为可在 benchmark 推理时使用的经验。

## Promotion gate

T1 晋级 T2 必须同时满足：

1. `supportProjectCount >= 2`，且支持项目不包含目标测试项目；
2. 规则在项目级留出集上验证，`heldoutValidated=true`；
3. 不包含项目常数、原始实体标识或工程量答案；
4. 在冻结 benchmark 预测前完成版本化；
5. 通过`npm run experience:validate`。

按楼层拆分同一栋楼不能替代项目级留出验证，因为楼层之间共享图纸模板和建模习惯。

## Private extraction

下面的命令只生成私有候选文件。输出默认位于已被 Git 忽略的`data/private/experience-candidates/`：

```bash
npm run experience:extract -- \
  --input=/path/to/project.GQI4 \
  --project-group=stable-private-project-id
```

提取器只读取 GQI4 内的字段代码、匿名化词形和数据库 schema；不读取或导出工程量数值。输出强制设置：

```json
{
  "tier": "T1-candidate",
  "inferenceEligible": false,
  "heldoutValidated": false,
  "supportProjectCount": 1
}
```

同一栋楼的多个专业 GQI4 必须使用相同`project-group`。提取器只保存其哈希，防止把五个专业文件错误地当成五个独立项目，从而绕过跨项目晋级门槛。

公开 T0 内容位于[base-v0.json](base-v0.json)，结构约束见[schema.json](schema.json)。
