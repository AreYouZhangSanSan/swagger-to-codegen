import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  buildZhCnTitleCandidates,
  extractI18nRouteKeys,
  patchZhCnRouteObject,
  syncZhCnRouteTitles,
} from "../lib/aquasage/localeSynchronizer.js";

const parentKey = "knowledge-engineering_engineering-catalog_fish-survey";

function createPlan() {
  return {
    resource: { slug: "fish-survey", title: "鱼类调查" },
    operations: { list: {}, detail: {}, create: null, update: null },
    attachment: { enabled: true },
  };
}

test("extracts generated i18n route keys", () => {
  const keys = extractI18nRouteKeys(`
    meta: { i18nKey: 'route.${parentKey}' },
    meta: { i18nKey: "route.${parentKey}_list" },
  `);
  assert.deepEqual([...keys], [parentKey, `${parentKey}_list`]);
});

test("builds titles only for pages supported by the resource plan", () => {
  const entries = buildZhCnTitleCandidates([createPlan()]);
  assert.deepEqual(
    entries.map((item) => [item.key, item.title]),
    [
      [parentKey, "鱼类调查"],
      [`${parentKey}_list`, "鱼类调查列表"],
      [`${parentKey}_detail`, "鱼类调查详情"],
      [`${parentKey}_attachment`, "鱼类调查附件列表"],
    ],
  );
});

test("updates placeholders, adds missing keys and preserves manual Chinese", () => {
  const source = `export default {
  route: {
    home: '首页',
    ${parentKey}: '${parentKey}',
    '${parentKey}_detail': '人工维护的详情标题'
  }
}\n`;
  const result = patchZhCnRouteObject(
    source,
    buildZhCnTitleCandidates([createPlan()]).filter(
      (item) => !item.key.endsWith("_attachment"),
    ),
  );
  assert.match(result.code, new RegExp(`'${parentKey}': '鱼类调查'`));
  assert.match(result.code, new RegExp(`'${parentKey}_list': '鱼类调查列表'`));
  assert.match(result.code, /人工维护的详情标题/);
  assert.deepEqual(
    result.actions.map((item) => item.action),
    ["updated", "created", "preserved"],
  );
});

test("force mode replaces an existing manual title", () => {
  const source = `export default { route: { '${parentKey}': '人工标题' } }\n`;
  const [candidate] = buildZhCnTitleCandidates([createPlan()]);
  const result = patchZhCnRouteObject(source, [candidate], { force: true });
  assert.match(result.code, /'鱼类调查'/);
  assert.equal(result.actions[0].action, "updated");
});

test("syncs zh-cn atomically, backs up once and stays stable", async () => {
  const root = await createProjectFixture();
  try {
    const first = await syncZhCnRouteTitles({
      projectRoot: root,
      plans: [createPlan()],
      routeGeneration: false,
    });
    assert.equal(first.changed, true);
    assert.ok(first.backupPath);
    assert.ok(first.reportPath);
    assert.equal(first.skippedRouteKeys.length, 1);
    const locale = await fs.readFile(
      path.join(root, "src/locales/langs/zh-cn.ts"),
      "utf8",
    );
    assert.match(
      locale,
      new RegExp(`["']${parentKey}["']:\\s*["']鱼类调查["']`),
    );
    assert.match(locale, /人工维护的详情标题/);
    await fs.access(first.backupPath);

    const second = await syncZhCnRouteTitles({
      projectRoot: root,
      plans: [createPlan()],
      routeGeneration: false,
    });
    assert.equal(second.changed, false);
    assert.equal(second.backupPath, null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("dry-run reports changes without writing locale or backup", async () => {
  const root = await createProjectFixture();
  try {
    const localePath = path.join(root, "src/locales/langs/zh-cn.ts");
    const before = await fs.readFile(localePath, "utf8");
    const result = await syncZhCnRouteTitles({
      projectRoot: root,
      plans: [createPlan()],
      routeGeneration: false,
      dryRun: true,
    });
    assert.equal(result.changed, true);
    assert.equal(result.backupPath, null);
    assert.equal(await fs.readFile(localePath, "utf8"), before);
    await assert.rejects(fs.access(path.join(root, ".codegen")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function createProjectFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aquasage-locale-"));
  await fs.mkdir(path.join(root, "src/router/elegant"), { recursive: true });
  await fs.mkdir(path.join(root, "src/locales/langs"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "zdwp-aquasage-web" }),
  );
  await fs.writeFile(
    path.join(root, "src/router/elegant/routes.ts"),
    `export const routes = [
      { meta: { i18nKey: 'route.${parentKey}' } },
      { meta: { i18nKey: 'route.${parentKey}_list' } },
      { meta: { i18nKey: 'route.${parentKey}_detail' } }
    ]\n`,
  );
  await fs.writeFile(
    path.join(root, "src/locales/langs/zh-cn.ts"),
    `export default {
      route: {
        home: '首页',
        '${parentKey}': '${parentKey}',
        '${parentKey}_detail': '人工维护的详情标题'
      }
    }\n`,
  );
  return root;
}
