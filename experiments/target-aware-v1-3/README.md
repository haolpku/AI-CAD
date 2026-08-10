# Target-aware solver v1.3

该实验测试 v1.3 的逐目标数据需求和 Evidence Registry 是否能直接提高 Case-001 calibration 分数。模型仍为`gpt-5.6-sol`，v1.1 DN 管线结果保持冻结，实验只改变数量类语义映射。

## Ablations

| Method | Description | Overall | Core | Derived |
|---|---|---:|---:|---:|
| Hybrid v1.1 | 冻结管径分段基线 | 35.67 | 37.54 | 28.20 |
| Hybrid v1.2 | 当前最佳递归块计数 | **36.85** | **39.01** | 28.20 |
| v1.3-A context gate | 在v1.2映射上增加缺失变量门控 | **36.85** | **39.01** | 28.20 |
| v1.3-B re-map @ fixed 0.85 | 需求清单和负证据进入提示词后重新映射 | 35.57 | 37.41 | 28.20 |
| v1.3-B best threshold 0.75 | calibration阈值扫描最好结果 | 35.76 | 37.65 | 28.20 |
| v1.3 consensus | 只保留v1.2/v1.3证据完全一致的映射 | 35.87 | 37.79 | 28.20 |

## Finding

数据关系模型本身没有自动提高 benchmark：

- A组不变，说明当前已采用的13项v1.2映射均通过context gate；
- B组相对v1.1有1项改善、1项退化，但相对v1.2有3项退化、0项改善；
- 共调用6个数量任务组，消耗209,493 tokens、累计服务耗时约552秒；
- 给排水设备和管件仍全部返回`none`，因为图框/系统/拓扑到实体的权威绑定尚不存在；
- 把变量清单直接加入prompt增加了成本和保守性，却没有生成新的数值候选。

这是预期内的重要负结果：Evidence Registry适合做调度、检索和缺失检测，但不能替代证据提供器。下一步不应继续扩写prompt，而应实现`circuit-route`、`termination-policy`、管件拓扑和保温参数等关系型数据，然后让solver通过registry调用这些确定性提供器。

## What remains useful

v1.3-A 保持了36.85且明确阻止30项缺回路路径、14项缺端接规则的目标被不完整证据覆盖。它适合作为安全执行框架，但当前榜单仍保留v1.2的36.85，不新增v1.3榜单记录。

## Reproduce

```bash
npm run benchmark:v1.3:requirements
npm run benchmark:v1.3:registry

CAD_BENCH_API_KEY=... CAD_BENCH_BASE_URL=... \
  node scripts/run-semantic-map-v1.mjs gpt-5.6-sol \
  --group=lighting --tag=v1-3 \
  --evidence=outputs/full-quantity-v0/hybrid-evidence-v1-2.json \
  --registry=outputs/full-quantity-v0/evidence-registry-v1-3.json \
  --context-threshold=0.6 \
  --target-types=device-count,fitting-count

npm run benchmark:v1.3:consensus
```

所有映射阶段均声明`truthAccess=forbidden`；阈值扫描属于 calibration 分析，不代表隐藏测试成绩。
