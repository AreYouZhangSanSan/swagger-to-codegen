import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { planAquaSageResources } from "../lib/aquasage/planner.js";
import { renderAquaSageFiles } from "../lib/aquasage/renderer.js";
import { generateAquaSageProject } from "../lib/aquasage/projectGenerator.js";
import { patchAquaSageRoutes } from "../lib/aquasage/routePatcher.js";
import { configureAquaSagePlans } from "../lib/aquasage/placementResolver.js";

const document = {
  openapi: "3.1.0",
  paths: {
    "/api/v1/prj/pumping-station/page": {
      get: {
        tags: ["水利工程"],
        operationId: "list_pumping_station",
        summary: "分页查询泵站信息",
        parameters: [
          {
            name: "current",
            in: "query",
            schema: { type: "integer", default: 1 },
          },
          {
            name: "size",
            in: "query",
            schema: { type: "integer", default: 15 },
          },
          {
            name: "order",
            in: "query",
            schema: { type: "string", default: "id" },
          },
          {
            name: "order_by",
            in: "query",
            schema: { type: "string", default: "asc" },
          },
          {
            name: "city_code",
            in: "query",
            schema: { anyOf: [{ type: "string" }, { type: "null" }] },
          },
          {
            name: "name",
            in: "query",
            schema: { anyOf: [{ type: "string" }, { type: "null" }] },
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ResultPageResponsePrjPumpingStation",
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/prj/pumping-station/detail": {
      get: {
        tags: ["水利工程"],
        operationId: "get_pumping_station_detail",
        summary: "查询泵站详情",
        parameters: [
          {
            name: "project_code",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ResultPrjPumpingStation",
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/prj/pumping-station": {
      post: {
        tags: ["水利工程"],
        operationId: "create_pumping_station",
        summary: "创建泵站信息",
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PrjPumpingStation" },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ResultPrjPumpingStation",
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/prj/pumping-station/update": {
      post: {
        tags: ["水利工程"],
        operationId: "update_pumping_station",
        summary: "更新泵站信息",
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PrjPumpingStation" },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ResultPrjPumpingStation",
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/prj/pumping-station/del": {
      post: {
        tags: ["水利工程"],
        operationId: "delete_pumping_station",
        summary: "删除泵站信息",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["id"],
                properties: { id: { type: "integer" } },
              },
            },
          },
        },
        responses: {
          200: {
            content: { "application/json": { schema: { type: "boolean" } } },
          },
        },
      },
    },
    "/api/v1/prj/reservoir/page": {
      get: {
        tags: ["水利工程"],
        operationId: "list_reservoir",
        parameters: [],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/PrjReservoir" },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      ResultPageResponsePrjPumpingStation: {
        type: "object",
        properties: {
          code: { type: "string" },
          data: {
            anyOf: [
              { $ref: "#/components/schemas/PageResponsePrjPumpingStation" },
              { type: "null" },
            ],
          },
        },
      },
      PageResponsePrjPumpingStation: {
        type: "object",
        required: ["current", "size", "total"],
        properties: {
          current: { type: "integer" },
          size: { type: "integer" },
          total: { type: "integer" },
          total_page: { type: "integer" },
          data: {
            type: "array",
            items: { $ref: "#/components/schemas/PrjPumpingStation" },
          },
        },
      },
      ResultPrjPumpingStation: {
        type: "object",
        properties: {
          data: { $ref: "#/components/schemas/PrjPumpingStation" },
        },
      },
      PrjPumpingStation: {
        type: "object",
        required: ["id", "project_code", "name"],
        properties: {
          id: { type: "integer" },
          project_code: { type: "string", description: "工程代码" },
          std_code: { type: "string", description: "标准编码" },
          name: { type: "string", description: "泵站名称" },
          city_code: { type: "string", description: "城市编码" },
          area_code: { type: "string", description: "区县编码" },
          motor_power: { type: "number", description: "装机功率" },
        },
      },
      PrjReservoir: {
        type: "object",
        properties: { id: { type: "integer" }, name: { type: "string" } },
      },
    },
  },
};

test("splits one tag into stable business resources", () => {
  const plans = planAquaSageResources(document, { tag: "水利工程" });
  assert.deepEqual(plans.map((plan) => plan.resource.slug).sort(), [
    "pumping-station",
    "reservoir",
  ]);
});

test("builds AquaSage pagination, detail key and field conventions", () => {
  const [plan] = planAquaSageResources(document, {
    resource: "/api/v1/prj/pumping-station",
    title: "泵站",
    withAttachment: true,
  });
  assert.equal(plan.list.recordsPath, "data.data");
  assert.equal(plan.list.totalPath, "data.total");
  assert.deepEqual(
    plan.list.searchFields.map((field) => field.name),
    ["city_code", "name"],
  );
  assert.equal(plan.form.detailParam.name, "project_code");
  assert.equal(plan.form.detailRefField, "project_code");
  assert.equal(
    plan.form.fields.find((field) => field.name === "city_code").widget,
    "tree",
  );
  assert.equal(plan.attachment.refField, "std_code");
});

test("renders only zdwp-aquasage-web file conventions", () => {
  const [plan] = planAquaSageResources(document, {
    resource: "/api/v1/prj/pumping-station",
    title: "泵站",
    withAttachment: true,
  });
  const files = renderAquaSageFiles(plan);
  assert.ok(files["src/service/api/engineering-catalog/pumping-station.ts"]);
  assert.ok(files["src/config/engineering/pumping-station-fields.ts"]);
  assert.ok(
    files[
      "src/views/knowledge-engineering/engineering-catalog/pumping-station/list/index.vue"
    ],
  );
  assert.ok(
    files[
      "src/views/knowledge-engineering/engineering-catalog/pumping-station/attachment/index.vue"
    ],
  );
  assert.equal(
    Object.keys(files).some((file) => file.includes("src/api/modules")),
    false,
  );
  assert.doesNotMatch(
    Object.values(files).join("\n"),
    /unknown as never|import\s*\{[^}]*undefined/,
  );
  assert.match(
    files[
      "src/views/knowledge-engineering/engineering-catalog/pumping-station/detail/index.vue"
    ],
    /project_code: String\(params\.id\)/,
  );
});

test("dry-run validates the target and formats every generated file without writing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aquasage-project-"));
  try {
    await fs.mkdir(path.join(root, "src/service/request"), { recursive: true });
    await fs.mkdir(path.join(root, "src/components/common/engineering-form"), {
      recursive: true,
    });
    await fs.mkdir(path.join(root, "src/components/advanced"), {
      recursive: true,
    });
    await fs.mkdir(path.join(root, "src/hooks/common"), { recursive: true });
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "zdwp-aquasage-web" }),
    );
    await fs.writeFile(path.join(root, "src/service/request/index.ts"), "");
    await fs.writeFile(
      path.join(root, "src/components/common/engineering-form/index.vue"),
      "",
    );
    await fs.writeFile(
      path.join(root, "src/components/advanced/top-search-tool.vue"),
      "",
    );
    await fs.writeFile(path.join(root, "src/hooks/common/table.ts"), "");
    const plans = planAquaSageResources(document, {
      resource: "/api/v1/prj/pumping-station",
      title: "泵站",
    });
    const result = await generateAquaSageProject({
      projectRoot: root,
      plans,
      contractSource: "fixture",
      dryRun: true,
    });
    assert.equal(result.dryRun, true);
    assert.equal(result.files.length, 5);
    await assert.rejects(
      fs.access(
        path.join(
          root,
          "src/service/api/engineering-catalog/pumping-station.ts",
        ),
      ),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("writes copy-ready AquaSage files and is stable on the second run", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aquasage-write-"));
  try {
    await fs.mkdir(path.join(root, "src/service/request"), { recursive: true });
    await fs.mkdir(path.join(root, "src/components/common/engineering-form"), {
      recursive: true,
    });
    await fs.mkdir(path.join(root, "src/components/advanced"), {
      recursive: true,
    });
    await fs.mkdir(path.join(root, "src/hooks/common"), { recursive: true });
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "zdwp-aquasage-web" }),
    );
    await fs.writeFile(path.join(root, "src/service/request/index.ts"), "");
    await fs.writeFile(
      path.join(root, "src/components/common/engineering-form/index.vue"),
      "",
    );
    await fs.writeFile(
      path.join(root, "src/components/advanced/top-search-tool.vue"),
      "",
    );
    await fs.writeFile(path.join(root, "src/hooks/common/table.ts"), "");
    const plans = planAquaSageResources(document, {
      resource: "/api/v1/prj/pumping-station",
      title: "泵站",
    });
    const options = {
      projectRoot: root,
      plans,
      contractSource: "fixture",
      patchRoutes: false,
      routeGeneration: false,
      check: false,
    };
    const first = await generateAquaSageProject(options);
    assert.equal(
      first.files.every((file) => file.action === "created"),
      true,
    );
    const second = await generateAquaSageProject(options);
    assert.equal(
      second.files.every((file) => file.action === "unchanged"),
      true,
    );
    const listPath = path.join(
      root,
      "src/views/knowledge-engineering/engineering-catalog/pumping-station/list/index.vue",
    );
    assert.match(await fs.readFile(listPath, "utf8"), /useNaivePaginatedTable/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("patches route metadata once and preserves backups outside src", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aquasage-routes-"));
  try {
    const routerDir = path.join(root, "src/router");
    await fs.mkdir(routerDir, { recursive: true });
    await fs.writeFile(
      path.join(routerDir, "route-titles.ts"),
      "export const routeTitleMap = {\n  'home': '首页',\n}\n",
    );
    await fs.writeFile(
      path.join(routerDir, "menu-config.ts"),
      "export const menuConfig = {\n  'home': {},\n}\n",
    );
    const [plan] = planAquaSageResources(document, {
      resource: "/api/v1/prj/pumping-station",
      title: "泵站",
    });
    const first = await patchAquaSageRoutes(root, plan);
    assert.equal(first.routeTitles.action, "updated");
    assert.match(
      await fs.readFile(path.join(routerDir, "route-titles.ts"), "utf8"),
      /pumping-station_list/,
    );
    assert.match(
      first.routeTitles.backupPath,
      /\.codegen[\\/]aquasage[\\/]backups/,
    );
    const second = await patchAquaSageRoutes(root, plan);
    assert.equal(second.routeTitles.action, "unchanged");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("places generated CRUD beside a compatible reference module", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aquasage-placement-"));
  try {
    const referenceRoot = path.join(
      root,
      "src/views/knowledge-engineering/spatial-element/river-system/rivers",
    );
    await fs.mkdir(path.join(referenceRoot, "list"), { recursive: true });
    await fs.writeFile(
      path.join(referenceRoot, "list/index.vue"),
      `<script setup lang="tsx">
import { useNaivePaginatedTable } from '@/hooks/common/table'
import { riverFields } from '@/config/engineering/river-fields'
import { fetchGetRiverList } from '@/service/api/spatial-element/river'
</script>
<template><NDataTable /></template>`,
    );
    await fs.mkdir(path.join(root, "src/router"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src/router/menu-config.ts"),
      `export const menuConfig = {
  'knowledge-engineering_spatial-element_river-system_rivers': {
    hideInMenu: true,
    activeMenu: 'knowledge-engineering_spatial-element_river-system'
  }
}`,
    );

    const rawPlans = planAquaSageResources(document, {
      resource: "/api/v1/prj/pumping-station",
      title: "泵站",
    });
    const [plan] = await configureAquaSagePlans(root, rawPlans, {
      referenceView:
        "src/views/knowledge-engineering/spatial-element/river-system/rivers",
      targetParent: "/knowledge-engineering/spatial-element/river-system",
    });

    assert.equal(plan.placement.mode, "reference");
    assert.equal(plan.placement.serviceGroup, "spatial-element");
    assert.equal(plan.placement.configGroup, "engineering");
    assert.equal(plan.placement.typeNamespace, "SpatialElement");
    assert.equal(plan.placement.menu.mode, "parent");
    assert.equal(
      plan.placement.resourceRouteName,
      "knowledge-engineering_spatial-element_river-system_pumping-station",
    );

    const files = renderAquaSageFiles(plan);
    const listPath =
      "src/views/knowledge-engineering/spatial-element/river-system/pumping-station/list/index.vue";
    assert.ok(files[listPath]);
    assert.match(
      files[listPath],
      /@\/service\/api\/spatial-element\/pumping-station/,
    );
    assert.match(files[listPath], /Api\.SpatialElement\.PumpingStation/);
    assert.ok(files["src/typings/api/spatial-element/pumpingStation.d.ts"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("creates custom parent metadata and list redirect idempotently", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aquasage-parent-"));
  try {
    const routerDir = path.join(root, "src/router");
    await fs.mkdir(path.join(routerDir, "routes"), { recursive: true });
    await fs.mkdir(path.join(root, "src/views/knowledge-engineering"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(routerDir, "route-titles.ts"),
      "export const routeTitleMap = {\n  'home': '首页',\n}\n",
    );
    await fs.writeFile(
      path.join(routerDir, "menu-config.ts"),
      "export const menuConfig = {\n  'home': {},\n}\n",
    );
    await fs.writeFile(
      path.join(routerDir, "routes/index.ts"),
      "const REDIRECT_TO_LIST_ROUTES = new Set<string>([\n  'home',\n])\n",
    );
    const rawPlans = planAquaSageResources(document, {
      resource: "/api/v1/prj/pumping-station",
      title: "泵站",
    });
    const [plan] = await configureAquaSagePlans(root, rawPlans, {
      targetParent: "/knowledge-engineering/hydrology-archive",
      createParent: true,
      parentTitle: "水文档案",
      parentIcon: "mdi:archive-water",
      parentOrder: "8",
    });

    const first = await patchAquaSageRoutes(root, plan);
    assert.equal(first.redirect.action, "updated");
    const titles = await fs.readFile(
      path.join(routerDir, "route-titles.ts"),
      "utf8",
    );
    const menus = await fs.readFile(
      path.join(routerDir, "menu-config.ts"),
      "utf8",
    );
    const routes = await fs.readFile(
      path.join(routerDir, "routes/index.ts"),
      "utf8",
    );
    assert.match(titles, /knowledge-engineering_hydrology-archive.*水文档案/);
    assert.match(menus, /mdi:archive-water/);
    assert.match(menus, /order: 8/);
    assert.match(
      routes,
      /knowledge-engineering_hydrology-archive_pumping-station/,
    );

    const second = await patchAquaSageRoutes(root, plan);
    assert.equal(second.redirect.action, "unchanged");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("requires an explicit parent path before creating parent metadata", async () => {
  const plans = planAquaSageResources(document, {
    resource: "/api/v1/prj/pumping-station",
    title: "泵站",
  });
  await assert.rejects(
    configureAquaSagePlans(".", plans, {
      createParent: true,
      parentTitle: "水文档案",
    }),
    /--target-parent/,
  );
});
