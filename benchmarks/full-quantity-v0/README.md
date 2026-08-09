# Full Quantity Benchmark v0

`full-quantity-v0`以5份冻结CAD图纸为输入，覆盖 Case-001 五个专业导出工作簿中的全部数值工程量。它仍是校准集，不是隐藏测试集成绩。GQI4不属于预测输入。

## 统计口径

- 5个工作簿、11张汇总表；
- 5份私有CAD输入，仅公开文件大小和SHA-256；
- 326个包含数值的原始明细行；
- 展开多指标列后共380个标量目标；
- 14个`线/缆合计(m)`属于可由分项求和的派生合计；
- 默认正式评分366个`primary`目标，全部380个目标保留用于审计。

每个目标包含专业、工作表、系统/分组上下文、项目名称、工程量类型、单位、角色和来源单元格，但公开目录不包含真值。真值由本地授权Excel生成到`data/private/`，该目录不会提交。

## 构建

将五份本地授权工作簿按`config/full-quantity-v0.json`指定路径放置，然后运行：

```bash
npm run benchmark:full:build
```

生成的公开文件：

- `manifest.json`：范围与统计口径；
- `targets.json`：无真值目标目录；
- `prediction-template.json`：预测提交模板；
- `targets.sha256`和`truth.sha256`：冻结输入和私有真值版本。

私有真值写入`data/private/case-001/full-quantity-v0/truth.json`。

## 评分

预测文件必须保持与`prediction-template.json`相同的ID，只填写数值：

```bash
npm run benchmark:full:score -- --predictions=path/to/predictions.json
```

默认排除派生合计；增加`--all`可审计全部380个目标。数量、长度、面积和体积按单位分别计算覆盖率、MAE、WAPE和完全命中率，禁止把不同单位直接相加。
