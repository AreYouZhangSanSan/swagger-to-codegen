import fs from "fs/promises";
import path from "path";
import prettier from "prettier";
import { createIncrementalWriter } from "../incrementalWriter.js";
import { renderAquaSageFiles } from "./renderer.js";
import { patchAquaSageRoutes } from "./routePatcher.js";
import {
  collectTypeDiagnostics,
  diffDiagnostics,
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
}) {
  const root = path.resolve(projectRoot);
  await validateAquaSageProject(root);

  const rendered = new Map();
  for (const plan of plans) {
    for (const [relativePath, content] of Object.entries(
      renderAquaSageFiles(plan),
    )) {
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
  if (patchRoutes) {
    for (const plan of plans)
      routeResults.push(await patchAquaSageRoutes(root, plan));
  }
  let routeOutput = "";
  if (patchRoutes && routeGeneration)
    routeOutput = await runRouteGenerator(root);

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
    projectRoot: root,
    plans: plans.map((plan) => ({
      resource: plan.resource,
      review: plan.review,
    })),
    files: fileResults,
    writerReport: writerResult.reportPath,
    routes: routeResults,
    routeOutput,
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
