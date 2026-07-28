/**
 * 统一CLI入口
 */
// codegen.js
import "dotenv/config";
import { program } from "commander";
import prettier from "prettier";
import fs from "fs";
import path from "path";
import { loadSwagger, groupByTag, getAllSchemas } from "./lib/parser.js";
import { generateApiFile, generateTypeFile } from "./lib/generator.js";
import { analyzeStyle } from "./lib/styleAnalyzer.js";
import { extractSkeletonFromFiles } from "./lib/extractSkeletonFromFiles.js";
import { generatePages } from "./lib/pageGenerator.js";

program
  .name("codegen")
  .description("前端代码自动生成工具（Swagger → API/类型 → 页面）")
  .version("2.0.0");

// ---- 子命令：api（生成 API，可选同时生成页面） ----
program
  .command("api")
  .description("从 Swagger 生成 API 和类型文件（可同时生成页面）")
  .requiredOption("-s, --swagger <url>", "Swagger 文档 URL")
  .option("-o, --output <dir>", "输出目录", "./src/api")
  .option("-m, --module <tag>", "指定模块 tag")
  .option("-t, --template <path>", "参考列表页模板路径（提供则同时生成页面）")
  .option("--form-template <path>", "参考表单组件模板路径")
  .option("-p, --page-output <dir>", "页面输出目录（需配合 -t 使用）", "./src/views")
  .option("--api-import-path <path>", "API 导入路径前缀", "@/api/modules")
  .action(async (options) => {
    const { swagger, output, module: targetModule, template, formTemplate, pageOutput, apiImportPath } = options;
    console.log(`🚀 加载 Swagger: ${swagger}`);
    const swaggerDoc = await loadSwagger(swagger);
    const groups = groupByTag(swaggerDoc);
    const schemas = getAllSchemas(swaggerDoc);
    const tags = targetModule ? [targetModule] : Object.keys(groups);
    if (tags.length === 0) {
      console.log("❌ 未找到接口");
      return;
    }
    const apiDir = path.join(output, "modules");
    const typesDir = path.join(output, "types");
    fs.mkdirSync(apiDir, { recursive: true });
    fs.mkdirSync(typesDir, { recursive: true });
    const prettierConfig = await prettier.resolveConfig(process.cwd());
    const allUsedTypes = new Set();
    let generatedModuleName = null;
    for (const tag of tags) {
      const endpoints = groups[tag];
      if (!endpoints?.length) {
        console.log(`⚠️ 未找到模块 "${tag}"`);
        continue;
      }
      const { code, fileName, usedTypes } = generateApiFile(
        tag,
        endpoints,
        schemas
      );
      usedTypes.forEach((t) => allUsedTypes.add(t));
      generatedModuleName = fileName;
      const formatted = await prettier.format(code, {
        ...prettierConfig,
        parser: "typescript",
      });
      fs.writeFileSync(path.join(apiDir, `${fileName}.ts`), formatted);
      console.log(`✅ API: ${fileName}.ts`);
    }
    const typeCode = generateTypeFile(schemas, allUsedTypes);
    const formattedType = await prettier.format(typeCode, {
      ...prettierConfig,
      parser: "typescript",
    });
    fs.writeFileSync(path.join(typesDir, "api.d.ts"), formattedType);
    console.log("✅ 类型文件已生成");

    // 如果提供了模板，同时生成页面
    if (template && generatedModuleName) {
      console.log("📄 开始生成页面...");
      const apiFile = path.join(apiDir, `${generatedModuleName}.ts`);
      const moduleName = generatedModuleName;
      const typesDirPath = path.join(output, "types");
      const skeleton = extractSkeletonFromFiles(apiDir, typesDirPath, moduleName);
      const viewDir = path.join(pageOutput || "./src/views", moduleName);
      await generatePages({
        skeleton,
        styleGuidePath: "",  // 不使用风格规范
        listTemplatePath: template,
        formTemplatePath: formTemplate,
        outputDir: viewDir,
        apiImportPath,
      });
      console.log(`🎉 页面生成完毕：${viewDir}`);
    }
  });

// ---- 子命令：style（第二阶段独立功能） ----
program
  .command("style")
  .description("分析参考页面代码，生成风格规范")
  .argument("<file>", "列表页文件路径")
  .option("-o, --output <path>", "风格规范输出路径", "style-guide.yaml")
  .action(async (file, options) => {
    const yamlContent = await analyzeStyle(file);
    await fs.promises.writeFile(options.output, yamlContent);
    console.log(`📁 风格规范已保存到 ${options.output}`);
  });
// ---- 子命令：page（仅生成页面，基于已有 API 文件和风格规范生成页面） ----
program
  .command("page")
  .description("基于已生成的 API 文件和风格规范生成视图页面（极简模式）")
  .requiredOption("--api-file <path>", "API 模块文件路径（如 ./src/api/modules/user.ts）")
  .option("--style-guide <path>", "风格规范文件路径", "style-guide.yaml")
  .option("-t, --template <path>", "参考列表页模板路径（可选，不提供则仅依靠风格规范）")
  .option("--form-template <path>", "参考表单组件模板路径")
  .option("-o, --output <dir>", "页面输出目录", "./src/views")
  .option("--api-import-path <path>", "API 导入路径前缀", "@/api/modules")
  .action(async (options) => {
    const {
      apiFile,
      styleGuide,
      template,
      formTemplate,
      output,
      apiImportPath,
    } = options;

    // 从文件路径解析模块名（例如 user.ts → user）
    const moduleName = path.basename(apiFile, ".ts");
    // 假设 api.d.ts 在同一父目录的 types 子目录下
    const apiDir = path.dirname(apiFile);            // ./src/api/modules
    const typesDir = path.join(apiDir, "..", "types"); // ./src/api/types

    // 1. 提取骨架（复用已有函数，传入 apiDir 而不是文件路径）
    //    需要调整 extractSkeletonFromFiles 使其能通过文件路径定位
    const skeleton = extractSkeletonFromFiles(
      path.dirname(apiFile),  // api 模块目录
      typesDir,
      moduleName
    );

    // 2. 生成页面
    const viewDir = output;
    await generatePages({
      skeleton,
       styleGuidePath: styleGuide,
      listTemplatePath: template,   // 可能是 undefined
      formTemplatePath: formTemplate,
      outputDir: viewDir,
      apiImportPath,
    });
    console.log(`🎉 页面生成完毕：${viewDir}`);
  });
// ---- 子命令：generate（全流程） ----
program
  .command("generate")
  .description("全流程：生成 API + 类型，然后生成页面")
  .requiredOption("-s, --swagger <url>", "Swagger 文档 URL")
  .requiredOption("-m, --module <tag>", "模块 tag（如 User）")
  .requiredOption("-t, --template <path>", "参考列表页模板路径")
  .option("--form-template <path>", "参考表单组件模板路径")
  .option("-o, --output <dir>", "页面输出目录", "./src/views")
  .option("--api-output <dir>", "API 输出目录", "./src/api")
  .option(
    "--style-guide <path>",
    "已有的风格规范文件（若不存在则自动分析模板生成）",
    "style-guide.yaml"
  )
  .option("--skip-api", "跳过 API 生成（如果已经生成）")
  .option("--api-import-path <path>", "API 导入路径前缀", "@/api/modules")
  .action(async (options) => {
    const {
      swagger,
      module,
      template,
      formTemplate,
      output,
      apiOutput,
      styleGuide,
      skipApi,
      apiImportPath,
    } = options;

    // 1. 生成 API/类型（除非跳过）
    if (!skipApi) {
      console.log("🔧 步骤1：生成 API 和类型文件...");
      const swaggerDoc = await loadSwagger(swagger);
      const groups = groupByTag(swaggerDoc);
      const schemas = getAllSchemas(swaggerDoc);
      const endpoints = groups[module];
      if (!endpoints?.length) {
        console.error(`❌ 未找到模块 "${module}"`);
        process.exit(1);
      }
      const apiDir = path.join(apiOutput, "modules");
      const typesDir = path.join(apiOutput, "types");
      fs.mkdirSync(apiDir, { recursive: true });
      fs.mkdirSync(typesDir, { recursive: true });
      const prettierConfig = await prettier.resolveConfig(process.cwd());
      const { code, fileName, usedTypes } = generateApiFile(
        module,
        endpoints,
        schemas
      );
      const formattedApi = await prettier.format(code, {
        ...prettierConfig,
        parser: "typescript",
      });
      fs.writeFileSync(path.join(apiDir, `${fileName}.ts`), formattedApi);
      const typeCode = generateTypeFile(schemas, usedTypes);
      const formattedType = await prettier.format(typeCode, {
        ...prettierConfig,
        parser: "typescript",
      });
      fs.writeFileSync(path.join(typesDir, "api.d.ts"), formattedType);
      console.log("✅ API 与类型已生成");
    }

    // 2. 检查/生成风格规范
    try {
      await fs.promises.access(styleGuide);
      console.log("📋 使用已有风格规范:", styleGuide);
    } catch {
      console.log("🔍 风格规范不存在，使用模板自动分析...");
      const yamlContent = await analyzeStyle(template);
      await fs.promises.writeFile(styleGuide, yamlContent);
      console.log("✅ 风格规范已生成:", styleGuide);
    }

    // 3. 从生成的文件中提取骨架
    console.log("📊 从 API 文件中提取接口骨架...");
    const moduleLower = module.toLowerCase();
    const apiModulesDir = path.join(apiOutput, "modules");
    const apiTypesDir = path.join(apiOutput, "types");
    const skeleton = extractSkeletonFromFiles(
      apiModulesDir,
      apiTypesDir,
      moduleLower
    );

    // 4. 生成页面
    const viewDir = path.join(output, moduleLower);
    await generatePages({
      skeleton,
      styleGuidePath: styleGuide,
      listTemplatePath: template,
      formTemplatePath: formTemplate,
      outputDir: viewDir,
      apiImportPath,
    });
    console.log("🎉 全流程完成！");
  });

program.parse();