# Hybrid v1.2 rerun

v1.2 将 loss-aware project IR 接入数量证据，并保留 v1.1 已验证的 DN-aware 管线分段。该结果来自同一个 Case-001 calibration case，属于开发集调参结果，不是隐藏测试成绩。

## Protocol

- 模型：`gpt-5.6-sol`
- 输入：v1.2 递归块 IR、世界坐标、图名/楼层候选和项目图谱
- 数量：只聚合语义映射后选中的 `INSERT` occurrences
- 长度：沿用 v1.1 DN-aware route segments，不累加块内符号线
- 语义门控：扫描 0.70–0.95；0.70–0.85 得到相同最好分数，发布口径取 0.85
- 真值访问：模型映射阶段禁止；预测冻结后才由本地评分器读取
- API 调用：7 个专业组，总计 198,718 tokens

## Result

| Method | Overall | Core | Derived |
|---|---:|---:|---:|
| Hybrid v1.1 | 35.67 | 37.54 | 28.20 |
| v1.2 full replacement | 33.70 | 35.36 | 27.06 |
| **v1.2 incremental on v1.1** | **36.85** | **39.01** | **28.20** |

“Full replacement”会让尚未成熟的 v1.2 路线映射覆盖 v1.1，因此分数下降。最终 v1.2 采用增量架构：v1.1 负责已验证的管线分段，v1.2 只替换通过语义门控的数量证据。

相对 v1.1，13 个目标通过 v1.2 语义门控，其中只有 3 个预测值发生变化：3 个绝对误差下降、0 个上升，其余 363 个评分目标不变。提升集中在消防弱电数量和照明数量：

| Core group | v1.1 Score | v1.2 Score | v1.1 WAPE | v1.2 WAPE |
|---|---:|---:|---:|---:|
| 消防弱电 / 个 | 19.62 | 21.48 | 87.45% | 85.98% |
| 照明电气 / 个 | 49.12 | 58.16 | 50.18% | 37.27% |

## Finding about the five-drawing organization

本轮被采用的 15 份 block evidence 中，没有一份直接包含嵌套 `INSERT`。因此 `+1.18` 分的即时提升主要来自：递归恢复出的标题/图型文字改善了顶层设备的平面图区域归属，而不是直接把嵌套设备计入。

这说明两件事：

1. 递归展开是必要的，因为它恢复了用于理解图纸结构的文字和上下文；
2. 单纯恢复 335,582 个嵌套实体还不够，必须先完成图框、视口、建筑底图过滤和跨图关系组织，才可安全把嵌套符号用于工程量。

设备和管件组对新增嵌套候选全部返回`none`，属于正确的保守拒绝。下一版最值得做的是为每个块实例增加`sheet/frame/floor/discipline/source-reference`类型，并以建筑底图、图例和系统图作为负证据。

## Reproduce

```bash
npm run benchmark:v1.2:ir
npm run benchmark:v1.2:evidence

CAD_BENCH_API_KEY=... CAD_BENCH_BASE_URL=... \
  node scripts/run-semantic-map-v1.mjs gpt-5.6-sol \
  --group=lighting --reasoning=medium --tag=v1-2 \
  --evidence=outputs/full-quantity-v0/hybrid-evidence-v1-2.json
```

完整逐项目标预测和评分保留在`outputs/`，不会提交；公开 leaderboard submission 只包含聚合指标。
