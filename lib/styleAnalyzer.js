/*
 * @title: 
 */
// lib/styleAnalyzer.js
import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import * as path from "path";
import { readFiles } from "../tools/read_file.js";

// 自动收集关联文件（与第二阶段 agent.js 相同）
export async function collectRelatedFiles(entryPath) {
  const visited = new Set();
  const filePaths = [];

  async function traverse(currentPath) {
    const absPath = path.resolve(currentPath);
    if (visited.has(absPath)) return;
    visited.add(absPath);
    filePaths.push(absPath);

    const content = (await readFiles(absPath))[absPath];
    if (!content || content.startsWith("[Error")) return;

    const importRegex =
      /import\s+\w+\s+from\s+['"](\.\/[^'"]+\.vue|\.\.\/[^'"]+\.vue)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];
      const nextPath = path.join(path.dirname(absPath), importPath);
      await traverse(nextPath);
    }
  }

  await traverse(entryPath);
  return filePaths;
}

const systemTemplate = `你是一个前端架构分析专家。请分析以下 CRUD 模块的代码，提取列表页、表单组件以及**详情/编辑页**的风格和协作模式。

代码文件如下：
{codeBlocks}

如果代码中存在路由跳转到另一个页面的情况（如 router.push('/xxx/detail')），请额外分析该详情页的文件（如果能获取到），若无则基于列表页推断详情页模式。

请生成一份结构化的风格规范，格式使用 YAML，必须包含以下部分：
- ui: 使用的 UI 框架和主要组件
- page_patterns:
  - list_page: 列表页典型结构（搜索、表格、分页、操作按钮等）
  - form_component: 表单组件外部接口和内部结构（如果存在）
  - detail_page: （如有）详情页的布局模式、数据加载方式、表单/展示模式等
- collaboration_flow: 
  - add_flow: 新增流程
  - edit_flow: 编辑流程（是否为跳转到详情页）
  - delete_flow: 删除流程
- routing_pattern: （如有）编辑跳转的路由命名、参数传递方式等

输出时请用 \`\`\`yaml 包裹整个规范，不要有其他多余文字。`;

export async function analyzeStyle(entryPath, modelName = "deepseek-v4-pro") {
  console.log("🧠 开始分析项目代码风格...");
  const allFilePaths = await collectRelatedFiles(entryPath);
  console.log(`📄 读取 ${allFilePaths.length} 个关联文件`);
  const fileMap = await readFiles(allFilePaths);

  const codeBlocks = allFilePaths
    .map((fp) => {
      const content = fileMap[fp] || "[读取失败]";
      const relativeName = path.relative(process.cwd(), fp);
      return `### ${relativeName}\n\`\`\`vue\n${content}\n\`\`\``;
    })
    .join("\n\n");

  const prompt = ChatPromptTemplate.fromMessages([["system", systemTemplate]]);
  const model = new ChatOpenAI({
    temperature: 0.1,
    modelName,
    streaming: true,
  });
  const chain = prompt.pipe(model).pipe(new StringOutputParser());

  console.log("⏳ 分析中...");
  let fullResponse = "";
  const stream = await chain.stream({ codeBlocks });
  for await (const chunk of stream) {
    process.stdout.write(chunk);
    fullResponse += chunk;
  }
  console.log("\n✅ 分析完成");
  return fullResponse;
}