# Hybrid v1.1: DN-aware route segmentation

v1.1 针对 v1 的主要剩余问题：同一 CAD 图层中存在多个管径，无法把整层长度直接分配给单个工程量目标。

## Algorithm

1. 仅保留平面图中的给排水/采暖管线图层；
2. 将 LINE、LWPOLYLINE（含 bulge 圆弧）和 ARC 转换为带稳定端点的边；
3. 在 1m 范围内将`DNxx`文字绑定到最近管线边；
4. 在每个系统图层的连通图内做多源最短路传播；
5. 不同 DN 种子传播到同一边且距离相近时，该边标为 unknown；
6. 聚合为`图纸 × 系统图层 × DN`分段证据；
7. LLM 仅选择分段证据 ID，长度仍由 CAD 几何求和。

1m 文字绑定半径在 Case-001 calibration 上从 0.5m、1m、1.5m、2m 和 3m 中选定。传播上限在 20–100m 区间内不影响结果，说明当前连通分量本身较短。

## Result

| Method | Overall | Core | Derived | Plumbing Core length WAPE |
|---|---:|---:|---:|---:|
| Direct LLM | 26.51 | 30.53 | 10.40 | 133.51% |
| Hybrid v1 | 34.68 | 36.30 | 28.20 | 71.25% |
| Hybrid v1.1 | **35.67** | **37.54** | 28.20 | **51.70%** |

v1.1 仅覆盖 18 个给排水 Core 长度目标，通过置信度和共享证据门控实际替换 8 项。Derived 继续使用 frozen v1 结果，因为已标注分段不包含 unknown 管线，直接用其重算全系统保温量会欠计。

## Known limitations

- 大量无 DN 文字或与标注距离过远的边仍为 unknown；
- 立管和跨楼层线段没有从系统图/标高完整恢复；
- 某些短管径分段会欠计，因为尚未将标签跨断点传播到立管符号；
- 所有几何半径均为 calibration 参数，必须在新项目真值公开前冻结。
