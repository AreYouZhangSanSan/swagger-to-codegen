import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { deriveApiModule, planAquaSageResources } from "../lib/aquasage/planner.js";
import {
  renderAquaSageApiFiles,
  renderAquaSageFiles,
  renderAquaSagePageFiles,
} from "../lib/aquasage/renderer.js";
import { generateAquaSageProject } from "../lib/aquasage/projectGenerator.js";
import { configureAquaSagePlans } from "../lib/aquasage/placementResolver.js";
import {
  deriveResourceOutputDir,
  ensureProjectApiFiles,
  loadAquaSagePlans,
  saveAquaSagePlans,
} from "../lib/aquasage/planStore.js";

const document = {
  openapi: "3.1.0",
  paths: {
    "/api/v1/prj/pumping-station/page": {
      get: {
        tags: ["水利工程"],
        operationId: "list_pumping_station",
        summary: "分页查询泵站信息",
        parameters: [
          { name: "current", in: "query", schema: { type: "integer" } },
          { name: "size", in: "query", schema: { type: "integer" } },
          { name: "order", in: "query", schema: { type: "string" } },
          { name: "order_by", in: "query", schema: { type: "string" } },
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
                schema: { $ref: "#/components/schemas/ResultPrjPumpingStation" },
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
                schema: { $ref: "#/components/schemas/ResultPrjPumpingStation" },
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
                schema: { $ref: "#/components/schemas/ResultPrjPumpingStation" },
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
        properties: { data: { $ref: "#/components/schemas/PrjPumpingStation" } },
      },
      PrjPumpingStation: {
        type: "object",
        required: ["id", "project_code", "name"],
        properties: {
          id: { type: "integer" },
          project_code: { type: "string", description: "工程代码" },
          name: { type: "string", description: "泵站名称" },
        },
      },
    },
  },
};

function buildPlans(options = {}) {
  return planAquaSageResources(document, {
    resource: "/api/v1/prj/pumping-station",
    title: "泵站",
    ...options,
  });
}

async function makeProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aquasage-stage-"));
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
  return root;
}

test("splits rendering into api and page files without overlap", () => {
  const [plan] = buildPlans();
  const apiFiles = renderAquaSageApiFiles(plan);
  const pageFiles = renderAquaSagePageFiles(plan);
  const allFiles = renderAquaSageFiles(plan);

  assert.deepEqual(Object.keys(apiFiles).sort(), [
    "src/service/api/prj/pumping-station.ts",
    "src/typings/api/prj/pumpingStation.d.ts",
  ]);
  assert.deepEqual(Object.keys(pageFiles).sort(), [
    "src/config/prj/pumping-station-fields.ts",
    "src/views/knowledge-engineering/prj/pumping-station/detail/index.vue",
    "src/views/knowledge-engineering/prj/pumping-station/list/index.vue",
  ]);
  assert.deepEqual(
    Object.keys(allFiles).sort(),
    [...Object.keys(apiFiles), ...Object.keys(pageFiles)].sort(),
  );
});

test("derives the API module segment from the resource base path", () => {
  assert.equal(deriveApiModule("/api/v1/space/district"), "space");
  assert.equal(deriveApiModule("/api/v1/prj/pumping-station"), "prj");
  assert.equal(deriveApiModule("/api/v2/hyo/river"), "hyo");
  assert.equal(deriveApiModule("/pumping-station"), null);
  assert.equal(deriveApiModule("/api/pumping-station"), null);
  assert.equal(deriveApiModule(""), null);
});

test("derives standalone output directory from the resource base path", () => {
  assert.equal(
    deriveResourceOutputDir("/api/v1/prj/pumping-station"),
    path.join("api", "v1", "prj", "pumping-station"),
  );
  assert.equal(deriveResourceOutputDir("//api/v1/..//x/"), path.join("api", "v1", "x"));
  assert.equal(deriveResourceOutputDir("/", "fallback-slug"), "fallback-slug");
});

test("plan store round-trips standalone plans through a --from directory", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "aquasage-plans-"));
  try {
    // 与 aquasage-api 独立模式相同：先解析 placement 再保存计划
    const plans = await configureAquaSagePlans(dir, buildPlans(), {});
    const planDirectory = await saveAquaSagePlans(dir, plans, {
      scope: "standalone",
    });
    assert.equal(planDirectory, path.join(dir, ".codegen", "plans"));
    const loaded = await loadAquaSagePlans([dir]);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].resource.slug, "pumping-station");
    assert.equal(loaded[0].version, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("stage api writes only service and types, never pages or routes", async () => {
  const root = await makeProject();
  try {
    const plans = await configureAquaSagePlans(root, buildPlans(), {});
    const result = await generateAquaSageProject({
      projectRoot: root,
      plans,
      contractSource: "fixture",
      check: false,
      routeGeneration: false,
      stage: "api",
    });
    assert.equal(result.stage, "api");
    assert.ok(
      result.files.every((file) => file.action === "created"),
    );
    assert.equal(result.files.length, 2);
    assert.deepEqual(
      result.files.map((file) => file.path).sort(),
      [
        "src/service/api/prj/pumping-station.ts",
        "src/typings/api/prj/pumpingStation.d.ts",
      ].sort(),
    );
    await assert.rejects(
      fs.access(
        path.join(
          root,
          "src/views/knowledge-engineering/prj/pumping-station/list/index.vue",
        ),
      ),
    );
    await assert.rejects(
      fs.access(path.join(root, "src/config/prj/pumping-station-fields.ts")),
    );
    await assert.rejects(fs.access(path.join(root, "src/router")));
    assert.deepEqual(result.routes, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("stage pages renders config and pages from the saved plans", async () => {
  const root = await makeProject();
  try {
    const plans = await configureAquaSagePlans(root, buildPlans(), {});
    await generateAquaSageProject({
      projectRoot: root,
      plans,
      contractSource: "fixture",
      patchRoutes: false,
      routeGeneration: false,
      check: false,
      stage: "api",
    });
    const loaded = await loadAquaSagePlans([
      path.join(root, ".codegen", "aquasage", "plans"),
    ]);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].placement.serviceGroup, "prj");

    const result = await generateAquaSageProject({
      projectRoot: root,
      plans: loaded,
      contractSource: "aquasage-plans",
      patchRoutes: false,
      routeGeneration: false,
      check: false,
      stage: "pages",
    });
    assert.equal(result.stage, "pages");
    assert.ok(result.files.every((file) => file.action === "created"));
    assert.deepEqual(
      result.files.map((file) => file.path).sort(),
      [
        "src/config/prj/pumping-station-fields.ts",
        "src/views/knowledge-engineering/prj/pumping-station/detail/index.vue",
        "src/views/knowledge-engineering/prj/pumping-station/list/index.vue",
      ].sort(),
    );
    const listCode = await fs.readFile(
      path.join(
        root,
        "src/views/knowledge-engineering/prj/pumping-station/list/index.vue",
      ),
      "utf8",
    );
    assert.match(listCode, /@\/service\/api\/prj\/pumping-station/);
    assert.match(listCode, /@\/config\/prj\/pumping-station-fields/);

    const second = await generateAquaSageProject({
      projectRoot: root,
      plans: loaded,
      contractSource: "aquasage-plans",
      patchRoutes: false,
      routeGeneration: false,
      check: false,
      stage: "pages",
    });
    assert.ok(second.files.every((file) => file.action === "unchanged"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("view-dir overrides the page directory while the menu route stays unchanged", async () => {
  const root = await makeProject();
  try {
    const [plan] = await configureAquaSagePlans(root, buildPlans(), {
      viewDir: "src/views/custom/pumps",
    });
    assert.equal(plan.placement.viewBase, "src/views/custom/pumps");
    assert.equal(
      plan.resource.routeBase,
      "/knowledge-engineering/prj/pumping-station",
    );
    const files = renderAquaSagePageFiles(plan);
    assert.ok(files["src/views/custom/pumps/list/index.vue"]);
    assert.ok(files["src/views/custom/pumps/detail/index.vue"]);
    assert.match(
      files["src/views/custom/pumps/list/index.vue"],
      /\/knowledge-engineering\/prj\/pumping-station\/detail/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("view-dir accepts an absolute path inside the project and rejects outside paths", async () => {
  const root = await makeProject();
  try {
    const [plan] = await configureAquaSagePlans(root, buildPlans(), {
      viewDir: path.join(root, "src", "views", "custom"),
    });
    assert.equal(plan.placement.viewBase, "src/views/custom");
    await assert.rejects(
      configureAquaSagePlans(root, buildPlans(), {
        viewDir: path.join(os.tmpdir(), "outside"),
      }),
      /--view-dir 必须在目标项目内/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("ensureProjectApiFiles copies standalone stage-1 files idempotently", async () => {
  const root = await makeProject();
  const source = await fs.mkdtemp(path.join(os.tmpdir(), "aquasage-source-"));
  try {
    const [plan] = buildPlans();
    const servicePath = path.join(source, "pumping-station.ts");
    const typesPath = path.join(source, "pumpingStation.d.ts");
    await fs.writeFile(servicePath, "// standalone service\n", "utf8");
    await fs.writeFile(typesPath, "// standalone types\n", "utf8");
    const standalonePlan = {
      ...plan,
      placement: {
        serviceFile: "src/service/api/engineering-catalog/pumping-station.ts",
        typeFile: "src/typings/api/engineering-catalog/pumpingStation.d.ts",
      },
      stage1: { servicePath, typesPath },
    };

    const first = await ensureProjectApiFiles(root, [standalonePlan]);
    assert.deepEqual(
      first.copied.map((file) => file.action),
      ["created", "created"],
    );
    assert.equal(
      await fs.readFile(
        path.join(
          root,
          "src/service/api/engineering-catalog/pumping-station.ts",
        ),
        "utf8",
      ),
      "// standalone service\n",
    );

    const second = await ensureProjectApiFiles(root, [standalonePlan]);
    assert.equal(second.copied.length, 0);
    assert.equal(second.planned.length, 0);

    const dryRun = await ensureProjectApiFiles(
      root,
      [{ ...standalonePlan, stage1: null }],
      { dryRun: true },
    );
    assert.equal(dryRun.copied.length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(source, { recursive: true, force: true });
  }
});

test("loadAquaSagePlans reports a friendly error when the default plans directory is absent", async () => {
  const empty = await fs.mkdtemp(path.join(os.tmpdir(), "aquasage-empty-"));
  try {
    await assert.rejects(
      loadAquaSagePlans([path.join(empty, ".codegen", "aquasage", "plans")]),
      /未找到 AquaSage 计划文件/,
    );
  } finally {
    await fs.rm(empty, { recursive: true, force: true });
  }
});

test("ensureProjectApiFiles rejects missing files without a stage-1 source", async () => {
  const root = await makeProject();
  try {
    const [plan] = buildPlans();
    await assert.rejects(
      ensureProjectApiFiles(root, [
        {
          ...plan,
          placement: {
            serviceFile: "src/service/api/engineering-catalog/pumping-station.ts",
            typeFile: "src/typings/api/engineering-catalog/pumpingStation.d.ts",
          },
        },
      ]),
      /先运行 aquasage-api -p/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
