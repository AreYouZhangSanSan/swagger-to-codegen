import { execFile } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import prettier from "prettier";

export async function syncZhCnRouteTitles({
  projectRoot,
  plans,
  dryRun = false,
  force = false,
  routeGeneration = true,
}) {
  const root = path.resolve(projectRoot);
  const packagePath = path.join(root, "package.json");
  const routesPath = path.join(root, "src/router/elegant/routes.ts");
  const localePath = path.join(root, "src/locales/langs/zh-cn.ts");

  const packageJson = JSON.parse(await fs.readFile(packagePath, "utf8"));
  if (packageJson.name !== "zdwp-aquasage-web") {
    throw new Error(`目标目录不是 zdwp-aquasage-web: ${root}`);
  }
  await fs.access(localePath);

  let routeOutput = "";
  if (routeGeneration && !dryRun) {
    routeOutput = await runElegantRouteGenerator(root);
  }

  let routesCode;
  try {
    routesCode = await fs.readFile(routesPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        `未找到生成路由文件 ${routesPath}。请取消 --no-route-generation，或先在目标项目执行 pnpm exec sa gen-route。`,
      );
    }
    throw error;
  }

  const routeKeys = extractI18nRouteKeys(routesCode);
  if (routeKeys.size === 0) {
    throw new Error(
      `未从 ${routesPath} 识别到 i18nKey。该命令只适用于使用 src/locales/langs/zh-cn.ts 的 AquaSage 项目版本。`,
    );
  }

  const candidates = buildZhCnTitleCandidates(plans);
  const applicable = candidates.filter((item) => routeKeys.has(item.key));
  if (applicable.length === 0) {
    const expected = candidates.map((item) => item.key).join(", ");
    throw new Error(
      `生成路由中没有找到本次资源对应的 key。请确认页面已生成并重新生成路由。期望 key: ${expected}`,
    );
  }

  const current = await fs.readFile(localePath, "utf8");
  const patched = patchZhCnRouteObject(current, applicable, { force });
  const config = (await prettier.resolveConfig(localePath)) || {};
  const formatted = await prettier.format(patched.code, {
    ...config,
    parser: "typescript",
  });
  const changed = formatted !== current;

  const result = {
    dryRun,
    projectRoot: root,
    localePath,
    routesPath,
    routeOutput,
    routeKeyCount: routeKeys.size,
    candidateCount: candidates.length,
    applicableCount: applicable.length,
    changed,
    actions: patched.actions,
    skippedRouteKeys: candidates
      .filter((item) => !routeKeys.has(item.key))
      .map((item) => item.key),
    backupPath: null,
    reportPath: null,
  };

  if (dryRun || !changed) return result;

  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const backupPath = path.join(
    root,
    ".codegen",
    "aquasage",
    "backups",
    runId,
    "src",
    "locales",
    "langs",
    "zh-cn.ts",
  );
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await fs.writeFile(backupPath, current, "utf8");
  await atomicWrite(localePath, formatted);
  result.backupPath = backupPath;

  const reportPath = path.join(
    root,
    ".codegen",
    "aquasage",
    "reports",
    `${runId}-sync-zh-cn.json`,
  );
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  result.reportPath = reportPath;
  await fs.writeFile(
    reportPath,
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  return result;
}

export function extractI18nRouteKeys(routesCode) {
  const keys = new Set();
  const regex = /i18nKey\s*:\s*["']route\.([^"']+)["']/g;
  let match;
  while ((match = regex.exec(routesCode)) !== null) keys.add(match[1]);
  return keys;
}

export function buildZhCnTitleCandidates(plans) {
  const entries = [];
  for (const plan of plans) {
    const parentKey = `knowledge-engineering_engineering-catalog_${plan.resource.slug}`;
    entries.push({
      key: parentKey,
      title: plan.resource.title,
      resource: plan.resource.slug,
      page: "parent",
    });
    if (plan.operations.list) {
      entries.push({
        key: `${parentKey}_list`,
        title: `${plan.resource.title}列表`,
        resource: plan.resource.slug,
        page: "list",
      });
    }
    if (plan.operations.detail) {
      entries.push({
        key: `${parentKey}_detail`,
        title: `${plan.resource.title}详情`,
        resource: plan.resource.slug,
        page: "detail",
      });
    }
    if (plan.attachment.enabled) {
      entries.push({
        key: `${parentKey}_attachment`,
        title: `${plan.resource.title}附件列表`,
        resource: plan.resource.slug,
        page: "attachment",
      });
    }
  }
  return entries;
}

export function patchZhCnRouteObject(source, candidates, options = {}) {
  const range = findRouteObjectRange(source);
  const body = source.slice(range.bodyStart, range.bodyEnd);
  const properties = parseStringProperties(body);
  const replacements = [];
  const additions = [];
  const actions = [];

  for (const candidate of candidates) {
    const existing = properties.get(candidate.key);
    if (!existing) {
      additions.push(candidate);
      actions.push({ ...candidate, action: "created", previousTitle: null });
      continue;
    }
    if (existing.value === candidate.title) {
      actions.push({
        ...candidate,
        action: "unchanged",
        previousTitle: existing.value,
      });
      continue;
    }
    if (!options.force && !isPlaceholderTitle(candidate.key, existing.value)) {
      actions.push({
        ...candidate,
        action: "preserved",
        previousTitle: existing.value,
      });
      continue;
    }
    replacements.push({
      start: existing.start,
      end: existing.end,
      text: `${existing.indent}${quote(candidate.key)}: ${quote(candidate.title)},`,
    });
    actions.push({
      ...candidate,
      action: "updated",
      previousTitle: existing.value,
    });
  }

  let nextBody = body;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    nextBody =
      nextBody.slice(0, replacement.start) +
      replacement.text +
      nextBody.slice(replacement.end);
  }

  if (additions.length > 0) {
    const indent = properties.values().next().value?.indent || "    ";
    const trimmed = nextBody.replace(/\s+$/, "");
    const separator =
      trimmed.trim() && !trimmed.trimEnd().endsWith(",") ? "," : "";
    const lines = additions.map(
      (item) => `${indent}${quote(item.key)}: ${quote(item.title)},`,
    );
    nextBody = `${trimmed}${separator}\n${lines.join("\n")}\n  `;
  }

  return {
    code:
      source.slice(0, range.bodyStart) + nextBody + source.slice(range.bodyEnd),
    actions,
  };
}

function findRouteObjectRange(source) {
  const match = /\broute\s*:\s*\{/.exec(source);
  if (!match) throw new Error("zh-cn.ts 中未找到 route: { 配置对象");
  const openIndex = source.indexOf("{", match.index);
  const closeIndex = findMatchingBrace(source, openIndex);
  if (closeIndex === -1)
    throw new Error("zh-cn.ts 中 route 配置对象括号不完整");
  return { bodyStart: openIndex + 1, bodyEnd: closeIndex };
}

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let quoteChar = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quoteChar) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quoteChar) quoteChar = null;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quoteChar = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function parseStringProperties(body) {
  const properties = new Map();
  const regex =
    /(^[ \t]*)(?:(['"])([^'"\r\n]+)\2|([A-Za-z0-9_$-]+))\s*:\s*(['"])([^'"\r\n]*)\5\s*,?/gm;
  let match;
  while ((match = regex.exec(body)) !== null) {
    const key = match[3] || match[4];
    properties.set(key, {
      key,
      value: match[6],
      indent: match[1],
      start: match.index,
      end: regex.lastIndex,
    });
  }
  return properties;
}

function isPlaceholderTitle(key, value) {
  return value === key || value === `route.${key}` || value.trim() === "";
}

function quote(value) {
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

async function runElegantRouteGenerator(projectRoot) {
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = await execute(executable, ["exec", "sa", "gen-route"], {
    cwd: projectRoot,
  });
  if (result.exitCode !== 0) {
    throw new Error(`Elegant Router 路由生成失败:\n${result.output}`);
  }
  return result.output;
}

function execute(file, args, options) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { ...options, windowsHide: true, maxBuffer: 20 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          exitCode:
            typeof error?.code === "number" ? error.code : error ? 1 : 0,
          output: [stdout, stderr].filter(Boolean).join("\n"),
        });
      },
    );
  });
}

async function atomicWrite(filePath, content) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  await fs.writeFile(temporaryPath, content, "utf8");
  await fs.rename(temporaryPath, filePath);
}
