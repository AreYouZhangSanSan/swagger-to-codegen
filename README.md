# Swagger to Codegen

基于 Swagger/OpenAPI 文档的前端代码自动生成工具，可快速生成 API 调用代码和业务页面。

当前项目以服务 `zdwp-aquasage-web` 为核心目标：优先保证生成结果符合该项目的 SoybeanAdmin、Naive UI、工程名录目录结构和公共组件约定，不为兼容其他项目而改变生成规范。

## 功能特性

- **API 生成**：从 Swagger 文档自动生成 TypeScript API 模块和类型定义
- **页面生成**：基于参考模板 + LLM 智能生成业务页面
- **字段替换**：自动将模板中的业务字段替换为目标模块的字段
- **模块独立类型**：每个 API 模块生成独立的 `types/<module>.d.ts`，避免不同 tag 互相覆盖
- **AquaSage 专用生成**：直接生成 service、typings、字段配置、列表页、详情页和附件页
- **增量写入保护**：识别人工修改，默认生成冲突候选，使用 `--force` 时先备份再覆盖

## 推荐主流程：直接生成 zdwp-aquasage-web 页面

`aquasage` 是推荐入口，不依赖参考模板，生成结果可直接写入 `zdwp-aquasage-web`。

### 使用示例

#### 完整示例：预览水体相关页面

```powershell
node .\codegen.js aquasage `
  -s "http://10.10.1.206:8000/api/v1/openapi.json" `
  -p "D:\workCode\知识库\2026-08-10-1\zdwp-aquasage-web" `
  -m "水体相关" `
  --dry-run
```

确认生成计划后去掉 `--dry-run`：

```powershell
node .\codegen.js aquasage `
  -s "http://10.10.1.206:8000/api/v1/openapi.json" `
  -p "D:\workCode\知识库\2026-08-10-1\zdwp-aquasage-web" `
  -m "水体相关"
```

### 生成的业务页面

```text
zdwp-aquasage-web/
├── src/service/api/engineering-catalog/<slug>.ts
├── src/typings/api/engineering-catalog/<namespace>.d.ts
├── src/config/engineering/<slug>-fields.ts
└── src/views/knowledge-engineering/engineering-catalog/<slug>/
    ├── list/index.vue
    ├── detail/index.vue
    └── attachment/index.vue
```

可以使用 `--resource` 精确选择一个 API 资源，使用 `--module` 选择一个 Swagger tag，或者显式使用 `--all` 生成全部资源。建议第一次始终添加 `--dry-run`。

## 安装依赖

```bash
npm install
```

## 配置

在项目根目录创建 `.env` 文件，配置 LLM API：

```env
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_MODEL=你的模型名称
# 或使用其他兼容 OpenAI API 格式的模型服务
```

`aquasage`、`analyze`、`plan` 和 `api` 的确定性部分不依赖 LLM；`style`、`page` 和 `generate` 的模板页面流程需要可用的 LLM 配置。

## 命令行使用

### 0. 生成前分析

```powershell
node .\codegen.js analyze -s "<Swagger URL 或本地文件>" -o "<分析报告>"
```

**参数说明：**

- `-s, --swagger <url-or-file>`：Swagger/OpenAPI URL 或本地 JSON/YAML 文件
- `-o, --output <path>`：分析报告路径，默认为 `codegen-plan.json`

#### 使用示例：分析当前 OpenAPI

```powershell
node .\codegen.js analyze `
  -s "http://10.10.1.206:8000/api/v1/openapi.json" `
  -o ".\codegen-plan.json"
```

#### 生成结果

```text
codegen-plan.json
```

报告包含 CRUD 角色、判断证据、置信度、人工复核项和模块覆盖率。

### 0.1 生成确定性 UI 计划

```powershell
node .\codegen.js plan -s "<Swagger URL 或本地文件>" -m "<Swagger tag>" -o "<UI 计划>"
```

#### 使用示例：生成水体相关 UI 计划

```powershell
node .\codegen.js plan `
  -s "http://10.10.1.206:8000/api/v1/openapi.json" `
  -m "水体相关" `
  -o ".\ui-plan-hyo.json"
```

#### 生成结果

```text
ui-plan-hyo.json
```

计划包含 API 函数绑定、搜索字段、表格字段、表单字段、控件、校验、分页参数和响应路径。

### 1. 生成 API 和类型文件

```bash
node codegen.js api -s <swagger-url> -m <module-tag> -o <output-dir>
```

**参数说明：**

- `-s, --swagger <url>`：Swagger 文档地址（必填）
- `-m, --module <tag>`：指定模块 tag，如"用户管理"、"订单管理"
- `-o, --output <dir>`：输出目录，默认为 `./src/api`
- `-t, --template <path>`：参考模板路径（提供则同时生成页面）
- `-p, --page-output <dir>`：页面输出目录（需配合 -t 使用）
- `--api-import-path`：API 导入路径前缀，默认为 `@/api/modules`

**示例：**

```bash
# 仅生成 API
node codegen.js api -s http://localhost:8080/api/v1/openapi.json -m 用户管理

# 生成 API + 页面
node codegen.js api -s http://localhost:8080/api/v1/openapi.json -m 用户管理 -t ./templates/List.vue -p ./src/views
```

#### 完整示例：仅生成水体相关 API 和类型

```powershell
node .\codegen.js api `
  -s "http://10.10.1.206:8000/api/v1/openapi.json" `
  -m "水体相关" `
  -o ".\src\api"
```

#### 生成的 API 和类型文件

```text
src/api/
├── modules/hyo.ts
├── types/hyo.d.ts
└── .codegen/
    ├── manifest.json
    ├── ui-plan.json
    └── reports/
```

每个模块生成独立类型文件，例如 `geology.ts` 对应 `geology.d.ts`。如果发现人工修改冲突，命令会以失败状态退出并打印候选文件；确认覆盖时添加 `--force`。

### 2. 仅生成页面（基于已有 API 文件）

```bash
node codegen.js page --api-file <api-file> -t <template> -o <output>
```

**参数说明：**

- `--api-file <path>`：API 模块文件路径（如 `./src/api/modules/user.ts`）
- `-t, --template <path>`：参考列表页模板路径
- `--form-template <path>`：参考表单组件模板路径
- `-o, --output <dir>`：页面输出目录，默认为 `./src/views`
- `--api-import-path`：API 导入路径前缀

**示例：**

```bash
node codegen.js page --api-file ./src/api/modules/user.ts -t ./templates/List.vue -o ./src/views
```

#### 完整示例：基于水体 API 生成页面

```powershell
node .\codegen.js page `
  --api-file ".\src\api\modules\hyo.ts" `
  --style-guide ".\style-guide.yaml" `
  -t "D:\ref-project\list\index.vue" `
  --form-template "D:\ref-project\detail\index.vue" `
  --ui-plan ".\src\api\.codegen\ui-plan.json" `
  --api-import-path "@/api/modules" `
  -o ".\src\views"
```

#### 生成的业务页面

```text
src/views/
├── list/index.vue
└── detail/index.vue
```

`page` 会优先读取与 API 同名的类型文件，例如 `modules/hyo.ts` 对应 `types/hyo.d.ts`。

### 3. 全流程生成（API + 页面）

```bash
node codegen.js generate -s <swagger-url> -m <module> -t <template> -o <output>
```

#### 完整示例：一次生成政策 API、类型和页面

```powershell
node .\codegen.js generate `
  -s "http://10.10.1.206:8000/api/v1/openapi.json" `
  -m "政策相关" `
  -t "D:\ref-project\list\index.vue" `
  --form-template "D:\ref-project\detail\index.vue" `
  --style-guide ".\style-guide.yaml" `
  --api-output ".\src\api" `
  --api-import-path "@/api/modules" `
  -o ".\src\views"
```

#### 生成结果

```text
src/api/modules/policy.ts
src/api/types/policy.d.ts
src/views/list/index.vue
src/views/detail/index.vue
```

### 4. 分析页面风格（生成风格规范）

```bash
node codegen.js style <list-page-path> -o <output>
```

#### 完整示例：分析参考列表页

```powershell
node .\codegen.js style `
  "D:\ref-project\list\index.vue" `
  -o ".\style-guide.yaml"
```

#### 生成结果

```text
style-guide.yaml
```

## 增量生成与人工代码保护

生成输出目录会包含：

```text
.codegen/
├── manifest.json       # 上一次成功写入的机器生成摘要
├── reports/            # 每次生成的 JSON 审计报告
├── conflicts/          # 人工修改与新结果冲突时的候选文件
└── backups/            # 使用 --force 覆盖前的备份
```

文件处理策略：

| 条件                     | 动作                               |
| ------------------------ | ---------------------------------- |
| 文件不存在               | 创建并记录摘要                     |
| 内容与新生成结果相同     | 标记为 `unchanged`                 |
| 内容等于上次机器生成摘要 | 安全更新                           |
| 内容偏离上次机器生成摘要 | 保留人工文件，候选写入 `conflicts` |
| 使用 `--force`           | 先写入 `backups`，再覆盖           |

不要通过删除 `manifest.json` 绕过冲突保护；没有可信基线的已有文件会被视为人工文件。

## 项目结构

```
swagger-to-codegen/
├── codegen.js              # CLI 入口
├── lib/
│   ├── aquasage/          # AquaSage 专用规划、渲染、路由和校验
│   ├── parser.js           # Swagger 文档解析
│   ├── generator.js         # API 和类型文件生成
│   ├── contractAnalyzer.js  # CRUD 契约分析
│   ├── uiPlanner.js         # 确定性 UI 计划
│   ├── incrementalWriter.js # 增量写入与人工代码保护
│   ├── pageGenerator.js     # 页面代码生成
│   ├── styleAnalyzer.js     # 页面风格分析
│   ├── extractSkeletonFromFiles.js  # 从 API 文件提取骨架
│   └── formatCode.js        # 代码格式化
├── tools/
│   └── read_file.js        # 高性能文件读取
├── templates/              # 参考模板目录
└── src/api/               # 生成的 API 输出目录
```

## 工作流程

```
┌─────────────────┐
│  Swagger 文档    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   API 生成       │──▶ API 模块 (.ts)
│   (codegen.js)  │──▶ 类型定义 (.d.ts)
└────────┬────────┘
         │
         ▼ (可选)
┌─────────────────┐
│   页面生成       │
│   + LLM 智能替换 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   业务页面       │
│   List.vue      │
│   Detail.vue   │
└─────────────────┘
```

## 使用示例

### 完整示例：生成政策相关页面

```powershell
# 1. 从 Swagger 生成 API
node .\codegen.js api `
  -s "http://10.10.1.206:8000/api/v1/openapi.json" `
  -m "政策相关" `
  -o ".\src\api"

# 2. 基于参考模板生成页面
node .\codegen.js page `
  --api-file ".\src\api\modules\policy.ts" `
  -t "D:\ref-project\list\index.vue" `
  --api-import-path "@/api/modules" `
  -o ".\src\views"
```

## 输出示例

### 生成的 API 文件

```typescript
// src/api/modules/policy.ts
import { request } from "../../request";
import type { PolicyCreateRequest, PolicyItem } from "../types/policy";

export function fetchQueryPolicyPage(params: {
  current?: number;
  size?: number;
  title?: string;
}) {
  return request({ url: "/api/v1/policy/page", method: "get", params });
}

export function fetchCreatePolicy(data: PolicyCreateRequest) {
  return request({ url: "/api/v1/policy/create", method: "post", data });
}
// ...
```

### 生成的业务页面

自动生成与参考模板结构一致的页面，但使用目标模块的 API 和业务字段。

```text
src/api/modules/policy.ts
src/api/types/policy.d.ts
src/views/list/index.vue
src/views/detail/index.vue
```

## 注意事项

1. **模型配置**：确保 `.env` 中配置了可用的 LLM API
2. **模板路径**：Windows 系统下路径使用反斜杠或引号包裹
3. **API 兼容性**：LLM 需要兼容 OpenAI API 格式
4. **依赖版本**：Node.js >= 20.19.0
5. **模块类型文件**：新版本使用 `types/<module>.d.ts`；旧的 `types/api.d.ts` 不会自动删除
6. **内网 Swagger**：无法访问时可先下载为本地 JSON/YAML，再将 `-s` 指向本地文件

## License

ISC
