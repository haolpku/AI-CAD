# Oracle ceiling v0

该实验故意允许评分阶段访问 Case-001 真值，用于回答“当前候选和完整建模经验的理论上限是多少”。它是诊断实验，**禁止进入 leaderboard，也不代表可部署准确率**。

## Results

| Oracle | Candidate scope | Overall | Core | Derived | Exact / 366 | Within tolerance / 366 |
|---|---|---:|---:|---:|---:|---:|
| Published-method selector | 4 个公开方法逐目标事后择优 | 37.72 | 39.89 | 29.02 | 78 | 128 |
| Existing-candidate selector | 当前 84 份预测逐目标事后择优 | **45.91** | **48.91** | **33.89** | 87 | 151 |
| Perfect GQI model | 直接拥有完整建模工程量 | 100.00 | 100.00 | 100.00 | 366 | 366 |

## Interpretation

`100`只是“直接知道答案”的数学上限，没有研究意义。更有价值的摸高是`45.91`：即使存在一个能看真值的完美选择器，从当前所有预测候选中逐项挑最接近者，也只能达到约 46 分。

因此当前主要瓶颈不是最后一步模型选择，而是候选生成能力：大量目标没有任何方法产生接近真值的设备数量、管线长度或派生量。相比当前 clean score `36.85`，现有候选选择空间只提供约`+9.06`分上限；剩余差距必须靠新的建模变量和几何证据解决。

当前候选池的 Oracle 分专业结果为：

| Discipline | Oracle score |
|---|---:|
| 动力电气 | 39.46 |
| 消防弱电 | 46.44 |
| 照明电气 | 54.72 |
| 给排水采暖 | 45.33 |
| 防雷接地 | 44.51 |

动力电气几乎没有从候选选择中获益，说明需要补电缆回路、配管、桥架和预留长度建模；给排水/消防/照明存在一定“候选已有但选择不稳”的空间。

## Reproduce

```bash
npm run benchmark:oracle
```

脚本和逐目标产物位于私有`outputs/`，协议固定写入：

```text
truthAccess = required-oracle
leaderboardEligible = false
```
