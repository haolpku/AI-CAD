# Preprocessing v1.2: loss-aware project IR

v1.2 解决两个不同层次的问题：先尽量无损地恢复单张 CAD 内部信息，再把五张图组织成一个项目级证据图。它不改变 benchmark 真值，也尚未构成新的榜单成绩。

## Why

v1/v1.1 主要读取模型空间顶层实体。CAD 中的普通块、嵌套块和已绑定外部参照仍包含大量线、文字和符号；只读顶层会保留块插入点，却丢掉块定义内部的几何和语义。另一方面，五张图各自承担不同职责，不能简单拼成一个实体列表。

## Intermediate representation

处理顺序如下：

1. 原始 DWG/转换 JSON 保持为私有、权威的 L0 来源；
2. 从模型空间开始递归展开普通块和嵌套块，最多 8 层，并检测循环引用；
3. 组合插入、旋转、缩放和块基点变换，把实体统一到世界坐标；
4. 为每个“图纸 × 块实例路径 × 源实体”生成稳定 occurrence ID；
5. 保留源 handle、图层、块路径、变换矩阵和世界坐标几何，不在此阶段做工程量汇总；
6. 提取图名、图型、楼层词和已绑定参照指纹，构建五图项目图谱；
7. 语义绑定完成后，才允许按设备、系统、楼层、管径和单位聚合。

详细实体 IR 是私有中间产物，公开仓库只提交不含原文、坐标和图块名称的[质量清单](manifest.json)。

## Five-drawing organization

五张图不是五个等价数据源：

| Drawing | Role | Primary use |
|---|---|---|
| electrical-cad | quantity source | 动力、消防弱电、照明、防雷接地 |
| plumbing-cad | quantity source | 给排水、采暖 |
| hvac-cad | quantity source / corroboration | 给排水采暖相关管线和系统上下文 |
| architecture-cad | supporting context | 房间、轴网、楼层和空间边界 |
| general-cad | supporting context | 总图、室外关系和项目级定位 |

项目图谱目前包含三类边：`used-by`、跨图的`shared-floor-vocabulary`和`shared-bound-reference`。这比把五图直接合并更安全：相同楼层词或参照指纹只作为候选关联，不能单独证明两个实体是同一个工程量对象。

后续还需继续加强图框/视口边界、轴网配准、系统图到平面图的立管关联，以及建筑空间到机电实体的包含关系。这些关系会直接影响跨楼层去重和分系统汇总。

## Observed recovery quality

| Metric | v1.2 result |
|---|---:|
| Configured CAD drawings | 5 |
| Parsed drawings | 4 |
| Parse coverage | 80% |
| Model-space references in parsed drawings | 69,388 |
| Expanded entity occurrences | 404,518 |
| Recovered nested occurrences | 335,582 |
| Nested share of expanded IR | 82.96% |
| Stable ID collisions | 0 |
| Depth/instance truncations | 0 |
| Title candidates | 170 |
| Project graph edges | 15 |

`architecture-cad`在当前 LibreDWG 上读取失败（`0x940`），JSON 与 DXF 路径结果一致。因此这里如实记为不可用，而不是静默排除。三张专业图中已经绑定的建筑参照仍作为有限的替代上下文参与组织，但不能视为完整建筑原图。

这些数字本身衡量的是“信息保留和组织质量”，不是工程量预测准确率。将 IR 接入冻结预测链路后，v1.2 在 calibration case 上从 v1.1 的`35.67`提高到`36.85`；具体实验口径和消融结果见`experiments/hybrid-v1-2/`。

## Reproduce

```bash
npm run benchmark:full:evidence -- --all
npm run benchmark:v1.2:ir
npm test
```

私有实例文件输出到`outputs/full-quantity-v0/project-ir-v1-2/`，不会提交到 GitHub。
