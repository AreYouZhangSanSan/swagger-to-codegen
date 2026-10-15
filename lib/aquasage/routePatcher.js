import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import prettier from "prettier";
import { deriveApiModule } from "./planner.js";

export async function patchAquaSageRoutes(projectRoot, plan) {
  const routeTitlesPath = path.join(
    projectRoot,
    "src",
    "router",
    "route-titles.ts",
  );
  const menuConfigPath = path.join(
    projectRoot,
    "src",
    "router",
    "menu-config.ts",
  );
  const placement = placementOf(plan);
  const parentKey = placement.resourceRouteName;
  const titleEntries = [
    [parentKey, plan.resource.title],
    [`${parentKey}_list`, `${plan.resource.title}列表`],
    [`${parentKey}_detail`, `${plan.resource.title}详情`],
  ];
  if (plan.attachment.enabled)
    titleEntries.push([
      `${parentKey}_attachment`,
      `${plan.resource.title}附件列表`,
    ]);

  if (placement.parent.title) {
    titleEntries.unshift([placement.parentRouteName, placement.parent.title]);
  }

  const menuEntries = [
    [`${parentKey}_list`, childMenu(placement)],
    [`${parentKey}_detail`, childMenu(placement)],
  ];
  if (plan.attachment.enabled)
    menuEntries.push([`${parentKey}_attachment`, childMenu(placement)]);
  const resourceMenu = resourceMenuConfig(placement);
  if (resourceMenu) menuEntries.push([parentKey, resourceMenu]);
  const parentMenu = parentMenuConfig(placement);
  if (parentMenu) menuEntries.unshift([placement.parentRouteName, parentMenu]);

  const titleResult = await patchRecord(
    projectRoot,
    routeTitlesPath,
    titleEntries.map(
      ([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`,
    ),
  );
  const menuResult = await patchRecord(
    projectRoot,
    menuConfigPath,
    menuEntries.map(
      ([key, config]) => `  ${JSON.stringify(key)}: ${renderObject(config)},`,
    ),
  );
  const redirectResult = await patchAquaSageRedirect(
    projectRoot,
    placement.resourceRouteName,
  );
  return {
    routeTitles: titleResult,
    menuConfig: menuResult,
    redirect: redirectResult,
  };
}

function placementOf(plan) {
  if (plan.placement) return plan.placement;
  const module = deriveApiModule(plan.resource.basePath) || "engineering-catalog";
  const parentRouteName = `knowledge-engineering_${module}`;
  const resourceRouteName = `${parentRouteName}_${plan.resource.slug}`;
  return {
    parentRouteName,
    resourceRouteName,
    menu: {
      hideResource: false,
      activeMenu: resourceRouteName,
      permission: null,
      order: null,
    },
    parent: {
      create: false,
      title: null,
      icon: null,
      order: null,
      permission: null,
    },
  };
}

function childMenu(placement) {
  return { hideInMenu: true, activeMenu: placement.menu.activeMenu };
}

function resourceMenuConfig(placement) {
  const config = {};
  if (placement.menu.hideResource) {
    config.hideInMenu = true;
    config.activeMenu = placement.menu.activeMenu;
  }
  if (placement.menu.permission) config.permission = placement.menu.permission;
  if (placement.menu.order !== null) config.order = placement.menu.order;
  return Object.keys(config).length ? config : null;
}

function parentMenuConfig(placement) {
  const config = {};
  if (placement.parent.icon) config.icon = placement.parent.icon;
  if (placement.parent.permission)
    config.permission = placement.parent.permission;
  if (placement.parent.order !== null) config.order = placement.parent.order;
  if (placement.parent.create) return Object.keys(config).length ? config : {};
  // 未新建父路由时，推导出的父路由（如 /knowledge-engineering/hyo）也允许补图标/排序/权限
  return Object.keys(config).length ? config : null;
}

function renderObject(config) {
  const properties = Object.entries(config).map(
    ([key, value]) => `${key}: ${JSON.stringify(value)}`,
  );
  return `{ ${properties.join(", ")} }`;
}

/**
 * 补丁 elegant-router 生成的 routes.ts 占位标题。
 * 该项目的 vite 插件用 routeTitleMap 生成标题，但只在下一次 dev/build 时再生；
 * 这里直接把“标题等于路由名”的占位符替换为中文，绝不覆盖人工改过的标题。
 */
export async function patchElegantRouteTitles(projectRoot, plans) {
  const filePath = path.join(
    projectRoot,
    "src",
    "router",
    "elegant",
    "routes.ts",
  );
  const entries = [];
  for (const plan of plans) {
    const placement = placementOf(plan);
    entries.push([placement.resourceRouteName, plan.resource.title]);
    entries.push([
      `${placement.resourceRouteName}_list`,
      `${plan.resource.title}列表`,
    ]);
    entries.push([
      `${placement.resourceRouteName}_detail`,
      `${plan.resource.title}详情`,
    ]);
    if (plan.attachment.enabled)
      entries.push([
        `${placement.resourceRouteName}_attachment`,
        `${plan.resource.title}附件列表`,
      ]);
    if (placement.parent?.title)
      entries.push([placement.parentRouteName, placement.parent.title]);
  }

  // vite 的 elegant-router 插件会在 dev/build 时重写这个文件，
  // 写入前做语法校验与并发修改检测，避免与它交错写坏文件
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let current;
    try {
      current = await fs.readFile(filePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        return { action: "skipped", filePath, reason: "未找到 elegant/routes.ts" };
      }
      throw error;
    }

    const parseError = await syntaxErrorOf(projectRoot, filePath, current);
    if (parseError) {
      return {
        action: "skipped",
        filePath,
        reason: `文件当前无法解析（${parseError}），可能正被 dev 服务重新生成或已损坏，跳过标题补丁`,
      };
    }

    let next = current;
    let updated = 0;
    for (const [key, title] of entries) {
      const placeholder = new RegExp(
        `title\\s*:\\s*['"]${escapeRegExp(key)}['"]`,
        "g",
      );
      const replacement = `title: ${JSON.stringify(title)}`;
      next = next.replace(placeholder, () => {
        updated += 1;
        return replacement;
      });
    }
    // 路由名根本没出现在 routes.ts 里时，vite 插件的 `routeTitleMap[key] ?? key`
    // 会回退成英文路由名，表现为「route-titles.ts 有中文、页面标题却是英文」。
    // 这里显式收集出来，交给调用方告警，避免这种沉默故障。
    const unresolved = entries
      .map(([key]) => key)
      .filter(
        (key) =>
          !new RegExp(`name\\s*:\\s*['"]${escapeRegExp(key)}['"]`).test(next),
      );
    if (next === current) return { action: "unchanged", filePath, unresolved };

    // 写入前再读一次：内容变了说明有并发写入，重读重试一次
    const onDisk = await fs.readFile(filePath, "utf8");
    if (onDisk !== current && attempt === 0) continue;
    if (onDisk !== current) {
      return {
        action: "skipped",
        filePath,
        unresolved,
        reason: "文件被其他进程并发修改，跳过标题补丁；停止 dev 服务后重跑本命令即可",
      };
    }

    const backupPath = await backupFile(projectRoot, filePath, current);
    await atomicWrite(filePath, next);
    return { action: "updated", filePath, updated, backupPath, unresolved };
  }
  return { action: "skipped", filePath, reason: "文件被并发修改" };
}

/** 用 prettier 做一次 TS 语法校验，返回错误信息；可解析时返回 null */
async function syntaxErrorOf(projectRoot, filePath, content) {
  const config = (await prettier.resolveConfig(filePath)) || {};
  try {
    await prettier.format(content, { ...config, parser: "typescript" });
    return null;
  } catch (error) {
    return String(error.message || error).slice(0, 120);
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function patchAquaSageRedirect(projectRoot, routeName) {
  const filePath = path.join(
    projectRoot,
    "src",
    "router",
    "routes",
    "index.ts",
  );
  let current;
  try {
    current = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return { action: "skipped", filePath, reason: "未找到 routes/index.ts" };
    }
    throw error;
  }
  const marker = "const REDIRECT_TO_LIST_ROUTES = new Set<string>([";
  const markerIndex = current.indexOf(marker);
  if (markerIndex === -1) {
    return { action: "skipped", filePath, reason: "未找到列表重定向集合" };
  }
  const closingIndex = current.indexOf("]", markerIndex + marker.length);
  if (closingIndex === -1) {
    return { action: "skipped", filePath, reason: "列表重定向集合未闭合" };
  }
  const setBody = current.slice(markerIndex + marker.length, closingIndex);
  const escaped = routeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`["']${escaped}["']`).test(setBody)) {
    return { action: "unchanged", filePath };
  }
  const insertAt = markerIndex + marker.length;
  const next = `${current.slice(0, insertAt)}\n  ${JSON.stringify(routeName)},${current.slice(insertAt)}`;
  const backupPath = await backupFile(projectRoot, filePath, current);
  await atomicWrite(filePath, next);
  return { action: "updated", filePath, backupPath };
}

async function patchRecord(projectRoot, filePath, candidateLines) {
  const current = await fs.readFile(filePath, "utf8");
  const missing = candidateLines.filter((line) => {
    const quotedKey = line.match(/^\s*(["'][^"']+["'])\s*:/)?.[1];
    if (!quotedKey) return false;
    const key = quotedKey.slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`["']${key}["']\\s*:`).test(current);
  });
  if (missing.length === 0) return { action: "unchanged", filePath };

  const closingIndex = current.lastIndexOf("\n}");
  if (closingIndex === -1)
    throw new Error(`无法定位配置对象结束位置: ${filePath}`);

  // 原文件最后一条往往没有尾逗号（它原本就是末项），直接在其后追加会写出
  // 非法的对象字面量，导致目标项目 dev/build 直接报 "Expected } but found ..."。
  const head = current.slice(0, closingIndex).replace(/\s+$/, "");
  const separator = /[{,]$/.test(head) ? "" : ",";
  const next = `${head}${separator}\n${missing.join("\n")}\n${current.slice(closingIndex + 1)}`;

  // 写盘前先确认结果是合法 TS，宁可中止也不要把目标项目写成编译不过的状态
  const parseError = await syntaxErrorOf(projectRoot, filePath, next);
  if (parseError) {
    throw new Error(
      `写入 ${path.relative(projectRoot, filePath)} 会产生语法错误，已中止写入：${parseError}`,
    );
  }

  const backupPath = await backupFile(projectRoot, filePath, current);
  await atomicWrite(filePath, next);
  return { action: "updated", filePath, backupPath };
}

async function backupFile(projectRoot, filePath, current) {
  const backupPath = path.join(
    projectRoot,
    ".codegen",
    "aquasage",
    "backups",
    `${Date.now()}-${randomUUID().slice(0, 8)}`,
    path.relative(projectRoot, filePath),
  );
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  try {
    await fs.writeFile(backupPath, current, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return backupPath;
}

async function atomicWrite(filePath, content) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  await fs.writeFile(temporaryPath, content, "utf8");
  await fs.rename(temporaryPath, filePath);
}
