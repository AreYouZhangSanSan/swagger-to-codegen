#!/usr/bin/env node
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
import {
  deriveFileNameFromPaths,
  generateApiFile,
  generateTypeFile,
} from "./lib/generator.js";
import { analyzeStyle } from "./lib/styleAnalyzer.js";
import { extractSkeletonFromFiles } from "./lib/extractSkeletonFromFiles.js";
import { generatePages } from "./lib/pageGenerator.js";
import { analyzeContract } from "./lib/contractAnalyzer.js";
import { createIncrementalWriter } from "./lib/incrementalWriter.js";
import { buildUiPlan } from "./lib/uiPlanner.js";
import { planAquaSageResources } from "./lib/aquasage/planner.js";
import { generateAquaSageProject } from "./lib/aquasage/projectGenerator.js";
import { syncZhCnRouteTitles } from "./lib/aquasage/localeSynchronizer.js";

program
  .name("codegen")
  .description("zdwp-aquasage-web 专用 CRUD 代码生成工具")
  .version("3.0.0");

program
  .command("aquasage")
  .description("从 OpenAPI 确定性生成 zdwp-aquasage-web 工程名录 CRUD")
  .requiredOption(
    "-s, --swagger <url-or-file>",
    "OpenAPI URL 或本地 JSON/YAML 文件",
  )
  .requiredOption("-p, --project <dir>", "zdwp-aquasage-web 项目根目录")
  .option(
    "-r, --resource <base-path>",
    "资源基础路径，例如 /api/v1/prj/pumping-station",
  )
  .option("-m, --module <tag>", "Swagger tag；同 tag 下会继续按资源路径拆分")
  .option("--slug <name>", "目标目录 kebab-case 名称")
  .option("--title <text>", "业务中文名称")
  .option("--all", "生成契约中的全部可识别资源", false)
  .option("--with-attachment", "存在 std_code/project_code 时生成附件页", false)
  .option("--dry-run", "只输出计划和文件列表，不写入目标项目", false)
  .option("--force", "备份人工修改后强制覆盖", false)
  .option("--no-routes", "不更新 route-titles.ts 和 menu-config.ts")
  .option("--no-route-generation", "不执行目标项目的 pnpm gen-route")
  .option("--no-check", "不执行生成前后的 vue-tsc 诊断增量检查")
  .action(async (options) => {
    if (!options.all && !options.resource && !options.module && !options.slug) {
      throw new Error(
        "请提供 --resource、--module 或 --slug；只有明确使用 --all 才会生成全部资源",
      );
    }
    if (options.slug && options.all)
      throw new Error("--slug 不能与 --all 同时使用");

    console.log(`🚀 读取 OpenAPI: ${options.swagger}`);
    const document = await loadSwagger(options.swagger);
    const plans = planAquaSageResources(document, {
      resource: options.resource,
      tag: options.module,
      slug: options.slug,
      title: options.title,
      withAttachment: options.withAttachment,
    });
    console.log(`📦 已识别 ${plans.length} 个 AquaSage 业务资源`);
    for (const plan of plans) {
      console.log(`  - ${plan.resource.slug}: ${plan.resource.basePath}`);
      plan.review.forEach((item) => console.log(`    ⚠ ${item}`));
    }

    const result = await generateAquaSageProject({
      projectRoot: options.project,
      plans,
      contractSource: options.swagger,
      force: options.force,
      dryRun: options.dryRun,
      patchRoutes: options.routes,
      routeGeneration: options.routeGeneration,
      check: options.check,
    });

    if (result.dryRun) {
      console.log("🧪 Dry-run，不写入文件：");
      result.files.forEach((file) => console.log(`  ${file}`));
      return;
    }
    console.log(`✅ AquaSage 生成完成，报告: ${result.reportPath}`);
    console.log(
      `类型错误基线 ${result.validation.baselineCount ?? "未检查"}，新增 ${result.validation.newDiagnostics.length}`,
    );
  });

program
  .command("sync-zh-cn")
  .description("无 LLM 生成路由并同步 AquaSage 新页面的 zh-cn 中文标题")
  .requiredOption(
    "-s, --swagger <url-or-file>",
    "OpenAPI URL 或本地 JSON/YAML 文件",
  )
  .requiredOption("-p, --project <dir>", "zdwp-aquasage-web 项目根目录")
  .option("-r, --resource <base-path>", "API 资源基础路径")
  .option("-m, --module <tag>", "Swagger tag；同 tag 下继续按资源拆分")
  .option("--slug <name>", "按资源末段选择")
  .option("--title <text>", "单个资源的中文标题")
  .option("--titles <json-file>", "按 slug 覆盖标题的 JSON 文件")
  .option("--all", "同步契约中的全部可识别资源", false)
  .option("--with-attachment", "同步附件页标题", false)
  .option("--dry-run", "只检查并输出计划，不生成路由或修改文件", false)
  .option("--force", "覆盖已经人工修改的中文标题", false)
  .option("--no-route-generation", "不执行 pnpm exec sa gen-route")
  .action(async (options) => {
    if (!options.all && !options.resource && !options.module && !options.slug) {
      throw new Error(
        "请提供 --resource、--module 或 --slug；只有明确使用 --all 才会同步全部资源",
      );
    }
    if (options.slug && options.all)
      throw new Error("--slug 不能与 --all 同时使用");
    if (options.title && !options.resource && !options.slug) {
      throw new Error("--title 只能与 --resource 或 --slug 一起使用");
    }

    console.log(`🚀 读取 OpenAPI: ${options.swagger}`);
    const document = await loadSwagger(options.swagger);
    const plans = planAquaSageResources(document, {
      resource: options.resource,
      tag: options.module,
      slug: options.slug,
      title: options.title,
      withAttachment: options.withAttachment,
    });

    if (options.titles) {
      const titleOverrides = JSON.parse(
        await fs.promises.readFile(path.resolve(options.titles), "utf8"),
      );
      if (
        !titleOverrides ||
        Array.isArray(titleOverrides) ||
        typeof titleOverrides !== "object"
      ) {
        throw new Error('--titles 文件必须是 { "slug": "中文标题" } 对象');
      }
      for (const plan of plans) {
        const override = titleOverrides[plan.resource.slug];
        if (override !== undefined) {
          if (typeof override !== "string" || !override.trim()) {
            throw new Error(`标题覆盖 ${plan.resource.slug} 必须是非空字符串`);
          }
          plan.resource.title = override.trim();
        }
      }
    }

    console.log(`📦 将同步 ${plans.length} 个 AquaSage 业务资源`);
    plans.forEach((plan) =>
      console.log(`  - ${plan.resource.slug}: ${plan.resource.title}`),
    );
    const result = await syncZhCnRouteTitles({
      projectRoot: options.project,
      plans,
      dryRun: options.dryRun,
      force: options.force,
      routeGeneration: options.routeGeneration,
    });

    const summary = result.actions.reduce((counts, item) => {
      counts[item.action] = (counts[item.action] || 0) + 1;
      return counts;
    }, {});
    console.log(
      `🀄 zh-cn 检查完成：新增 ${summary.created || 0}，更新占位 ${summary.updated || 0}，保留人工标题 ${summary.preserved || 0}，无需修改 ${summary.unchanged || 0}`,
    );
    for (const item of result.actions) {
      console.log(
        `  [${item.action}] ${item.key}: ${item.previousTitle ?? "<缺失>"} -> ${item.title}`,
      );
    }
    if (result.skippedRouteKeys.length > 0) {
      console.log("⚠ 以下计划没有对应的实际路由，已跳过：");
      result.skippedRouteKeys.forEach((key) => console.log(`  ${key}`));
    }
    if (result.dryRun) {
      console.log("🧪 Dry-run，没有生成路由，也没有修改 zh-cn.ts");
    } else if (!result.changed) {
      console.log("✅ zh-cn.ts 已是最新状态，无需写入");
    } else {
      console.log(`✅ 已更新: ${result.localePath}`);
      console.log(`📦 备份: ${result.backupPath}`);
      console.log(`🧾 报告: ${result.reportPath}`);
    }
  });

program
  .command("analyze")
  .description("分析 OpenAPI 的 CRUD 完整度，输出带证据和置信度的生成计划")
  .requiredOption("-s, --swagger <url-or-file>", "OpenAPI URL 或本地文件")
  .option("-o, --output <path>", "分析报告输出路径", "codegen-plan.json")
  .action(async ({ swagger, output }) => {
    const document = await loadSwagger(swagger);
    const plan = analyzeContract(groupByTag(document));
    await fs.promises.writeFile(output, JSON.stringify(plan, null, 2), "utf8");
    console.log(`✅ 生成计划已保存: ${output}`);
    console.log(
      `模块 ${plan.summary.moduleCount} 个，接口 ${plan.summary.endpointCount} 个，平均 CRUD 覆盖率 ${plan.summary.averageCoverage}`,
    );
  });

program
  .command("plan")
  .description("仅运行确定性流程，输出字段、控件、校验、分页和响应路径计划")
  .requiredOption("-s, --swagger <url-or-file>", "OpenAPI URL 或本地文件")
  .option("-m, --module <tag>", "仅规划指定模块")
  .option("-o, --output <path>", "UI 计划输出路径", "ui-plan.json")
  .action(async ({ swagger, module: targetModule, output }) => {
    const document = await loadSwagger(swagger);
    const groups = groupByTag(document);
    const schemas = getAllSchemas(document);
    const tags = targetModule ? [targetModule] : Object.keys(groups);
    const plans = tags.map((tag) => {
      const generated = generateApiFile(tag, groups[tag] || [], schemas);
      return buildUiPlan({
        tag,
        moduleName: generated.fileName,
        operations: generated.operations,
        schemas,
      });
    });
    await fs.promises.mkdir(path.dirname(path.resolve(output)), {
      recursive: true,
    });
    await fs.promises.writeFile(
      output,
      `${JSON.stringify({ version: 1, plans }, null, 2)}\n`,
      "utf8",
    );
    console.log(`✅ 确定性 UI 计划已保存: ${output}`);
  });

// ---- 子命令：api（生成 API，可选同时生成页面） ----
program
  .command("api")
  .description("从 Swagger 生成 API 和类型文件（可同时生成页面）")
  .requiredOption("-s, --swagger <url>", "Swagger 文档 URL")
  .option("-o, --output <dir>", "输出目录", "./src/api")
  .option("-m, --module <tag>", "指定模块 tag")
  .option("-t, --template <path>", "参考列表页模板路径（提供则同时生成页面）")
  .option("--form-template <path>", "参考表单组件模板路径")
  .option(
    "-p, --page-output <dir>",
    "页面输出目录（需配合 -t 使用）",
    "./src/views",
  )
  .option("--api-import-path <path>", "API 导入路径前缀", "@/api/modules")
  .option("--ui-plan <path>", "确定性 UI 计划 JSON")
  .option("--force", "备份人工修改后强制覆盖", false)
  .action(async (options) => {
    const {
      swagger,
      output,
      module: targetModule,
      template,
      formTemplate,
      pageOutput,
      apiImportPath,
    } = options;
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
    const writer = await createIncrementalWriter(output, {
      force: options.force,
    });
    const uiPlans = [];
    let generatedModuleName = null;
    for (const tag of tags) {
      const endpoints = groups[tag];
      if (!endpoints?.length) {
        console.log(`⚠️ 未找到模块 "${tag}"`);
        continue;
      }
      const fileName = deriveFileNameFromPaths(endpoints);
      const { code, usedTypes, operations } = generateApiFile(
        tag,
        endpoints,
        schemas,
        { typeImportPath: `../types/${fileName}` },
      );
      generatedModuleName = fileName;
      uiPlans.push(
        buildUiPlan({ tag, moduleName: fileName, operations, schemas }),
      );
      const formatted = await prettier.format(code, {
        ...prettierConfig,
        parser: "typescript",
      });
      const writeResult = await writer.writeFile(
        path.join(apiDir, `${fileName}.ts`),
        formatted,
        {
          generator: "openapi-api",
          contractSource: swagger,
        },
      );
      console.log(`✅ API: ${fileName}.ts (${writeResult.action})`);

      const typeCode = generateTypeFile(schemas, usedTypes);
      const formattedType = await prettier.format(typeCode, {
        ...prettierConfig,
        parser: "typescript",
      });
      const typeResult = await writer.writeFile(
        path.join(typesDir, `${fileName}.d.ts`),
        formattedType,
        {
          generator: "openapi-types",
          contractSource: swagger,
        },
      );
      console.log(`✅ 类型: ${fileName}.d.ts (${typeResult.action})`);
    }
    const apiWriteReport = await writer.finalize();
    const uiPlanPath = path.join(output, ".codegen", "ui-plan.json");
    await fs.promises.mkdir(path.dirname(uiPlanPath), { recursive: true });
    await fs.promises.writeFile(
      uiPlanPath,
      `${JSON.stringify({ version: 1, plans: uiPlans }, null, 2)}\n`,
      "utf8",
    );
    throwIfWriteConflicts(apiWriteReport);
    console.log(
      `✅ API 与独立类型文件已生成，报告: ${apiWriteReport.reportPath}`,
    );

    // 如果提供了模板，同时生成页面
    if (template && generatedModuleName) {
      console.log("📄 开始生成页面...");
      const apiFile = path.join(apiDir, `${generatedModuleName}.ts`);
      const moduleName = generatedModuleName;
      const typesDirPath = path.join(output, "types");
      const skeleton = extractSkeletonFromFiles(
        apiDir,
        typesDirPath,
        moduleName,
      );
      const uiPlan =
        uiPlans.find((item) => item.module.name === moduleName) || null;
      const viewDir = pageOutput || "./src/views";
      await generatePages({
        skeleton,
        styleGuidePath: "", // 不使用风格规范
        listTemplatePath: template,
        formTemplatePath: formTemplate,
        outputDir: viewDir,
        apiImportPath,
        force: options.force,
        uiPlan,
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
  .requiredOption(
    "--api-file <path>",
    "API 模块文件路径（如 ./src/api/modules/user.ts）",
  )
  .option("--style-guide <path>", "风格规范文件路径", "style-guide.yaml")
  .option(
    "-t, --template <path>",
    "参考列表页模板路径（可选，不提供则仅依靠风格规范）",
  )
  .option("--form-template <path>", "参考表单组件模板路径")
  .option("-o, --output <dir>", "页面输出目录", "./src/views")
  .option("--api-import-path <path>", "API 导入路径前缀", "@/api/modules")
  .option("--ui-plan <path>", "确定性 UI 计划 JSON")
  .option("--force", "备份人工修改后强制覆盖", false)
  .action(async (options) => {
    const {
      apiFile,
      styleGuide,
      template,
      formTemplate,
      output,
      apiImportPath,
      force,
      uiPlan,
    } = options;

    // 从文件路径解析模块名（例如 user.ts → user）
    const moduleName = path.basename(apiFile, ".ts");
    const apiDir = path.dirname(apiFile); // ./src/api/modules
    const typesDir = path.join(apiDir, "..", "types"); // ./src/api/types

    // 1. 提取骨架（复用已有函数，传入 apiDir 而不是文件路径）
    //    需要调整 extractSkeletonFromFiles 使其能通过文件路径定位
    const skeleton = extractSkeletonFromFiles(
      path.dirname(apiFile), // api 模块目录
      typesDir,
      moduleName,
    );

    // 2. 生成页面
    const viewDir = output;
    const loadedUiPlan = uiPlan
      ? JSON.parse(await fs.promises.readFile(uiPlan, "utf8"))
      : null;
    await generatePages({
      skeleton,
      styleGuidePath: styleGuide,
      listTemplatePath: template, // 可能是 undefined
      formTemplatePath: formTemplate,
      outputDir: viewDir,
      apiImportPath,
      force,
      uiPlan:
        loadedUiPlan?.plans?.find((item) => item.module.name === moduleName) ||
        loadedUiPlan,
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
    "style-guide.yaml",
  )
  .option("--skip-api", "跳过 API 生成（如果已经生成）")
  .option("--api-import-path <path>", "API 导入路径前缀", "@/api/modules")
  .option("--force", "备份人工修改后强制覆盖", false)
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
      force,
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
      const writer = await createIncrementalWriter(apiOutput, { force });
      const fileName = deriveFileNameFromPaths(endpoints);
      const { code, usedTypes, operations } = generateApiFile(
        module,
        endpoints,
        schemas,
        { typeImportPath: `../types/${fileName}` },
      );
      const formattedApi = await prettier.format(code, {
        ...prettierConfig,
        parser: "typescript",
      });
      await writer.writeFile(
        path.join(apiDir, `${fileName}.ts`),
        formattedApi,
        {
          generator: "openapi-api",
          contractSource: swagger,
        },
      );
      const typeCode = generateTypeFile(schemas, usedTypes);
      const formattedType = await prettier.format(typeCode, {
        ...prettierConfig,
        parser: "typescript",
      });
      await writer.writeFile(
        path.join(typesDir, `${fileName}.d.ts`),
        formattedType,
        {
          generator: "openapi-types",
          contractSource: swagger,
        },
      );
      const apiWriteReport = await writer.finalize();
      throwIfWriteConflicts(apiWriteReport);
      console.log(`✅ API 与类型已生成；报告: ${apiWriteReport.reportPath}`);
      options.generatedModuleName = fileName;
      options.generatedUiPlan = buildUiPlan({
        tag: module,
        moduleName: fileName,
        operations,
        schemas,
      });
      const uiPlanPath = path.join(apiOutput, ".codegen", "ui-plan.json");
      await fs.promises.mkdir(path.dirname(uiPlanPath), { recursive: true });
      await fs.promises.writeFile(
        uiPlanPath,
        `${JSON.stringify({ version: 1, plans: [options.generatedUiPlan] }, null, 2)}\n`,
        "utf8",
      );
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
    const moduleLower = options.generatedModuleName || module.toLowerCase();
    const apiModulesDir = path.join(apiOutput, "modules");
    const apiTypesDir = path.join(apiOutput, "types");
    const skeleton = extractSkeletonFromFiles(
      apiModulesDir,
      apiTypesDir,
      moduleLower,
    );

    // 4. 生成页面
    const viewDir = output;
    await generatePages({
      skeleton,
      styleGuidePath: styleGuide,
      listTemplatePath: template,
      formTemplatePath: formTemplate,
      outputDir: viewDir,
      apiImportPath,
      force,
      uiPlan: options.generatedUiPlan || null,
    });
    console.log("🎉 全流程完成！");
  });

program.parseAsync().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
});

function throwIfWriteConflicts(writeReport) {
  const conflicts = writeReport.report.files.filter(
    (file) => file.action === "conflict",
  );
  if (conflicts.length === 0) return;

  const details = conflicts
    .map(
      (file) => `- ${file.path}\n  生成候选: ${file.candidatePath || "未记录"}`,
    )
    .join("\n");
  throw new Error(
    `生成未完整落盘，发现 ${conflicts.length} 个文件冲突：\n${details}\n请检查人工修改；确认覆盖时重新执行并添加 --force。\n报告: ${writeReport.reportPath}`,
  );
}
