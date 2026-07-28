# Swagger to Codegen

基于 Swagger/OpenAPI 文档的前端代码自动生成工具，可快速生成 API 调用代码和业务页面。

## 功能特性

- **API 生成**：从 Swagger 文档自动生成 TypeScript API 模块和类型定义
- **页面生成**：基于参考模板 + LLM 智能生成业务页面
- **字段替换**：自动将模板中的业务字段替换为目标模块的字段
- **多框架支持**：支持 Naive UI、Element Plus 等主流 UI 框架

## 安装依赖

```bash
npm install
```

## 配置

在项目根目录创建 `.env` 文件，配置 LLM API：

```env
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://api.deepseek.com/v1
# 或使用其他兼容 OpenAI API 格式的模型服务
```

## 命令行使用

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

### 3. 全流程生成（API + 页面）

```bash
node codegen.js generate -s <swagger-url> -m <module> -t <template> -o <output>
```

### 4. 分析页面风格（生成风格规范）

```bash
node codegen.js style <list-page-path> -o <output>
```

## 项目结构

```
swagger-to-codegen/
├── codegen.js              # CLI 入口
├── lib/
│   ├── parser.js           # Swagger 文档解析
│   ├── generator.js         # API 和类型文件生成
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

```bash
# 1. 从 Swagger 生成 API
node codegen.js api -s http://10.10.1.206:8000/api/v1/openapi.json -m 政策相关 -o ./src/api

# 2. 基于参考模板生成页面
node codegen.js page --api-file ./src/api/modules/policy.ts -t D:\ref-project\list\index.vue -o ./src/views
```

## 输出示例

### 生成的 API 文件

```typescript
// src/api/modules/policy.ts
import { request } from "../../request";
import { PolicyCreateRequest, PolicyItem } from "./types/api.d";

export function fetchQueryPolicyPage(params: { current?: number; size?: number; title?: string }) {
  return request({ url: "/api/v1/policy/page", method: "get", params });
}

export function fetchCreatePolicy(data: PolicyCreateRequest) {
  return request({ url: "/api/v1/policy/create", method: "post", data });
}
// ...
```

### 生成的业务页面

自动生成与参考模板结构一致的页面，但使用目标模块的 API 和业务字段。

## 注意事项

1. **模型配置**：确保 `.env` 中配置了可用的 LLM API
2. **模板路径**：Windows 系统下路径使用反斜杠或引号包裹
3. **API 兼容性**：LLM 需要兼容 OpenAI API 格式
4. **依赖版本**：Node.js 18+ 推荐

## License

ISC
