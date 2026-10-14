import fs from "fs/promises";
import path from "path";
import { createIncrementalWriter } from "../incrementalWriter.js";

/**
 * 分步生成（aquasage-api → aquasage-pages）的计划文件存取。
 * 第一步把完整资源计划保存为 JSON；第二步加载计划而不再解析 OpenAPI，
 * 保证两步的 placement、分组和文件路径完全一致。
 */

export async function saveAquaSagePlans(baseDir, plans, { scope = "standalone" } = {}) {
  const planDirectory =
    scope === "project"
      ? path.join(baseDir, ".codegen", "aquasage", "plans")
      : path.join(baseDir, ".codegen", "plans");
  await fs.mkdir(planDirectory, { recursive: true });
  for (const plan of plans) {
    await fs.writeFile(
      path.join(planDirectory, `${plan.resource.slug}.json`),
      `${JSON.stringify(plan, null, 2)}\n`,
      "utf8",
    );
  }
  return planDirectory;
}

export async function loadAquaSagePlans(fromEntries) {
  const plans = [];
  for (const entry of fromEntries) {
    for (const file of await findPlanFiles(path.resolve(entry))) {
      const parsed = JSON.parse(await fs.readFile(file, "utf8"));
      validatePlan(parsed, file);
      if (plans.some((plan) => plan.resource.slug === parsed.resource.slug)) {
        throw new Error(
          `多个计划文件定义了同一资源 ${parsed.resource.slug}，请检查 --from 是否重复`,
        );
      }
      plans.push(parsed);
    }
  }
  if (plans.length === 0) {
    throw new Error(
      "未找到 AquaSage 计划文件。请先运行 aquasage-api 或 aquasage 生成计划，或用 --from 指向计划所在目录",
    );
  }
  return plans;
}

async function findPlanFiles(entry) {
  let stat;
  try {
    stat = await fs.stat(entry);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  if (stat.isFile()) return [entry];
  const files = [];
  for (const candidate of [
    path.join(entry, ".codegen", "plans"),
    path.join(entry, ".codegen", "aquasage", "plans"),
  ]) {
    files.push(...(await listJsonFiles(candidate)));
  }
  if (files.length) return files;
  for (const file of await listJsonFiles(entry)) {
    try {
      if (isPlan(JSON.parse(await fs.readFile(file, "utf8")))) files.push(file);
    } catch {
      // 非计划 JSON 文件，跳过
    }
  }
  return files;
}

async function listJsonFiles(directory) {
  try {
    const entries = await fs.readdir(directory);
    return entries
      .filter((name) => name.endsWith(".json"))
      .map((name) => path.join(directory, name));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function isPlan(value) {
  return (
    value &&
    value.version === 1 &&
    typeof value.resource?.slug === "string" &&
    value.placement &&
    value.operations
  );
}

function validatePlan(plan, file) {
  if (!isPlan(plan)) {
    throw new Error(`不是有效的 AquaSage 计划文件: ${file}`);
  }
}

/** 独立模式下按契约资源路径推导输出目录，例如 /api/v1/prj/pumping-station → api/v1/prj/pumping-station */
export function deriveResourceOutputDir(basePath, slug) {
  const segments = String(basePath)
    .split(/[\\/]/)
    .filter((segment) => segment && segment !== "." && segment !== "..");
  return segments.length ? path.join(...segments) : slug || "resource";
}

/**
 * 第二步前置检查：确保每个计划的 service/type 文件存在于项目中。
 * 第一步若是独立目录生成（plan.stage1 记录了实际路径），缺失时自动复制进项目标准位置；
 * 仍然缺失则收集错误，由调用方决定是否终止。
 */
export async function ensureProjectApiFiles(
  projectRoot,
  plans,
  { force = false, dryRun = false } = {},
) {
  const planned = [];
  const missing = [];
  for (const plan of plans) {
    const placement = plan.placement || {};
    for (const [key, relativePath] of [
      ["service", placement.serviceFile],
      ["types", placement.typeFile],
    ]) {
      if (!relativePath) continue;
      const targetPath = path.join(projectRoot, relativePath);
      if (await exists(targetPath)) continue;
      const sourcePath =
        key === "service" ? plan.stage1?.servicePath : plan.stage1?.typesPath;
      if (!sourcePath || !(await exists(sourcePath))) {
        missing.push(relativePath);
        continue;
      }
      planned.push({ relativePath, sourcePath });
    }
  }

  if (dryRun) {
    return { copied: [], planned, missing, dryRun: true };
  }
  if (missing.length > 0) {
    throw new Error(
      `以下 API/类型文件在项目中缺失，且第一步产物中没有可复制来源：\n${missing
        .map((file) => `- ${file}`)
        .join("\n")}\n请先运行 aquasage-api -p <项目> 生成到项目，或用 --from 指向第一步生成文件的目录`,
    );
  }

  const writer = await createIncrementalWriter(projectRoot, { force });
  const copied = [];
  for (const { relativePath, sourcePath } of planned) {
    const content = await fs.readFile(sourcePath, "utf8");
    const result = await writer.writeFile(
      path.join(projectRoot, relativePath),
      content,
      {
        generator: "aquasage-crud",
        contractSource: "aquasage-api-plans",
      },
    );
    copied.push({ relativePath, ...result });
  }
  const writerResult = planned.length ? await writer.finalize() : null;
  return { copied, planned, missing, dryRun: false, writerResult };
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
