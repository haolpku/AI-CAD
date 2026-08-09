# Full Quantity API Experiment v0

本实验仅使用冻结的公开目标目录和从 DWG 模型空间提取的图块、文字、图层及线长证据。预测程序不读取广联达真值；预测 JSON 落盘后，独立评分器才读取本地私有真值。密钥、原始图纸、逐项预测和含真值的评分文件均不入库。

## 结果

| 设置 | 范围 | 覆盖率 | Bench Score |
|---|---:|---:|---:|
| gpt-5.6-sol，分专业 closed-world，medium reasoning | 366 | 100% | 26.51 |
| 单项目校准后的分组管线选择 | 366 | 100% | 26.93 |

第一行是冻结预测后得到的盲测基线。第二行在同一 calibration case 上比较过管线后才选择，只代表方法调试上限，不能当作隐藏测试成绩。

Core 盲测层分数为 30.53/100，Derived 层为 10.40/100。数量类相对好于长度、面积和体积；主要瓶颈是 CAD 实体与算量分类的语义对齐、外部参照/图例去重、以及管线几何重建。

## 调试观察

- 将所有 CAD 证据一次性交给模型会触发网关 524 超时，因此改为按专业/工作表分组。
- 目标级检索增加了上下文，但除消防组外大多数组反而下降；长度类尤其容易被不相关图层线长干扰。
- 另一个高能力模型在照明和给排水设备两个代表组上均未超过主基线，因此没有扩展为完整运行。
- 兼容 OpenAI Chat Completions 的不同模型可能在 JSON 外包裹 Markdown 代码块，运行器已做严格 JSON 内容的兼容解析。

## 复现流程

```bash
npm run benchmark:full:build
npm run benchmark:full:evidence

CAD_BENCH_API_KEY=... CAD_BENCH_BASE_URL=... \
  npm run benchmark:full:predict -- gpt-5.6-sol \
  --group=lighting --mode=closed_world --reasoning=medium

npm run benchmark:full:merge -- \
  --tag=my-full-run --input=outputs/full-quantity-v0/predictions/group-1.json

npm run benchmark:full:score -- \
  --predictions=outputs/full-quantity-v0/predictions/my-full-run.json
```

完整分组为`power`、`fire`、`lighting`、`lightning`、`plumbing_pipes`、`plumbing_equipment`和`plumbing_fittings`。在新项目上测试时，必须在看到新项目真值之前冻结证据提取、提示词和分组管线。
