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
import { renderAquaSageApiFiles } from "./lib/aquasage/renderer.js";
import { syncZhCnRouteTitles } from "./lib/aquasage/localeSynchronizer.js";
import { configureAquaSagePlans } from "./lib/aquasage/placementResolver.js";
import {
  deriveResourceOutputDir,
  ensureProjectApiFiles,
  loadAquaSagePlans,
  saveAquaSagePlans,
} from "./lib/aquasage/planStore.js";

program
  .name("codegen")
  .description("zdwp-aquasage-web 专用 CRUD 代码生成工具")
  .version("3.10.0")
  .showHelpAfterError("可执行 node .\\codegen.js <命令> --help 查看完整参数。")
  .addHelpText(
    "after",
    helpBlock([
      "推荐主流程：aquasage（先加 --dry-run 预览，再正式生成）",
      "查看当前源码版本：node .\\codegen.js --version",
      "查看某条命令：node .\\codegen.js aquasage --help",
      "安装为依赖后：pnpm exec aquasage-codegen aquasage --help",
      "如果 aquasage 帮助中没有 --dry-run，说明运行的不是当前 3.10.0 源码或安装包。",
    ]),
  );

program
  .command("aquasage")
  .description("从 OpenAPI 确定性生成 zdwp-aquasage-web CRUD 页面")
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
  .option("--reference-view <path>", "参考业务模块目录或 list/index.vue")
  .option("--target-parent <route-path>", "目标父路由路径")
  .option(
    "--view-dir <path>",
    "页面代码输出目录（可选，默认随菜单路由；与菜单解耦时建议配合 --no-routes）",
  )
  .option(
    "--menu-mode <mode>",
    "菜单模式：reference、resource 或 parent",
    "reference",
  )
  .option("--service-group <path>", "src/service/api 下的输出分组")
  .option("--type-group <path>", "src/typings/api 下的输出分组")
  .option("--config-group <path>", "src/config 下的字段配置分组")
  .option("--type-namespace <name>", "Api 下的 TypeScript 命名空间")
  .option("--attachment-service <path>", "共享附件 Service 导入路径")
  .option("--permission <key>", "新业务资源的权限标识")
  .option("--order <number>", "新业务资源的菜单排序")
  .option("--active-menu <route-name>", "隐藏页面激活的菜单路由名")
  .option("--create-parent", "为目标父路由补充标题和菜单元数据", false)
  .option("--parent-title <text>", "新父路由中文标题")
  .option(
    "--parent-icon <icon>",
    "父路由图标（新建父路由或为按路径推导的父路由补充图标）",
  )
  .option("--parent-order <number>", "父路由菜单排序")
  .option("--parent-permission <key>", "父路由权限标识")
  .option("--dry-run", "只输出计划和文件列表，不写入目标项目", false)
  .option("--force", "备份人工修改后强制覆盖", false)
  .option("--no-routes", "不更新 route-titles.ts 和 menu-config.ts")
  .option("--no-route-generation", "不执行目标项目的 pnpm gen-route")
  .option("--no-check", "不执行生成前后的 vue-tsc 诊断增量检查")
  .addHelpText(
    "after",
    helpBlock([
      "场景 1：先预览，绝不写文件（第一次使用最推荐）",
      '  node .\\codegen.js aquasage -s ".\\openapi.json" -p "D:\\workCode\\知识库\\zdwp-aquasage-web" -m "水体相关" --dry-run',
      "场景 2：确认预览后正式生成到默认工程名录",
      '  node .\\codegen.js aquasage -s ".\\openapi.json" -p "D:\\workCode\\知识库\\zdwp-aquasage-web" -m "水体相关"',
      "场景 3：生成到指定父路由（i18n 项目先跳过配置式路由）",
      '  node .\\codegen.js aquasage -s ".\\openapi.json" -p "." --resource "/api/v1/hyo/river" --title "河流" --reference-view "src/views/knowledge-engineering/spatial-element/river-system/rivers" --target-parent "/knowledge-engineering/spatial-element/river-system" --no-routes',
      "场景 4：菜单落位与页面目录解耦（页面代码放自定义目录，菜单仍在空间元素下）",
      '  node .\\codegen.js aquasage -s ".\\openapi.json" -p "." -m "河流" --target-parent "/knowledge-engineering/spatial-element/river-system" --slug rivers --title "河流" --view-dir "src/views/custom/rivers" --no-routes',
      "分步生成：aquasage-api（只生成 Service 与类型）→ aquasage-pages（再生成页面与路由）",
      "说明：--dry-run 只做读取、规划和格式化，不写业务文件、路由或 .codegen 元数据。",
    ]),
  )
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
    let plans = planAquaSageResources(document, {
      resource: options.resource,
      tag: options.module,
      slug: options.slug,
      title: options.title,
      withAttachment: options.withAttachment,
    });
    plans = await configureAquaSagePlans(
      options.project,
      plans,
      placementOptions(options),
    );
    console.log(`📦 已识别 ${plans.length} 个 AquaSage 业务资源`);
    for (const plan of plans) {
      console.log(
        `  - ${plan.resource.slug}: ${plan.resource.basePath} -> ${plan.placement.resourceRoutePath}`,
      );
      printExtraOperations(plan);
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
  .command("aquasage-api")
  .description("分步第一步：仅生成 AquaSage Service 与类型文件")
  .requiredOption(
    "-s, --swagger <url-or-file>",
    "OpenAPI URL 或本地 JSON/YAML 文件",
  )
  .option(
    "-p, --project <dir>",
    "zdwp-aquasage-web 项目根目录（生成到 src/service/api 与 src/typings/api）",
  )
  .option(
    "-o, --output <dir>",
    "独立输出目录（与 -p 二选一；文件平铺为 <slug>.ts / <slug>.d.ts）",
  )
  .option("-r, --resource <base-path>", "API 资源基础路径")
  .option("-m, --module <tag>", "Swagger tag；同 tag 下会继续按资源路径拆分")
  .option("--slug <name>", "目标目录 kebab-case 名称")
  .option("--title <text>", "业务中文名称")
  .option("--all", "生成契约中的全部可识别资源", false)
  .option("--with-attachment", "存在 std_code/project_code 时生成附件页", false)
  .option("--service-group <path>", "src/service/api 下的输出分组")
  .option("--type-group <path>", "src/typings/api 下的输出分组")
  .option("--config-group <path>", "src/config 下的字段配置分组")
  .option("--type-namespace <name>", "Api 下的 TypeScript 命名空间")
  .option("--dry-run", "只输出计划和文件列表，不写入任何文件", false)
  .option("--force", "备份人工修改后强制覆盖", false)
  .option("--no-check", "不执行生成前后的 vue-tsc 诊断增量检查")
  .addHelpText(
    "after",
    helpBlock([
      "场景 1：先预览，绝不写文件",
      '  node .\\codegen.js aquasage-api -s "http://19.19.12.206:8000/api/v1/openapi.json" -p "D:\\workCode\\知识库\\zdwp-aquasage-web" -m "水体相关" --dry-run',
      "场景 2：正式生成到项目标准目录（推荐，第二步 aquasage-pages 可直接接力）",
      '  node .\\codegen.js aquasage-api -s "http://19.19.12.206:8000/api/v1/openapi.json" -p "D:\\workCode\\知识库\\zdwp-aquasage-web" -m "水体相关"',
      "场景 3：生成到独立目录 -o（平铺 <slug>.ts / <slug>.d.ts）",
      '  node .\\codegen.js aquasage-api -s "http://19.19.12.206:8000/api/v1/openapi.json" -m "水体相关" -o ".\\out\\api"',
      "场景 4：不指定输出目录时按契约资源路径推导，例如 /api/v1/prj/pumping-station → .\\api\\v1\\prj\\pumping-station",
      '  node .\\codegen.js aquasage-api -s "http://19.19.12.206:8000/api/v1/openapi.json" -m "水体相关"',
    ]),
  )
  .action(async (options) => {
    if (!options.all && !options.resource && !options.module && !options.slug) {
      throw new Error(
        "请提供 --resource、--module 或 --slug；只有明确使用 --all 才会生成全部资源",
      );
    }
    if (options.slug && options.all)
      throw new Error("--slug 不能与 --all 同时使用");
    if (options.project && options.output)
      throw new Error("-p/--project 与 -o/--output 只能二选一");

    console.log(`🚀 读取 OpenAPI: ${options.swagger}`);
    const document = await loadSwagger(options.swagger);
    let plans = planAquaSageResources(document, {
      resource: options.resource,
      tag: options.module,
      slug: options.slug,
      title: options.title,
      withAttachment: options.withAttachment,
    });
    plans = await configureAquaSagePlans(
      options.project || process.cwd(),
      plans,
      placementOptions(options),
    );
    console.log(`📦 已识别 ${plans.length} 个 AquaSage 业务资源`);
    for (const plan of plans) {
      console.log(
        `  - ${plan.resource.slug}: ${plan.resource.basePath} -> ${plan.placement.serviceFile} / ${plan.placement.typeFile}`,
      );
      printExtraOperations(plan);
      plan.review.forEach((item) => console.log(`    ⚠ ${item}`));
    }

    // 项目模式：与一步 aquasage 落位相同，只写 Service 与类型，不碰路由
    if (options.project) {
      const result = await generateAquaSageProject({
        projectRoot: options.project,
        plans,
        contractSource: options.swagger,
        force: options.force,
        dryRun: options.dryRun,
        patchRoutes: false,
        routeGeneration: false,
        check: options.check,
        stage: "api",
      });
      if (result.dryRun) {
        console.log("🧪 Dry-run，不写入文件：");
        result.files.forEach((file) => console.log(`  ${file}`));
        return;
      }
      console.log(`✅ Service 与类型生成完成，报告: ${result.reportPath}`);
      console.log(
        `类型错误基线 ${result.validation.baselineCount ?? "未检查"}，新增 ${result.validation.newDiagnostics.length}`,
      );
      console.log(
        `▶ 下一步：node .\\codegen.js aquasage-pages -p "${options.project}"`,
      );
      return;
    }

    // 独立模式：-o 单一目录，或按契约资源路径推导目录
    for (const plan of plans) {
      const baseDir = options.output
        ? path.resolve(options.output)
        : path.resolve(
            deriveResourceOutputDir(plan.resource.basePath, plan.resource.slug),
          );
      const serviceName = path.basename(plan.placement.serviceFile);
      const typesName = path.basename(plan.placement.typeFile);
      const files = renderAquaSageApiFiles(plan);
      const prettierConfig = await prettier.resolveConfig(process.cwd());
      const formattedService = await prettier.format(
        files[plan.placement.serviceFile],
        { ...prettierConfig, parser: "typescript" },
      );
      const formattedTypes = await prettier.format(
        files[plan.placement.typeFile],
        { ...prettierConfig, parser: "typescript" },
      );
      const servicePath = path.join(baseDir, serviceName);
      const typesPath = path.join(baseDir, typesName);
      plan.stage1 = {
        outputDir: baseDir,
        servicePath,
        typesPath,
        writtenAt: new Date().toISOString(),
      };
      console.log(`📁 ${plan.resource.slug} -> ${baseDir}`);
      if (options.dryRun) {
        console.log(`  ${servicePath}`);
        console.log(`  ${typesPath}`);
        continue;
      }
      const writer = await createIncrementalWriter(baseDir, {
        force: options.force,
      });
      const serviceResult = await writer.writeFile(
        servicePath,
        formattedService,
        {
          generator: "aquasage-crud",
          contractSource: options.swagger,
          resource: plan.resource.slug,
        },
      );
      console.log(`✅ Service: ${serviceName} (${serviceResult.action})`);
      const typesResult = await writer.writeFile(typesPath, formattedTypes, {
        generator: "aquasage-crud",
        contractSource: options.swagger,
        resource: plan.resource.slug,
      });
      console.log(`✅ 类型: ${typesName} (${typesResult.action})`);
      const writeReport = await writer.finalize();
      throwIfWriteConflicts(writeReport);
      await saveAquaSagePlans(baseDir, [plan], { scope: "standalone" });
      console.log(
        `🧾 计划已保存: ${path.join(baseDir, ".codegen", "plans", `${plan.resource.slug}.json`)}`,
      );
      console.log(`✅ 报告: ${writeReport.reportPath}`);
    }
    if (!options.dryRun) {
      console.log(
        "▶ 下一步：node .\\codegen.js aquasage-pages -p <zdwp-aquasage-web目录> --from <上面输出的目录>",
      );
    }
  });

program
  .command("aquasage-pages")
  .description("分步第二步：基于 aquasage-api 的计划文件生成页面与路由")
  .requiredOption("-p, --project <dir>", "zdwp-aquasage-web 项目根目录")
  .option(
    "--from <path>",
    "第一步计划文件或目录，可多次指定（默认读取 <项目>/.codegen/aquasage/plans）",
    (value, previous) => previous.concat([value]),
    [],
  )
  .option("--reference-view <path>", "参考业务模块目录或 list/index.vue")
  .option("--target-parent <route-path>", "目标父路由路径")
  .option(
    "--view-dir <path>",
    "页面代码输出目录（可选，默认随菜单路由；与菜单解耦时建议配合 --no-routes）",
  )
  .option(
    "--menu-mode <mode>",
    "菜单模式：reference、resource 或 parent",
    "reference",
  )
  .option("--service-group <path>", "src/service/api 下的输出分组")
  .option("--type-group <path>", "src/typings/api 下的输出分组")
  .option("--config-group <path>", "src/config 下的字段配置分组")
  .option("--type-namespace <name>", "Api 下的 TypeScript 命名空间")
  .option("--attachment-service <path>", "共享附件 Service 导入路径")
  .option("--permission <key>", "新业务资源的权限标识")
  .option("--order <number>", "新业务资源的菜单排序")
  .option("--active-menu <route-name>", "隐藏页面激活的菜单路由名")
  .option("--create-parent", "为目标父路由补充标题和菜单元数据", false)
  .option("--parent-title <text>", "新父路由中文标题")
  .option(
    "--parent-icon <icon>",
    "父路由图标（新建父路由或为按路径推导的父路由补充图标）",
  )
  .option("--parent-order <number>", "父路由菜单排序")
  .option("--parent-permission <key>", "父路由权限标识")
  .option("--dry-run", "只输出计划和文件列表，不写入目标项目", false)
  .option("--force", "备份人工修改后强制覆盖", false)
  .option("--no-routes", "不更新 route-titles.ts 和 menu-config.ts")
  .option("--no-route-generation", "不执行目标项目的 pnpm gen-route")
  .option("--no-check", "不执行生成前后的 vue-tsc 诊断增量检查")
  .addHelpText(
    "after",
    helpBlock([
      "场景 1：先预览，绝不写文件",
      '  node .\\codegen.js aquasage-pages -p "D:\\workCode\\知识库\\zdwp-aquasage-web" --dry-run',
      "场景 2：正式生成页面与路由（计划来自 aquasage-api -p 或一步 aquasage）",
      '  node .\\codegen.js aquasage-pages -p "D:\\workCode\\知识库\\zdwp-aquasage-web"',
      "场景 3：aquasage-api 独立目录生成过，用 --from 接力（缺失的 API/类型会自动复制进项目）",
      '  node .\\codegen.js aquasage-pages -p "D:\\workCode\\知识库\\zdwp-aquasage-web" --from ".\\api\\v1\\prj\\pumping-station"',
      "场景 4：参照已有页面模块生成（分组默认沿用计划中记录的取值）",
      '  node .\\codegen.js aquasage-pages -p "." --reference-view "src/views/knowledge-engineering/spatial-element/river-system/rivers" --target-parent "/knowledge-engineering/spatial-element/river-system" --no-routes',
      "场景 5：页面代码目录自定义（--view-dir 只改页面目录，菜单路由仍按计划里的落位）",
      '  node .\\codegen.js aquasage-pages -p "." --view-dir "src/views/custom/rivers" --no-routes',
      "注意：不传 --from 时默认读取 <项目>/.codegen/aquasage/plans 下的计划文件。",
    ]),
  )
  .action(async (options) => {
    const fromEntries =
      options.from.length > 0
        ? options.from
        : [path.join(options.project, ".codegen", "aquasage", "plans")];
    let plans = await loadAquaSagePlans(fromEntries);

    // 显式传了落位参数才重新解析 placement；否则直接复用计划里的记录（最稳路径）
    if (hasPlacementOverrides(options)) {
      const resolved = [];
      for (const plan of plans) {
        const [result] = await configureAquaSagePlans(
          options.project,
          [plan],
          placementOptionsForPlan(options, plan),
        );
        resolved.push(result);
      }
      plans = resolved;
    }

    console.log(`📦 将基于 ${plans.length} 个计划生成页面`);
    for (const plan of plans) {
      console.log(
        `  - ${plan.resource.slug}: ${plan.resource.title} -> ${plan.placement.resourceRoutePath}`,
      );
      printExtraOperations(plan);
    }

    const apiCheck = await ensureProjectApiFiles(options.project, plans, {
      force: options.force,
      dryRun: options.dryRun,
    });
    if (apiCheck.planned.length > 0) {
      console.log(
        apiCheck.dryRun
          ? "🧪 Dry-run，将复制以下缺失的 API/类型文件："
          : "📋 已复制第一步生成的 API/类型文件：",
      );
      apiCheck.planned.forEach((item) => console.log(`  ${item.relativePath}`));
    }
    if (apiCheck.missing.length > 0) {
      console.log("⚠ 以下 API/类型文件在项目中缺失，正式生成时会报错：");
      apiCheck.missing.forEach((file) => console.log(`  ${file}`));
    }
    if (!apiCheck.dryRun && apiCheck.writerResult) {
      throwIfWriteConflicts(apiCheck.writerResult);
    }

    const result = await generateAquaSageProject({
      projectRoot: options.project,
      plans,
      contractSource: "aquasage-plans",
      force: options.force,
      dryRun: options.dryRun,
      patchRoutes: options.routes,
      routeGeneration: options.routeGeneration,
      check: options.check,
      stage: "pages",
    });

    if (result.dryRun) {
      console.log("🧪 Dry-run，不写入文件：");
      result.files.forEach((file) => console.log(`  ${file}`));
      return;
    }
    console.log(`✅ AquaSage 页面生成完成，报告: ${result.reportPath}`);
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
  .option("--reference-view <path>", "与生成页面相同的参考业务模块")
  .option("--target-parent <route-path>", "与生成页面相同的目标父路由")
  .option(
    "--menu-mode <mode>",
    "菜单模式：reference、resource 或 parent",
    "reference",
  )
  .option("--service-group <path>", "Service 输出分组")
  .option("--type-group <path>", "类型输出分组")
  .option("--config-group <path>", "字段配置输出分组")
  .option("--type-namespace <name>", "Api 类型命名空间")
  .option("--attachment-service <path>", "共享附件 Service 导入路径")
  .option("--permission <key>", "业务资源权限标识")
  .option("--order <number>", "业务资源菜单排序")
  .option("--active-menu <route-name>", "隐藏页面激活的菜单路由名")
  .option("--create-parent", "同步新父路由标题", false)
  .option("--parent-title <text>", "新父路由中文标题")
  .option(
    "--parent-icon <icon>",
    "父路由图标（新建父路由或为按路径推导的父路由补充图标）",
  )
  .option("--parent-order <number>", "父路由菜单排序")
  .option("--parent-permission <key>", "父路由权限标识")
  .option("--dry-run", "只检查并输出计划，不生成路由或修改文件", false)
  .option("--force", "覆盖已经人工修改的中文标题", false)
  .option("--no-route-generation", "不执行 pnpm exec sa gen-route")
  .addHelpText(
    "after",
    helpBlock([
      "场景 1：只检查标题计划，不生成路由、不修改 zh-cn.ts",
      '  node .\\codegen.js sync-zh-cn -s ".\\openapi.json" -p "." -m "水体相关" --dry-run',
      "场景 2：正式生成 Elegant Router 路由并补中文标题",
      '  node .\\codegen.js sync-zh-cn -s ".\\openapi.json" -p "." -m "水体相关"',
      "注意：aquasage 使用过哪些落位参数，这里必须原样重复，否则路由 key 对不上。",
    ]),
  )
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
    let plans = planAquaSageResources(document, {
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

    plans = await configureAquaSagePlans(
      options.project,
      plans,
      placementOptions(options),
    );

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
  .addHelpText(
    "after",
    helpBlock([
      "场景：生成前先检查每个模块的 CRUD 是否齐全",
      '  node .\\codegen.js analyze -s ".\\openapi.json" -o ".\\codegen-plan.json"',
      "输出只是一份分析 JSON，不会修改 zdwp-aquasage-web。",
    ]),
  )
  .action(async ({ swagger, output }) => {
    const document = await loadSwagger(swagger);
    const plan = analyzeContract(groupByTag(document));
    await fs.promises.mkdir(path.dirname(path.resolve(output)), {
      recursive: true,
    });
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
  .addHelpText(
    "after",
    helpBlock([
      "场景：查看“水体相关”的字段、控件、校验和分页推导结果",
      '  node .\\codegen.js plan -s ".\\openapi.json" -m "水体相关" -o ".\\ui-plan-hyo.json"',
      "不传 -m 时会为所有 tag 输出计划；该命令不会生成 Vue 页面。",
    ]),
  )
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
  .requiredOption(
    "-s, --swagger <url-or-file>",
    "OpenAPI URL 或本地 JSON/YAML 文件",
  )
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
  .addHelpText(
    "after",
    helpBlock([
      "场景 1：仅生成某个 tag 的 API 与独立类型文件（不调用 LLM）",
      '  node .\\codegen.js api -s ".\\openapi.json" -m "水体相关" -o ".\\src\\api"',
      "场景 2：不传 -m，为 Swagger 中全部 tag 生成 API 与类型",
      '  node .\\codegen.js api -s ".\\openapi.json" -o ".\\src\\api"',
      "场景 3：提供 -t 时，会继续进入参考模板页面生成流程（需要 LLM）",
      '  node .\\codegen.js api -s ".\\openapi.json" -m "政策相关" -o ".\\src\\api" -t "D:\\ref-project\\list\\index.vue" -p ".\\src\\views"',
    ]),
  )
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
    if (template && !targetModule) {
      throw new Error(
        "api 使用 -t 生成页面时必须同时提供 -m，只能为一个 tag 生成页面",
      );
    }
    if (!template && (formTemplate || options.uiPlan)) {
      throw new Error(
        "--form-template 和 --ui-plan 只能与 -t/--template 一起使用",
      );
    }
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
      const moduleName = generatedModuleName;
      const typesDirPath = path.join(output, "types");
      const skeleton = extractSkeletonFromFiles(
        apiDir,
        typesDirPath,
        moduleName,
      );
      let uiPlan =
        uiPlans.find((item) => item.module.name === moduleName) || null;
      if (options.uiPlan) {
        const loadedUiPlan = JSON.parse(
          await fs.promises.readFile(path.resolve(options.uiPlan), "utf8"),
        );
        uiPlan =
          loadedUiPlan?.plans?.find(
            (item) => item.module?.name === moduleName,
          ) || loadedUiPlan;
      }
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
  .addHelpText(
    "after",
    helpBlock([
      "场景：把一个参考列表页分析为可复用的风格说明（需要 LLM）",
      '  node .\\codegen.js style "D:\\ref-project\\list\\index.vue" -o ".\\style-guide.yaml"',
    ]),
  )
  .action(async (file, options) => {
    const yamlContent = await analyzeStyle(file);
    await fs.promises.mkdir(path.dirname(path.resolve(options.output)), {
      recursive: true,
    });
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
  .addHelpText(
    "after",
    helpBlock([
      "场景：API 已经生成，只基于参考模板生成页面（需要 LLM）",
      '  node .\\codegen.js page --api-file ".\\src\\api\\modules\\policy.ts" -t "D:\\ref-project\\list\\index.vue" -o ".\\src\\views"',
      "如果已有 ui-plan.json，建议同时传 --ui-plan，减少字段猜测。",
    ]),
  )
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
  .option("-s, --swagger <url-or-file>", "OpenAPI URL 或本地 JSON/YAML 文件")
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
  .option("--api-module <name>", "--skip-api 时已有 API/类型文件的同名文件名")
  .option("--api-import-path <path>", "API 导入路径前缀", "@/api/modules")
  .option("--force", "备份人工修改后强制覆盖", false)
  .addHelpText(
    "after",
    helpBlock([
      "场景：一次完成 API、类型、风格分析和页面生成（页面阶段需要 LLM）",
      '  node .\\codegen.js generate -s ".\\openapi.json" -m "政策相关" -t "D:\\ref-project\\list\\index.vue" --api-output ".\\src\\api" -o ".\\src\\views"',
      "已有 modules/policy.ts 和 types/policy.d.ts 时：添加 --skip-api --api-module policy，并可省略 -s。",
      "AquaSage 正式 CRUD 页面优先使用 aquasage；generate 是保留的模板实验链路。",
    ]),
  )
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
      apiModule,
      apiImportPath,
      force,
    } = options;

    if (!skipApi && !swagger) {
      throw new Error("未使用 --skip-api 时必须提供 -s/--swagger");
    }
    if (skipApi && !apiModule) {
      throw new Error(
        "使用 --skip-api 时必须提供 --api-module，例如 --api-module policy",
      );
    }
    if (!skipApi && apiModule) {
      throw new Error("--api-module 只能与 --skip-api 一起使用");
    }

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
    const moduleLower = options.generatedModuleName || apiModule;
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

function placementOptions(options) {
  return {
    referenceView: options.referenceView,
    targetParent: options.targetParent,
    viewDir: options.viewDir,
    menuMode: options.menuMode,
    serviceGroup: options.serviceGroup,
    typeGroup: options.typeGroup,
    configGroup: options.configGroup,
    typeNamespace: options.typeNamespace,
    attachmentService: options.attachmentService,
    permission: options.permission,
    order: options.order,
    activeMenu: options.activeMenu,
    createParent: options.createParent,
    parentTitle: options.parentTitle,
    parentIcon: options.parentIcon,
    parentOrder: options.parentOrder,
    parentPermission: options.parentPermission,
  };
}

function hasPlacementOverrides(options) {
  return (
    options.referenceView !== undefined ||
    options.targetParent !== undefined ||
    options.viewDir !== undefined ||
    options.menuMode !== "reference" ||
    options.serviceGroup !== undefined ||
    options.typeGroup !== undefined ||
    options.configGroup !== undefined ||
    options.typeNamespace !== undefined ||
    options.attachmentService !== undefined ||
    options.permission !== undefined ||
    options.order !== undefined ||
    options.activeMenu !== undefined ||
    options.createParent ||
    options.parentTitle !== undefined ||
    options.parentIcon !== undefined ||
    options.parentOrder !== undefined ||
    options.parentPermission !== undefined
  );
}

/** 第二步重解析 placement 时，未显式传入的落位参数沿用计划里记录的取值，保证与第一步一致 */
function placementOptionsForPlan(options, plan) {
  const recorded = plan.placement || {};
  const opts = placementOptions(options);
  return {
    ...opts,
    targetParent: opts.targetParent ?? recorded.parentRoutePath,
    viewDir: opts.viewDir ?? recorded.viewDir ?? null,
    serviceGroup: opts.serviceGroup ?? recorded.serviceGroup,
    typeGroup: opts.typeGroup ?? recorded.typeGroup,
    configGroup: opts.configGroup ?? recorded.configGroup,
    typeNamespace: opts.typeNamespace ?? recorded.typeNamespace,
    attachmentService: opts.attachmentService ?? recorded.attachmentService,
    permission: opts.permission ?? recorded.menu?.permission ?? null,
    order: opts.order ?? recorded.menu?.order ?? null,
    activeMenu: opts.activeMenu ?? recorded.menu?.activeMenu ?? null,
    createParent: opts.createParent ?? Boolean(recorded.parent?.create),
    parentTitle: opts.parentTitle ?? recorded.parent?.title ?? null,
    parentIcon: opts.parentIcon ?? recorded.parent?.icon ?? null,
    parentOrder: opts.parentOrder ?? recorded.parent?.order ?? null,
    parentPermission: opts.parentPermission ?? recorded.parent?.permission ?? null,
  };
}

function helpBlock(lines) {
  return `\n使用示例与提示：\n${lines.join("\n")}\n`;
}

/** 输出资源的附加接口清单（衍生查询、导入导出等） */
function printExtraOperations(plan) {
  if (!plan.extraOperations?.length) return;
  const actions = plan.extraOperations.map(
    (extra) => extra.action.charAt(0).toLowerCase() + extra.action.slice(1),
  );
  console.log(`    附加接口 ${actions.length} 个: ${actions.join(", ")}`);
}

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
