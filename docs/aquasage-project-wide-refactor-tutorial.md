# AquaSage 全项目 CRUD 生成重构教程

这篇教程对应当前仓库的实际实现，目标是帮助开发者从头梳理：怎样把原本只落到“工程名录”的生成器，重构为仍然只服务 `zdwp-aquasage-web`、但可以把同结构 CRUD 页面生成到不同父路由的工具。

## 1. 先明确需求，不要先改模板

这次重构不是把生成器改成兼容任意 Vue 项目，而是让使用者在命令行明确回答三个问题：

1. 从 Swagger 中生成哪个业务资源？
2. 参考 AquaSage 中哪个已有 CRUD 模块？
3. 新资源应该放在哪个父路由下？

对应参数是：

```text
--resource / --slug / --module
--reference-view
--target-parent
```

如果目标父路由不存在，再由使用者明确选择：

```text
--create-parent
--parent-title
--parent-icon
--parent-order
--parent-permission
```

这里最重要的边界是：OpenAPI 决定业务事实，参考页面只决定 AquaSage 内部的落位习惯。参考页面不能反过来虚构接口或字段。

## 2. 识别旧设计的问题

旧设计把两类信息混在同一份资源计划和渲染代码中：

- 业务信息：list/detail/create/update/delete、查询字段、表格字段、表单字段、分页路径；
- 工程落位：工程名录路由、Service 目录、类型命名空间、字段配置目录、菜单激活项。

于是渲染器中出现了固定内容：

```text
knowledge-engineering/engineering-catalog
src/service/api/engineering-catalog
Api.EngineeringCatalog
src/config/engineering
```

这些约定对工程名录是正确的，但不能表达“复制河流水系下的页面模式，在河流水系下新增渠道页面”。正确的重构方式不是继续增加 `if/else`，而是把“生成什么”和“生成到哪里”拆开。

## 3. 建立新的数据流

当前确定性链路可以理解为：

```text
OpenAPI
  ↓
planner：建立业务资源计划
  ↓
placementResolver：建立页面落位计划
  ↓
renderer：业务计划 + 落位计划 → 文件
  ↓
projectGenerator：增量写入、路由、校验、报告
```

两份计划的职责如下：

| 数据         | 负责模块               | 典型字段                                                           |
| ------------ | ---------------------- | ------------------------------------------------------------------ |
| 业务资源计划 | `planner.js`           | `operations`、`list`、`form`、`attachment`                         |
| 页面落位计划 | `placementResolver.js` | `viewBase`、`serviceFile`、`typeFile`、`resourceRouteName`、`menu` |

这样做以后，渲染器不再猜目标目录；它只执行计划。

## 4. 第一步：新增页面落位解析器

核心文件是 `lib/aquasage/placementResolver.js`，入口函数为：

```js
configureAquaSagePlans(projectRoot, plans, options);
```

它接收 planner 生成的计划，并给每个计划增加 `placement`：

```js
plan.placement = {
  parentRoutePath,
  parentRouteName,
  resourceRoutePath,
  resourceRouteName,
  viewBase,
  serviceFile,
  serviceImport,
  requestImport,
  typeFile,
  typeNamespace,
  typeQualifiedName,
  configFile,
  configImport,
  componentPrefix,
  menu,
  parent,
};
```

### 4.1 保留旧命令兼容

不传任何新参数时，解析器按 API 路径推导模块段（`api/v1` 之后第一段，如 `/api/v1/space/district` → `space`）：

```text
父路由：/knowledge-engineering/<模块>
Service 分组：<模块>
类型分组：<模块>
配置分组：<模块>
类型命名空间：<模块的大驼峰>
```

API 路径中没有模块段时，回退工程名录预设：

```text
父路由：/knowledge-engineering/engineering-catalog
Service 分组：engineering-catalog
配置分组：engineering
类型命名空间：EngineeringCatalog
```

路径推导是确定性规则，原来的命令不需要改参数；显式落位参数（`--target-parent`、`--reference-view`、`--service-group` 等）仍然优先于推导结果。

### 4.2 静态分析参考模块

`analyzeReferenceModule` 接受三种路径：

```text
某个资源目录
某个资源的 list 目录
某个资源的 list/index.vue
```

解析器完成以下检查：

1. 路径必须位于目标项目 `src/views` 内；
2. 必须存在 `list/index.vue`；
3. 必须包含 `NDataTable`；
4. 必须使用 AquaSage 支持的分页表格 composable；
5. 从 import 中推断 Service 和字段配置分组；
6. 从 `menu-config.ts` 推断参考资源是否隐藏以及激活哪个菜单。

这一步没有调用 LLM，也没有复制参考 Vue 源码。它只是确认参考模块属于当前生成器能表达的 AquaSage CRUD 模式。

### 4.3 处理菜单模式

解析器支持三种模式：

```text
reference：跟随参考资源
resource：新资源本身作为菜单项
parent：新资源隐藏，父路由作为菜单项
```

当模式为 `parent` 时，list、detail、attachment 页面都会激活目标父路由；当模式为 `resource` 时，这些子页激活新资源路由。

### 4.4 阻止危险的隐式行为

创建新父路由必须同时明确：

```text
--target-parent
--create-parent
--parent-title
```

这样可以避免开发者只输入 `--create-parent`，脚本却把默认工程名录误当成需要创建的新菜单。

## 5. 第二步：把命令行参数接到落位层

在 `codegen.js` 的 `aquasage` 与 `sync-zh-cn` 命令中增加相同的落位参数。两条命令必须共用同一个参数转换函数：

```js
placementOptions(options);
```

执行顺序从：

```js
const plans = planAquaSageResources(document, resourceOptions);
```

变为：

```js
let plans = planAquaSageResources(document, resourceOptions);
plans = await configureAquaSagePlans(
  options.project,
  plans,
  placementOptions(options),
);
```

为什么 `sync-zh-cn` 也必须执行落位解析？因为中文标题 key 来自最终路由名。第二条命令按同一确定性规则推导（`--target-parent` 显式传入时用显式值，否则按 API 路径模块段推导），不需要人工记忆落位参数。

## 6. 第三步：让渲染器只消费计划

在 `lib/aquasage/renderer.js` 中增加统一入口：

```js
placementOf(plan);
```

新计划直接返回 `plan.placement`；旧测试或旧调用未配置 placement 时，按 API 路径模块段推导兼容值，无模块段时返回工程名录兼容值。

随后逐项替换硬编码：

| 旧硬编码              | 新来源                                    |
| --------------------- | ----------------------------------------- |
| 工程名录 view 路径    | `placement.viewBase`                      |
| Service 文件和 import | `placement.serviceFile`、`serviceImport`  |
| 类型文件和命名空间    | `placement.typeFile`、`typeQualifiedName` |
| 字段配置文件和 import | `placement.configFile`、`configImport`    |
| Vue 组件名            | `placement.componentPrefix`               |

列表页跳转使用 planner 已被落位层更新的 `plan.resource.routeBase`。因此详情按钮会自然进入新的父路由，不需要再判断属于工程名录还是河流水系。

## 7. 第四步：去掉只能在工程名录使用的相对 composable

旧列表页依赖工程名录目录中的相对模块：

```text
../../composables/use-engineering-list-page
```

生成到其他父路由后，这个相对路径不再成立。当前实现把其中必要的少量确定性状态和函数直接放入生成列表页，并继续复用 AquaSage 全局 hook：

```text
useNaivePaginatedTable
useTableMaxHeight
```

判断原则是：

- 全项目公共能力继续 import；
- 只属于工程名录目录的胶水逻辑不能成为全项目生成的隐式前提；
- 不把该逻辑复制到每个目标父路由的公共目录，以免制造多个难以同步的副本。

## 8. 第五步：动态处理路由、菜单和中文标题

### 8.1 配置式路由版本

`routePatcher.js` 不再拼接固定的工程名录 key，而是使用：

```text
placement.parentRouteName
placement.resourceRouteName
```

它负责：

- 写入资源、列表、详情、附件标题；
- 隐藏子页面并设置 `activeMenu`；
- 根据菜单模式决定资源本身是否隐藏；
- 新建父路由时写入标题、图标、排序和权限；
- 把资源父路由加入 `REDIRECT_TO_LIST_ROUTES`，使点击资源后进入列表页；
- 修改前写入 `.codegen/aquasage/backups`。

所有补丁都应幂等：相同命令运行第二次必须是 `unchanged`，不能重复插入。

### 8.2 Elegant Router + `zh-cn.ts` 版本

`localeSynchronizer.js` 使用同一份 placement 构造 i18n key，并在需要时包含新父路由标题。它仍遵守原有保护规则：

- 占位标题可以自动替换；
- 已有人工中文默认保留；
- 只有 `--force` 才覆盖人工标题；
- 修改前备份并生成报告。

## 9. 第六步：用测试固定重构边界

本次新增的核心测试位于 `test/aquasage.test.js`：

1. 创建一个模拟河流水系参考模块；
2. 验证脚本能推断 `spatial-element` Service 分组；
3. 验证类型命名空间变为 `Api.SpatialElement`；
4. 验证页面落到指定的 `river-system` 父路由；
5. 验证参考资源隐藏时自动选择 `parent` 菜单模式；
6. 验证新父路由标题、图标、排序和列表重定向；
7. 验证第二次执行不会重复写入；
8. 验证 `--create-parent` 缺少显式目标路径时立即报错。

运行：

```powershell
npm run check
npm test
```

修改 renderer、placement 或 route patcher 时，这些测试是最低回归要求。

## 10. 实际使用：在已有父路由下生成

第一步只预览：

```powershell
node .\codegen.js aquasage `
  -s ".\openapi.json" `
  -p "D:\workCode\知识库\zdwp-aquasage-web" `
  --resource "/api/v1/hyo/channel" `
  --title "渠道" `
  --reference-view "src/views/knowledge-engineering/spatial-element/river-system/rivers" `
  --target-parent "/knowledge-engineering/spatial-element/river-system" `
  --dry-run
```

检查输出路径后，去掉 `--dry-run`。如果项目使用 `zh-cn.ts`，生成业务文件时加 `--no-routes`，然后运行：

```powershell
node .\codegen.js sync-zh-cn `
  -s ".\openapi.json" `
  -p "D:\workCode\知识库\zdwp-aquasage-web" `
  --resource "/api/v1/hyo/channel" `
  --title "渠道" `
  --reference-view "src/views/knowledge-engineering/spatial-element/river-system/rivers" `
  --target-parent "/knowledge-engineering/spatial-element/river-system"
```

## 11. 实际使用：创建新父路由

```powershell
node .\codegen.js aquasage `
  -s ".\openapi.json" `
  -p "D:\workCode\知识库\zdwp-aquasage-web" `
  --resource "/api/v1/hyo/channel" `
  --title "渠道" `
  --reference-view "src/views/knowledge-engineering/spatial-element/river-system/rivers" `
  --target-parent "/knowledge-engineering/hydrology-archive" `
  --create-parent `
  --parent-title "水文档案" `
  --parent-icon "mdi:archive-water" `
  --parent-order 8 `
  --menu-mode resource `
  --dry-run
```

确认产品信息架构和 dry-run 后再正式写入。新父路由并不意味着工具会自动理解全部产品需求，开发者仍需检查父级权限、图标、顺序和上层路由关系。

## 12. 如何读计划文件

正式生成后打开：

```text
zdwp-aquasage-web/.codegen/aquasage/plans/<slug>.json
```

建议按以下顺序检查：

1. `resource.basePath`：Swagger 资源是否选对；
2. `operations`：五类 CRUD 接口是否匹配正确；
3. `list`：查询字段、表格字段和分页响应路径是否正确；
4. `form`：详情主键和保存字段是否正确；
5. `placement.reference`：实际参考了哪个模块、识别到哪些页面；
6. `placement.resourceRoutePath`：目标路由是否正确；
7. `placement.serviceFile/typeFile/configFile/viewBase`：所有输出位置；
8. `placement.menu`：菜单显示方式和激活项；
9. `review`：契约缺失或参考模式差异的人工复核提醒。

计划正确但页面错误，优先检查 renderer；计划本身错误，分别回到 planner 或 placementResolver，不要直接在生成后的 Vue 中长期打补丁。

## 13. 后续扩展应该改哪一层

| 新需求                   | 应修改的位置                               |
| ------------------------ | ------------------------------------------ |
| 新的 CRUD 接口命名识别   | `planner.js`                               |
| 新的字段或控件推导       | `planner.js`、`renderer.js`                |
| 新的 AquaSage 页面族判定 | `placementResolver.js`                     |
| 新的目录或命名空间规则   | `placementResolver.js`                     |
| 新的页面结构             | `renderer.js`                              |
| 新的菜单/路由元数据      | `routePatcher.js`、`localeSynchronizer.js` |
| 文件冲突和备份策略       | `incrementalWriter.js`                     |
| 项目级诊断规则           | `validator.js`                             |

始终保持一个判断：这项变化是否来自 AquaSage 的稳定规范？如果只是某个页面的一次性特殊业务，应该生成后人工实现，或者先把它提升成明确、可测试的能力开关，不要让参考页面成为无边界的源码复制器。

## 14. 本次重构的最终心智模型

可以用一句话记住整个项目：

> planner 从 OpenAPI 回答“做什么”，placementResolver 根据 AquaSage 目标回答“放哪里”，renderer 回答“写成什么代码”，projectGenerator 负责“安全地写进去并证明没有新增问题”。

理解这四个问题后，以后再新增页面族、父路由或菜单规则，就能快速判断应该改哪一层，而不会重新把所有逻辑堆回 `codegen.js` 或 Vue 模板中。
