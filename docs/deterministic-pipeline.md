# 从接口契约到前端代码的确定性流水线

## 原则

```text
能从契约、工程配置或静态分析得到唯一答案的问题，交给脚本。
需要审美、表达、解释或多种合理选择的问题，才交给 LLM。
```

## 推荐流水线

| 阶段 | 输入 | 输出 | 执行者 |
|---|---|---|---|
| 文档读取 | URL/本地文件 | 原始契约 | 脚本 |
| 格式校验 | 原始契约 | 合法OpenAPI对象 | 脚本 |
| 引用解析 | schemas、`$ref`、`allOf` | 规范化Schema | 脚本 |
| 模块分组 | tags、paths | 模块接口集合 | 脚本 |
| CRUD识别 | 方法、路径、operationId | 角色、证据、置信度 | 脚本 |
| 类型闭包 | 接口直接类型 | 必要类型集合 | 脚本 |
| API生成 | 操作及Schema | TypeScript API | 脚本 |
| 字段规划 | 请求/响应Schema | 搜索、表格、表单字段 | 脚本 |
| 控件映射 | 类型、format、enum | input/select/date等 | 脚本 |
| 校验规划 | required、范围、pattern | 表单规则 | 脚本 |
| 数据适配 | 响应包装和分页结构 | dataPath、totalPath | 脚本 |
| 页面骨架 | UI Plan | API绑定和状态骨架 | 脚本，下一阶段继续增强 |
| 视觉布局 | 骨架、风格样本 | Vue模板表达 | LLM |
| 文案 | 字段含义、业务上下文 | 标题、提示、空状态 | LLM |
| 静态检查 | 候选代码 | 错误列表 | 脚本 |
| 局部修复 | 错误、IR节点、候选代码 | 修复候选 | LLM |
| 增量合并 | 三类摘要 | 更新/冲突/备份 | 脚本 |

## 当前已由脚本确定

### 契约层

- JSON/YAML识别；
- 文档结构校验；
- 网络超时；
- Tag分组；
- 路径参数插值；
- 查询参数和请求体；
- 成功响应Schema；
- 嵌套类型引用闭包。

### 业务操作层

- list/detail/create/update/delete角色；
- 角色判断证据和置信度；
- 低置信度复核标记；
- API函数名及调用签名。

### UI Plan层

- 搜索字段来源于列表接口query参数；
- 表格字段来源于列表响应项Schema；
- 表单字段来源于创建/更新请求Schema；
- 系统字段和敏感字段过滤；
- required、minLength、maxLength、minimum、maximum、pattern；
- enum映射select；
- boolean映射switch；
- date/date-time映射日期控件；
- number/integer映射数字控件；
- 长文本映射textarea；
- 文件字段映射upload；
- page/current/pageNum和size/pageSize/limit分页参数；
- data/result/payload响应包装；
- records/rows/list/items/content列表路径；
- total/totalElements/count总数路径；
- 允许字段白名单和禁止行为。

### 质量和写入层

- 输出路径边界检查；
- Prettier格式化；
- 临时文件类型检查；
- 最大修复次数；
- SHA-256生成基线；
- 人工修改冲突检测；
- 强制覆盖前备份；
- 原子写入；
- 运行报告。

## LLM只应该负责

- 页面区域如何排列；
- 按钮和空状态文案；
- 字段英文标识对应的自然语言标签润色；
- 交互反馈的表达；
- 根据参考项目选择已有布局组件；
- 对静态错误进行限定范围修复；
- 对生成结果进行解释和总结。

LLM不应负责：API路径、函数名、字段是否存在、字段类型、是否必填、分页参数、响应数据路径、路由参数名称和文件写入决策。

## 下一阶段确定性增强

1. 使用TypeScript AST而不是正则解析已有API文件；
2. 解析OpenAPI path级公共参数、security、servers和多content-type；
3. 完整支持discriminator、additionalProperties和循环引用；
4. 生成确定性`useCrud.generated.ts` composable，把请求状态和API调用也从LLM移出；
5. 生成路由记录、菜单权限键和国际化key；
6. 生成MSW/mock数据、API契约测试和页面冒烟测试；
7. 将静态错误映射到UI Plan节点，只允许LLM修改对应表达层；
8. 使用AST保护生成区域，实现节点级增量合并。

其中第4项优先级最高。完成后，LLM输出的Vue文件只需要消费一个类型完整的composable并表达页面布局，即使更换模型也不会改变数据获取、提交、分页和错误处理逻辑。
