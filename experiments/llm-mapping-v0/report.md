# LLM无泄漏映射实验

> 模型请求只读取 `input.json`；广联达真值仅由本评分脚本在请求完成后读取。当前项目仍是 calibration set，最优结果不能视为独立测试集成绩。

| 排名 | 模型 | 模式 | 检索范围 | Exact | MAE | WAPE | 预测总量 |
|---:|---|---|---|---:|---:|---:|---:|
| 1 | deterministic-hybrid | cross-layer-semantic | semantic_recall_across_all_layers | 20.0% | 1.20 | 7.7% | 150 |
| 2 | gpt-5.6-sol | closed_world | all-layers | 20.0% | 1.20 | 7.7% | 150 |
| 3 | gpt-5.6-sol | closed_world | all-layers | 20.0% | 1.20 | 7.7% | 150 |
| 4 | gpt-5.6-sol | contextual | all-layers | 10.0% | 2.30 | 14.7% | 139 |
| 5 | gpt-5.6-sol | contextual | selected-layer | 20.0% | 2.30 | 14.7% | 137 |
| 6 | gpt-5.6-sol | strict | selected-layer | 20.0% | 2.30 | 14.7% | 137 |
| 7 | claude-opus-4-6 | contextual | selected-layer | 20.0% | 3.70 | 23.7% | 121 |
| 8 | gemini-3.1-pro-preview | contextual | selected-layer | 20.0% | 3.70 | 23.7% | 121 |
| 9 | gpt-5.6-terra | contextual | selected-layer | 20.0% | 3.70 | 23.7% | 121 |
| 10 | qwen3.5-plus | contextual | selected-layer | 20.0% | 7.40 | 47.4% | 84 |

## 当前最佳逐项结果

模型：deterministic-hybrid / cross-layer-semantic

| 类别ID | 真值 | 预测 | 差值 |
|---|---:|---:|---:|
| wall_light | 4 | 4 | 0 |
| single_tube_light | 16 | 17 | +1 |
| waterproof_light | 21 | 18 | -3 |
| explosion_proof_light | 1 | 2 | +1 |
| wall_seat_light | 10 | 9 | -1 |
| exhaust_fan | 11 | 11 | 0 |
| delay_switch | 21 | 18 | -3 |
| three_gang_switch | 5 | 4 | -1 |
| two_way_switch | 9 | 8 | -1 |
| direction_sign | 58 | 59 | +1 |
