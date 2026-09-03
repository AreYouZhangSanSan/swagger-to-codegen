import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";

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

  if (placement.parent.create) {
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
  const resourceRouteName = `knowledge-engineering_engineering-catalog_${plan.resource.slug}`;
  return {
    parentRouteName: "knowledge-engineering_engineering-catalog",
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
  if (!placement.parent.create) return null;
  const config = {};
  if (placement.parent.icon) config.icon = placement.parent.icon;
  if (placement.parent.permission)
    config.permission = placement.parent.permission;
  if (placement.parent.order !== null) config.order = placement.parent.order;
  return Object.keys(config).length ? config : {};
}

function renderObject(config) {
  const properties = Object.entries(config).map(
    ([key, value]) => `${key}: ${JSON.stringify(value)}`,
  );
  return `{ ${properties.join(", ")} }`;
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
  const next = `${current.slice(0, closingIndex).replace(/\s+$/, "")}\n${missing.join("\n")}\n${current.slice(closingIndex + 1)}`;
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
