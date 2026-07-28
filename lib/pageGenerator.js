// lib/pageGenerator.js
import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import * as fs from "fs/promises";
import * as path from "path";
import * as yaml from "js-yaml";
import { formatVueCode, checkTypes } from "./formatCode.js";

const MAX_RETRIES = 3;

/**
 * 生成页面主函数
 * @param {Object} options
 * @param {Object} options.skeleton - 接口骨架
 * @param {string} options.styleGuidePath - 风格规范文件路径
 * @param {string} [options.listTemplatePath] - 参考列表页模板路径（可选）
 * @param {string} [options.formTemplatePath] - 参考表单组件模板路径（可选）
 * @param {string} options.outputDir - 页面输出目录（如 ./src/views）
 * @param {string} [options.apiImportPath] - API 导入路径前缀
 */
export async function generatePages({
  skeleton,
  styleGuidePath,
  listTemplatePath,
  formTemplatePath,
  outputDir,
  apiImportPath = "@/api/modules",
}) {
  // 1. 读取风格规范（可选）
  let styleGuide = "";
  if (styleGuidePath) {
    try {
      styleGuide = await fs.readFile(styleGuidePath, "utf-8");
    } catch (error) {
      console.warn(`⚠️ 未找到风格规范文件 ${styleGuidePath}，将仅依赖模板生成`);
    }
  }

  // 2. 安全读取列表模板
  let listTemplate = "";
  if (listTemplatePath) {
    try {
      listTemplate = await fs.readFile(listTemplatePath, "utf-8");
    } catch {
      console.warn(`⚠️ 参考模板 ${listTemplatePath} 不存在，将不使用模板`);
    }
  } else {
    console.log("ℹ️ 未提供参考列表模板，将仅根据风格规范和骨架生成");
  }

  // 3. 安全读取表单模板
  let formTemplate = null;
  if (formTemplatePath) {
    try {
      formTemplate = await fs.readFile(formTemplatePath, "utf-8");
    } catch {
      console.warn(`⚠️ 表单模板 ${formTemplatePath} 不存在`);
    }
  }

  // 4. 构建 Prompt（纯文本，避免 LangChain 模板解析问题）
  const promptText = buildPromptText(skeleton, styleGuide, listTemplate, formTemplate, apiImportPath);

  const model = new ChatOpenAI({ temperature: 0.1, modelName: "deepseek-v4-pro" });

  console.log("🧠 正在生成页面代码...");
  let generatedText;
  try {
    const response = await model.invoke(promptText);
    generatedText = typeof response === 'string' ? response : response.content;
  } catch (error) {
    console.error("❌ LLM 调用失败:", error.message);
    return;
  }

  // 5. 解析多文件（支持目录结构）
  const files = extractVueFiles(generatedText);
  if (Object.keys(files).length === 0) {
    console.warn("⚠️ 未识别到 Vue 文件，原始输出：", generatedText);
    return;
  }

  // 6. 写入文件并自动修复（自动创建子目录）
  await fs.mkdir(outputDir, { recursive: true });
  for (const [relativePath, code] of Object.entries(files)) {
    const fullPath = path.join(outputDir, relativePath);
    // 确保父目录存在
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await writeAndFix(fullPath, code, model);
  }
  console.log("✅ 页面生成完毕");
}

/**
 * 构建发送给 LLM 的 Prompt（骨架强制优先，要求输出 views/list/index.vue 和 views/detail/index.vue）
 */
function buildPromptText(skeleton, styleGuide, listTemplate, formTemplate, apiImportPath) {
  const mod = skeleton.module;

  // 构建 API 函数表（直观表格）
  const apiTable = `
| 功能 | 函数名 | 路径 | 请求参数（骨架内） | 响应/请求体字段 |
|------|--------|------|-------------------|----------------|
${skeleton.listApi ? `| 列表查询 | ${skeleton.listApi.funcName} | ${skeleton.listApi.path} | ${JSON.stringify(skeleton.listApi.queryParams)} | 表格列: ${(skeleton.listApi.columns || []).map(c => c.field).join(', ')} |` : ''}
${skeleton.detailApi ? `| 获取详情 | ${skeleton.detailApi.funcName} | ${skeleton.detailApi.path} | - | 字段: ${(skeleton.detailApi.responseFields || []).map(f => f.name).join(', ')} |` : ''}
${skeleton.createApi ? `| 新增 | ${skeleton.createApi.funcName} | ${skeleton.createApi.path} | body: {${(skeleton.createApi.bodyFields || []).map(f => f.name).join(', ')}} | - |` : ''}
${skeleton.updateApi ? `| 更新 | ${skeleton.updateApi.funcName} | ${skeleton.updateApi.path} | body: {${(skeleton.updateApi.bodyFields || []).map(f => f.name).join(', ')}} | - |` : ''}
${skeleton.deleteApi ? `| 删除 | ${skeleton.deleteApi.funcName} | ${skeleton.deleteApi.path} | - | - |` : ''}
`;

  let text = `你是一个专业的前端开发者，现在需要为 "${mod}" 模块生成一个完整的 CRUD 前端页面。

## 绝对强制规则（违反会导致生成失败）

1. **所有 API 函数必须从以下路径导入：**
   \`import { ${skeleton.listApi?.funcName}, ${skeleton.detailApi?.funcName}, ${skeleton.createApi?.funcName}, ${skeleton.updateApi?.funcName}, ${skeleton.deleteApi?.funcName} } from '${apiImportPath}/${mod}';\`

2. **上面导入的函数名和路径一个字都不能改**，必须原样使用。

3. **表格列字段、表单字段、搜索字段**必须严格按照下面的“API 函数表”中的字段生成，**不得使用风格规范中的示例字段**。

4. **如果你生成任何风格规范中的业务字段（如 relic_name, protect_name 等），就视为失败**。

## API 函数表（这是本次生成的唯一数据源）
${apiTable}

## 风格规范（仅用于确定 UI 结构和交互方式，不包含本次的业务字段）
${styleGuide || '无'}

## 参考模板（仅用于参考代码组织方式、composable 用法、组件封装模式，必须将所有业务字段替换为上面的模块字段）
${listTemplate ? '### 列表页参考\n```vue\n' + listTemplate + '\n```\n' : ''}
${formTemplate ? '### 表单参考\n```vue\n' + formTemplate + '\n```\n' : ''}

## 生成要求

请生成以下文件，**文件路径必须包含模块名 "${mod}"**：
1. **${mod}/list/index.vue** - 列表页，包含：
   - 搜索区域（根据 API 表，如果查询参数不为空则生成搜索表单）
   - 表格展示（使用 API 表中列表查询的列字段）
   - 分页（可参考风格规范中的分页模式）
   - 新增按钮 → 如果风格规范是弹窗新增，则使用 NModal + EngineeringForm；如果是跳转新增，则用路由跳转
   - 操作列：编辑、删除按钮。如果风格规范中编辑是跳转到详情页，则必须生成 \`router.push\` 跳转到详情页；如果是弹窗编辑，则使用弹窗模式。
   - 删除：使用 NPopconfirm 确认后调用删除函数

2. **${mod}/detail/index.vue** - 详情/编辑页，要求：
   - 如果是编辑模式（通过路由参数 \`id\` 区分），页面加载时调用骨架中的详情获取函数
   - 表单字段使用 API 表中新增/更新请求体字段
   - 表单 UI 风格参照风格规范中的 \`form_component\` 或 \`detail_page\` 模式
   - 如果是新增模式（路由中无 id 或 mode=create），则表单可为空，提交时调用新增函数
   - 保存按钮调用新增或更新函数，成功后返回或提示

## 输出格式
每个文件用以下格式包裹（不要额外解释）：
### 文件: ${mod}/list/index.vue
\`\`\`vue
...完整代码...
\`\`\`
### 文件: ${mod}/detail/index.vue
\`\`\`vue
...完整代码...
\`\`\`
`;

  return text;
}

/**
 * 从 LLM 返回文本中提取 Vue 文件，支持子目录结构
 */
function extractVueFiles(text) {
  const files = {};
  // 匹配 ### 文件: xxx/xxx/xxx.vue 然后 ```vue 代码 ```
  const regex = /###\s*文件:\s*(.+?\.vue)\s*\n```vue\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const filePath = match[1].trim();
    const code = match[2];
    files[filePath] = code;
  }
  return files;
}

/**
 * 写入文件并进行类型检查，失败时自动调用 LLM 修复
 */
async function writeAndFix(filePath, code, model) {
  let currentCode = code;
  for (let i = 0; i <= MAX_RETRIES; i++) {
    let formatted;
    try {
      formatted = await formatVueCode(currentCode);
    } catch (error) {
      console.warn(`⚠️ Prettier 格式化失败: ${error.message}，将使用原始代码`);
      formatted = currentCode;
    }

    await fs.writeFile(filePath, formatted);
    console.log(`📝 ${filePath} 已写入 (尝试 ${i + 1})`);

    const check = await checkTypes(filePath);
    if (check.success) {
      console.log(`✅ ${filePath} 类型检查通过`);
      return;
    }

    if (i === MAX_RETRIES) {
      console.error(`❌ ${filePath} 类型检查失败，已达最大重试次数`);
      console.error("错误信息:", check.errors);
      return;
    }

    console.log(`⚠️ 类型错误，正在请求 LLM 修复...`);
    try {
      currentCode = await fixWithLLM(filePath, check.errors, model);
    } catch (error) {
      console.error("❌ 修复请求失败:", error.message);
      return;
    }
  }
}

/**
 * 使用 LLM 修复类型错误
 */
async function fixWithLLM(filePath, errors, model) {
  const code = await fs.readFile(filePath, "utf-8");
  const fixPrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "你是一个 Vue3 专家，请根据类型错误修复代码。只输出修复后的完整代码，不要任何解释。",
    ],
    [
      "user",
      `文件 ${filePath} 存在以下类型错误：
${errors}

当前代码：
\`\`\`vue
${code}
\`\`\`

请修复并输出完整代码。`,
    ],
  ]);

  const response = await fixPrompt
    .pipe(model)
    .pipe(new StringOutputParser())
    .invoke({});

  const match = response.match(/```vue\n([\s\S]*?)```/);
  return match ? match[1] : response;
}