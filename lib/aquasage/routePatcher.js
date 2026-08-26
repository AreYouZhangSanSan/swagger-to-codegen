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
  const parentKey = `knowledge-engineering_engineering-catalog_${plan.resource.slug}`;
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

  const menuEntries = [
    [`${parentKey}_list`, parentKey],
    [`${parentKey}_detail`, parentKey],
  ];
  if (plan.attachment.enabled)
    menuEntries.push([`${parentKey}_attachment`, parentKey]);

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
      ([key, activeMenu]) =>
        `  ${JSON.stringify(key)}: { hideInMenu: true, activeMenu: ${JSON.stringify(activeMenu)} },`,
    ),
  );
  return { routeTitles: titleResult, menuConfig: menuResult };
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
  const backupPath = path.join(
    projectRoot,
    ".codegen",
    "aquasage",
    "backups",
    `${Date.now()}-${randomUUID().slice(0, 8)}`,
    path.relative(projectRoot, filePath),
  );
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await fs.writeFile(backupPath, current, "utf8");
  await atomicWrite(filePath, next);
  return { action: "updated", filePath, backupPath };
}

async function atomicWrite(filePath, content) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  await fs.writeFile(temporaryPath, content, "utf8");
  await fs.rename(temporaryPath, filePath);
}
