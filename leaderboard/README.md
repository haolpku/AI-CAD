# AI-CAD Leaderboard

> 当前榜单使用 `Case-001 / calibration`，适合调试方法，不代表跨项目泛化能力。待增加隐藏项目后，将单独建立 Hidden Test Leaderboard。

## Overall

| Rank | Method | Model | Overall ↑ | Core ↑ | Derived ↑ | Coverage ↑ |
|---:|---|---|---:|---:|---:|---:|
| 1 | Hybrid v1 | gpt-5.6-sol | **34.68** | **36.30** | **28.20** | 100% |
| 2 | Direct LLM closed-world | gpt-5.6-sol | 26.51 | 30.53 | 10.40 | 100% |

## By discipline

| Method | 动力电气 | 消防弱电 | 照明电气 | 给排水采暖 | 防雷接地 |
|---|---:|---:|---:|---:|---:|
| Direct LLM | 39.46 | 20.78 | 35.25 | 21.87 | 8.34 |
| Hybrid v1 | 39.31 | 19.80 | 38.53 | 31.46 | 42.27 |

专业分数仍先按单位分组，再使用 `√目标数` 加权。某专业同时存在 Core 和 Derived 时使用 80/20 权重；只有 Core 时不会因缺少 Derived 被扣分。

## By task group

| Role / Discipline / Unit | Targets | Direct Score | Hybrid Score | Direct WAPE | Hybrid WAPE | Hybrid Tolerance hit |
|---|---:|---:|---:|---:|---:|---:|
| Core / 动力电气 / m | 23 | 17.26 | 17.26 | 77.21% | 77.21% | 4.35% |
| Core / 动力电气 / 个 | 38 | 65.08 | 64.74 | 40.87% | 41.35% | 78.95% |
| Derived / 动力电气 / 个 | 12 | 20.67 | 20.67 | 91.91% | 91.91% | 50.00% |
| Core / 消防弱电 / m | 5 | 20.28 | 20.28 | 71.03% | 71.03% | 0.00% |
| Core / 消防弱电 / 个 | 36 | 20.97 | 19.62 | 86.72% | 87.45% | 36.11% |
| Core / 照明电气 / m | 4 | 45.14 | 45.14 | 46.23% | 46.23% | 25.00% |
| Core / 照明电气 / 个 | 40 | 43.72 | 49.12 | 56.83% | 50.18% | 47.50% |
| Derived / 照明电气 / 个 | 2 | 0.00 | 0.00 | 1032.14% | 1032.14% | 0.00% |
| Core / 给排水采暖 / m | 18 | 0.00 | 20.13 | 133.51% | 71.25% | 0.00% |
| Core / 给排水采暖 / 个 | 102 | 35.67 | 35.67 | 64.16% | 64.16% | 35.29% |
| Derived / 给排水采暖 / m | 18 | 1.67 | 1.67 | 178.03% | 178.03% | 5.56% |
| Derived / 给排水采暖 / m² | 52 | 5.80 | 39.82 | 99.13% | 51.36% | 19.23% |
| Derived / 给排水采暖 / m³ | 5 | 32.51 | 70.55 | 53.56% | 16.36% | 40.00% |
| Core / 防雷接地 / m | 6 | 5.00 | 69.90 | 207.20% | 14.43% | 33.33% |
| Core / 防雷接地 / 个 | 5 | 12.00 | 12.00 | 196.84% | 196.84% | 40.00% |

## Scoring

评分目标分为 277 个 Core、89 个 Derived 和 14 个 Audit。Audit 仅用于一致性检查，不计入总分。

单项容差为：

```text
tolerance = max(按单位的绝对容差, 5% × |真值|)
```

| Unit | Absolute tolerance |
|---|---:|
| 个 | 1 |
| m | 0.5 |
| m² | 0.5 |
| m³ | 0.01 |

先按“角色 × 专业 × 单位”分组。每组分数为：

```text
Group Score = Coverage × [70% × max(0, 1 - WAPE) + 30% × Tolerance Hit Rate]
```

每层内的分组使用`√Targets`加权，防止最大专业完全淹没小专业。总分为：

```text
Bench Score = 100 × (80% × Core Score + 20% × Derived Score)
```

MAE、WAPE 越低越好；Coverage、Tolerance Hit、Group Score 和 Bench Score 越高越好。不同单位的原始误差不直接相加。

## Score bands

以下是本项目的建议解读区间，不是行业标准或工程验收线：

| Bench Score | Interpretation |
|---:|---|
| 90–100 | 接近可靠自动算量，仍需抽查 |
| 75–<90 | 可作为人工复核辅助，需重点检查低分专业 |
| 50–<75 | 部分专业/工程量可用，不宜直接出造价 |
| 30–<50 | 能提取有效信号，但错误较多，属研究与工具试用阶段 |
| 0–<30 | 原型阶段，不能用于造价决策 |

Hybrid v1 的 34.68 落在 30–50 区间：已证明确定性 CAD 证据比直接猜数有效，但还不能代替专业算量和人工复核。

## Submission protocol

每次实验在 `submissions/` 下提交一份符合 `schema.json` 的聚合 JSON。公开提交只允许包含：

- benchmark 版本和冻结的 target hash；
- 方法、模型和协议说明；
- Overall、Core、Derived 和分类聚合指标；
- 覆盖率和目标数。

不得提交广联达逐项真值、原始图纸、私有文件路径、API 密钥或含逐项真值的评分文件。

## Reading the board

- `Score / Overall / Core / Derived`：越高越好，范围 0–100。
- `Coverage / Tolerance hit`：越高越好。
- `WAPE`：越低越好。
- 分类样本数很小时，必须与 Targets 列一起解读。
