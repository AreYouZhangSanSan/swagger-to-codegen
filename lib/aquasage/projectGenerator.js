import fs from "fs/promises";
import path from "path";
import prettier from "prettier";
import { createIncrementalWriter } from "../incrementalWriter.js";
import {
  renderAquaSageApiFiles,
  renderAquaSageFiles,
  renderAquaSagePageFiles,
} from "./renderer.js";
import {
  patchAquaSageRoutes,
  patchElegantRouteTitles,
} from "./routePatcher.js";
import {
  collectTypeDiagnostics,
  diffDiagnostics,
  findRunningDevServer,
  runRouteGenerator,
  validateAquaSageProject,
} from "./validator.js";

export async function generateAquaSageProject({
  projectRoot,
  plans,
  contractSource,
  force = false,
  dryRun = false,
  patchRoutes = true,
  routeGeneration = true,
  check = true,
  stage = "all",
}) {
  const root = path.resolve(projectRoot);
  await validateAquaSageProject(root);

  const applyRoutes = stage !== "api" && patchRoutes;
  if (applyRoutes && !dryRun) {
    const devProcess = await findRunningDevServer(root);
    if (devProcess) {
      throw new Error(
        `检测到项目的 dev 服务正在运行（vite），它的路由插件会与生成命令同时写 src/router/elegant/routes.ts，导致文件损坏、下次启动 dev 报语法错误。\n请先停掉 dev（在 dev 终端按 Ctrl+C），再重新执行本命令。\n检测到的进程：${devProcess.slice(0, 200)}`,
      );
    }
  }

  const stageFiles = (plan) =>
    stage === "api"
      ? renderAquaSageApiFiles(plan)
      : stage === "pages"
        ? renderAquaSagePageFiles(plan)
        : renderAquaSageFiles(plan);

  const rendered = new Map();
  for (const plan of plans) {
    for (const [relativePath, content] of Object.entries(stageFiles(plan))) {
      if (rendered.has(relativePath))
        throw new Error(`多个资源生成了同一文件: ${relativePath}`);
      const targetPath = path.join(root, relativePath);
      rendered.set(
        relativePath,
        await formatGeneratedFile(targetPath, content),
      );
    }
  }

  if (dryRun) {
    return {
      dryRun: true,
      projectRoot: root,
      plans,
      files: [...rendered.keys()],
      review: plans.flatMap((plan) =>
        plan.review.map((item) => `${plan.resource.slug}: ${item}`),
      ),
    };
  }

  const beforeDiagnostics = check ? await collectTypeDiagnostics(root) : null;
  const writer = await createIncrementalWriter(root, { force });
  const fileResults = [];
  for (const [relativePath, content] of rendered) {
    const result = await writer.writeFile(
      path.join(root, relativePath),
      content,
      {
        generator: "aquasage-crud",
        contractSource,
        resource: relativePath.split("/").at(-3) || null,
      },
    );
    fileResults.push({ path: relativePath, ...result });
  }
  const writerResult = await writer.finalize();

  const routeResults = [];
  if (applyRoutes) {
    for (const plan of plans)
      routeResults.push(await patchAquaSageRoutes(root, plan));
  }
  let routeOutput = "";
  let routeGenerationFailed = false;
  if (applyRoutes && routeGeneration) {
    const routeResult = await runRouteGenerator(root);
    routeOutput = routeResult.output;
    routeGenerationFailed = !routeResult.ok;
    if (routeGenerationFailed) {
      console.warn(
        `⚠ 路由生成命令未成功完成：\n${routeResult.output}\n  ${routeResult.hint}`,
      );
    }
  }
  let elegantRouteTitles = { action: "skipped" };
  if (applyRoutes) {
    elegantRouteTitles = await patchElegantRouteTitles(root, plans);
    if (elegantRouteTitles.action === "updated") {
      console.log(
        `🀄 已补全 elegant/routes.ts 占位标题 ${elegantRouteTitles.updated} 处`,
      );
    }
  }

  const planDirectory = path.join(root, ".codegen", "aquasage", "plans");
  await fs.mkdir(planDirectory, { recursive: true });
  for (const plan of plans) {
    await fs.writeFile(
      path.join(planDirectory, `${plan.resource.slug}.json`),
      `${JSON.stringify(plan, null, 2)}\n`,
      "utf8",
    );
  }

  const afterDiagnostics = check ? await collectTypeDiagnostics(root) : null;
  const newDiagnostics =
    beforeDiagnostics && afterDiagnostics?.available
      ? diffDiagnostics(beforeDiagnostics, afterDiagnostics)
      : [];

  const report = {
    dryRun: false,
    stage,
    projectRoot: root,
    plans: plans.map((plan) => ({
      resource: plan.resource,
      review: plan.review,
    })),
    files: fileResults,
    writerReport: writerResult.reportPath,
    routes: routeResults,
    elegantRouteTitles,
    routeOutput,
    routeGenerationFailed,
    validation: {
      checked: Boolean(check),
      baselineCount: beforeDiagnostics?.diagnostics.size ?? null,
      finalCount: afterDiagnostics?.diagnostics.size ?? null,
      newDiagnostics,
    },
  };

  const reportPath = path.join(
    root,
    ".codegen",
    "aquasage",
    "reports",
    `${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(
    reportPath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  report.reportPath = reportPath;

  if (newDiagnostics.length > 0) {
    const preview = newDiagnostics.slice(0, 20).join("\n");
    throw new Error(
      `生成结果引入了 ${newDiagnostics.length} 条新的类型错误。报告: ${reportPath}\n${preview}`,
    );
  }
  return report;
}

async function formatGeneratedFile(filePath, content) {
  const config = (await prettier.resolveConfig(filePath)) || {};
  const parser = filePath.endsWith(".vue") ? "vue" : "typescript";
  return prettier.format(content, { ...config, parser });
}
