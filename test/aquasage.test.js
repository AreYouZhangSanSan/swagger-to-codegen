import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { planAquaSageResources } from "../lib/aquasage/planner.js";
import { renderAquaSageFiles } from "../lib/aquasage/renderer.js";
import { generateAquaSageProject } from "../lib/aquasage/projectGenerator.js";
import {
  patchAquaSageRoutes,
  patchElegantRouteTitles,
} from "../lib/aquasage/routePatcher.js";
import { matchDevCommandLine } from "../lib/aquasage/validator.js";
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
    "/api/v1/prj/pumping-station/options": {
      get: {
        tags: ["水利工程"],
        operationId: "list_pumping_station_options",
        summary: "查询泵站下拉列表",
        parameters: [
          {
            name: "city_code",
            in: "query",
            schema: { anyOf: [{ type: "string" }, { type: "null" }] },
          },
          {
            name: "keyword",
            in: "query",
            schema: { type: "string", description: "名称模糊匹配" },
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ResultListPumpingStationOption",
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/prj/pumping-station/import": {
      post: {
        tags: ["水利工程"],
        operationId: "import_pumping_station",
        summary: "导入泵站信息",
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PumpingStationImportBody" },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { type: "object", properties: { ok: { type: "boolean" } } },
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
      ResultListPumpingStationOption: {
        type: "object",
        properties: {
          code: { type: "string" },
          data: {
            anyOf: [
              {
                type: "array",
                items: { $ref: "#/components/schemas/PumpingStationOption" },
              },
              { type: "null" },
            ],
          },
        },
      },
      PumpingStationOption: {
        type: "object",
        properties: {
          id: { type: "integer", description: "主键ID" },
          name: { type: "string", description: "泵站名称" },
          children: {
            type: "array",
            items: { $ref: "#/components/schemas/PumpingStationOption" },
          },
        },
      },
      PumpingStationImportBody: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string", description: "文件路径" },
          overwrite: { type: "boolean", description: "是否覆盖" },
        },
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

test("generates service functions, types and fields for every non-CRUD endpoint", () => {
  const [plan] = planAquaSageResources(document, {
    resource: "/api/v1/prj/pumping-station",
    title: "泵站",
  });
  assert.deepEqual(
    plan.extraOperations.map((extra) => extra.action).sort(),
    ["Import", "Options"],
  );
  const files = renderAquaSageFiles(plan);
  const service = files["src/service/api/prj/pumping-station.ts"];
  const types = files["src/typings/api/prj/pumpingStation.d.ts"];
  const config = files["src/config/prj/pumping-station-fields.ts"];

  assert.match(service, /export function fetchGetPrjPumpingStationOptions/);
  assert.match(service, /export function fetchPostPrjPumpingStationImport/);
  assert.match(service, /Api\.Prj\.PumpingStation\.OptionsItem\[\]/);
  assert.match(service, /Api\.Prj\.PumpingStation\.ImportPayload/);
  assert.match(types, /interface OptionsParams/);
  assert.match(types, /interface OptionsItem/);
  assert.match(types, /interface ImportPayload/);
  // 自引用 children 只展开一层，不无限递归
  assert.match(types, /children\?: unknown\[\]/);
  assert.match(config, /export const optionsFields: FormField\[\] = \[/);
  assert.match(config, /export const importFields: FormField\[\] = \[/);
  // 主 CRUD 函数保持不变
  assert.match(service, /export function fetchGetPrjPumpingStationList/);
  assert.match(service, /export function fetchDeletePrjPumpingStation/);
});

test("keeps the parent schema description for anyOf-wrapped fields", () => {
  const withAnyOf = {
    ...document,
    components: {
      schemas: {
        ...document.components.schemas,
        PrjPumpingStation: {
          ...document.components.schemas.PrjPumpingStation,
          properties: {
            ...document.components.schemas.PrjPumpingStation.properties,
            name: {
              anyOf: [{ type: "string" }, { type: "null" }],
              title: "Name",
              description: "泵站名称",
            },
          },
        },
      },
    },
  };
  const [plan] = planAquaSageResources(withAnyOf, {
    resource: "/api/v1/prj/pumping-station",
    title: "泵站",
  });
  const formField = plan.form.fields.find((field) => field.name === "name");
  assert.equal(formField.label, "泵站名称");
  const tableField = plan.list.tableFields.find(
    (field) => field.name === "name",
  );
  assert.equal(tableField.label, "泵站名称");
});

test("infers complete Chinese titles from schema descriptions and summaries", () => {
  const withSchemaDesc = {
    ...document,
    components: {
      schemas: {
        ...document.components.schemas,
        PrjPumpingStation: {
          ...document.components.schemas.PrjPumpingStation,
          description: "泵站信息",
        },
      },
    },
  };
  const [fromSchema] = planAquaSageResources(withSchemaDesc, {
    resource: "/api/v1/prj/pumping-station",
  });
  assert.equal(fromSchema.resource.title, "泵站");

  const withLongSummary = {
    ...document,
    paths: {
      ...document.paths,
      "/api/v1/prj/pumping-station/page": {
        ...document.paths["/api/v1/prj/pumping-station/page"],
        get: {
          ...document.paths["/api/v1/prj/pumping-station/page"].get,
          summary: "根据入参分页查询泵站信息",
        },
      },
    },
  };
  const [fromSummary] = planAquaSageResources(withLongSummary, {
    resource: "/api/v1/prj/pumping-station",
  });
  assert.equal(fromSummary.resource.title, "泵站");

  const withIdSummary = {
    ...document,
    paths: {
      ...document.paths,
      "/api/v1/prj/pumping-station/detail": {
        ...document.paths["/api/v1/prj/pumping-station/detail"],
        get: {
          ...document.paths["/api/v1/prj/pumping-station/detail"].get,
          summary: "根据id查询泵站详情",
        },
      },
      "/api/v1/prj/pumping-station/page": {
        ...document.paths["/api/v1/prj/pumping-station/page"],
        get: {
          ...document.paths["/api/v1/prj/pumping-station/page"].get,
          summary: undefined,
        },
      },
    },
  };
  const [fromIdSummary] = planAquaSageResources(withIdSummary, {
    resource: "/api/v1/prj/pumping-station",
  });
  assert.equal(fromIdSummary.resource.title, "泵站");
});

test("renders only zdwp-aquasage-web file conventions", () => {
  const [plan] = planAquaSageResources(document, {
    resource: "/api/v1/prj/pumping-station",
    title: "泵站",
    withAttachment: true,
  });
  const files = renderAquaSageFiles(plan);
  assert.ok(files["src/service/api/prj/pumping-station.ts"]);
  assert.ok(files["src/config/prj/pumping-station-fields.ts"]);
  assert.ok(
    files[
      "src/views/knowledge-engineering/prj/pumping-station/list/index.vue"
    ],
  );
  assert.ok(
    files[
      "src/views/knowledge-engineering/prj/pumping-station/attachment/index.vue"
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
      "src/views/knowledge-engineering/prj/pumping-station/detail/index.vue"
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
      fs.access(path.join(root, "src/service/api/prj/pumping-station.ts")),
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
      "src/views/knowledge-engineering/prj/pumping-station/list/index.vue",
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

test("patches module-derived parent title and elegant routes placeholders", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aquasage-titles-"));
  try {
    const routerDir = path.join(root, "src/router");
    await fs.mkdir(path.join(routerDir, "elegant"), { recursive: true });
    await fs.writeFile(
      path.join(routerDir, "route-titles.ts"),
      "export const routeTitleMap = {\n  'home': '首页',\n}\n",
    );
    await fs.writeFile(
      path.join(routerDir, "menu-config.ts"),
      "export const menuConfig = {\n  'home': {},\n}\n",
    );
    await fs.writeFile(
      path.join(routerDir, "elegant", "routes.ts"),
      `export const generatedRoutes = [
  {
    name: 'knowledge-engineering_prj',
    path: '/knowledge-engineering/prj',
    meta: { title: 'knowledge-engineering_prj' },
    children: [
      {
        name: 'knowledge-engineering_prj_pumping-station',
        path: '/knowledge-engineering/prj/pumping-station',
        meta: { title: 'knowledge-engineering_prj_pumping-station' },
        children: [
          {
            name: 'knowledge-engineering_prj_pumping-station_list',
            path: '/knowledge-engineering/prj/pumping-station/list',
            meta: { title: 'knowledge-engineering_prj_pumping-station_list' }
          },
          {
            name: 'knowledge-engineering_prj_pumping-station_detail',
            path: '/knowledge-engineering/prj/pumping-station/detail',
            meta: { title: '知识档案' }
          }
        ]
      }
    ]
  }
]
`,
    );
    const plans = await configureAquaSagePlans(
      root,
      planAquaSageResources(document, {
        resource: "/api/v1/prj/pumping-station",
        title: "泵站",
      }),
      {},
    );

    // 1. 模块推导的父路由用 Swagger tag 名补 route-titles
    await patchAquaSageRoutes(root, plans[0]);
    const titles = await fs.readFile(
      path.join(routerDir, "route-titles.ts"),
      "utf8",
    );
    assert.match(titles, /knowledge-engineering_prj["']\s*:\s*["']水利工程/);

    // 1b. 推导父路由也可以带图标（写入 menu-config，dev 再生成时合并进 routes.ts）
    const withIcon = await configureAquaSagePlans(
      root,
      planAquaSageResources(document, {
        resource: "/api/v1/prj/pumping-station",
        title: "泵站",
      }),
      { parentIcon: "mdi:waves" },
    );
    await patchAquaSageRoutes(root, withIcon[0]);
    const menus = await fs.readFile(
      path.join(routerDir, "menu-config.ts"),
      "utf8",
    );
    assert.match(
      menus,
      /knowledge-engineering_prj["']\s*:\s*\{\s*icon:\s*["']mdi:waves["']/,
    );

    // 2. elegant/routes.ts 占位标题补全为中文，人工中文保留
    const first = await patchElegantRouteTitles(root, plans);
    assert.equal(first.action, "updated");
    const routes = await fs.readFile(
      path.join(routerDir, "elegant", "routes.ts"),
      "utf8",
    );
    assert.match(routes, /title: "水利工程"/);
    assert.match(routes, /title: "泵站"/);
    assert.match(routes, /title: "泵站列表"/);
    assert.match(routes, /title: '知识档案'/);
    assert.doesNotMatch(
      routes,
      /title: 'knowledge-engineering_prj_pumping-station_detail'/,
    );

    const second = await patchElegantRouteTitles(root, plans);
    assert.equal(second.action, "unchanged");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("detects a running vite dev server for the project", () => {
  const output = [
    "C:\\Program Files\\nodejs\\node.exe something",
    "node D:\\workCode\\知识库\\zdwp-aquasage-web\\node_modules\\vite\\bin\\vite.js --mode test",
    "node C:\\other\\project\\node_modules\\vite\\bin\\vite.js",
  ].join("\n");
  assert.match(
    matchDevCommandLine(output, "D:/workCode/知识库/zdwp-aquasage-web"),
    /vite\.js --mode test/,
  );
  assert.equal(matchDevCommandLine(output, "D:/other/project"), null);
  assert.equal(matchDevCommandLine("node something", "D:/x"), null);
});

test("skips elegant route title patching when the file is unparseable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aquasage-broken-"));
  try {
    const elegantDir = path.join(root, "src/router/elegant");
    await fs.mkdir(elegantDir, { recursive: true });
    const broken = "export const generatedRoutes = [\n  {\n    name: 'broken',\n    title: 'unterminated\n";
    const filePath = path.join(elegantDir, "routes.ts");
    await fs.writeFile(filePath, broken, "utf8");
    const [plan] = planAquaSageResources(document, {
      resource: "/api/v1/prj/pumping-station",
      title: "泵站",
    });
    const result = await patchElegantRouteTitles(root, [plan]);
    assert.equal(result.action, "skipped");
    assert.match(result.reason, /无法解析/);
    // 坏文件原样保留，没有被继续写坏
    assert.equal(await fs.readFile(filePath, "utf8"), broken);
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
