import test from "node:test";
import assert from "node:assert/strict";
import { groupByTag } from "../lib/parser.js";
import { generateApiFile, generateTypeFile } from "../lib/generator.js";
import { analyzeContract } from "../lib/contractAnalyzer.js";
import { buildUiPlan } from "../lib/uiPlanner.js";

const document = {
  openapi: "3.0.3",
  paths: {
    "/api/v1/users": {
      get: {
        tags: ["User"],
        operationId: "listUsers",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/User" },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ["User"],
        operationId: "createUser",
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateUser" },
            },
          },
        },
        responses: {
          201: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/User" },
              },
            },
          },
        },
      },
    },
    "/api/v1/users/{id}": {
      get: {
        tags: ["User"],
        operationId: "getUserDetail",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/User" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: "object",
        required: ["id", "profile"],
        properties: {
          id: { type: "integer" },
          profile: { $ref: "#/components/schemas/Profile" },
        },
      },
      Profile: { type: "object", properties: { name: { type: "string" } } },
      CreateUser: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
      },
    },
  },
};

test("generates interpolated path, return type and correct type import", () => {
  const groups = groupByTag(document);
  const result = generateApiFile(
    "User",
    groups.User,
    document.components.schemas,
  );
  assert.match(result.code, /url: `\/api\/v1\/users\/\$\{id\}`/);
  assert.match(result.code, /Promise<User>/);
  assert.match(result.code, /from '\.\.\/types\/api'/);
});

test("includes transitive referenced schemas", () => {
  const code = generateTypeFile(document.components.schemas, new Set(["User"]));
  assert.match(code, /interface User/);
  assert.match(code, /interface Profile/);
});

test("keeps real response wrappers so generated return types are declared", () => {
  const schemas = {
    Result_PageResponse_User__: {
      type: "object",
      properties: { data: { $ref: "#/components/schemas/PageResponse_User_" } },
    },
    PageResponse_User_: {
      type: "object",
      properties: {
        data: { type: "array", items: { $ref: "#/components/schemas/User" } },
      },
    },
    User: { type: "object", properties: { id: { type: "integer" } } },
  };
  const code = generateTypeFile(
    schemas,
    new Set(["Result_PageResponse_User__"]),
  );
  assert.match(code, /interface Result_PageResponse_User__/);
  assert.match(code, /interface PageResponse_User_/);
  assert.match(code, /interface User/);
});

test("includes refs nested in nullable FastAPI wrappers", () => {
  const schemas = {
    Result_PageResponse_DrillProjectResponse__: {
      type: "object",
      properties: {
        data: {
          anyOf: [
            {
              $ref: "#/components/schemas/PageResponse_DrillProjectResponse_",
            },
            { type: "null" },
          ],
        },
      },
    },
    PageResponse_DrillProjectResponse_: {
      type: "object",
      properties: {
        records: {
          type: "array",
          items: { $ref: "#/components/schemas/DrillProjectResponse" },
        },
      },
    },
    DrillProjectResponse: {
      type: "object",
      properties: { id: { type: "integer" } },
    },
  };

  const code = generateTypeFile(
    schemas,
    new Set(["Result_PageResponse_DrillProjectResponse__"]),
  );
  assert.match(code, /interface Result_PageResponse_DrillProjectResponse__/);
  assert.match(code, /interface PageResponse_DrillProjectResponse_/);
  assert.match(code, /interface DrillProjectResponse/);
  assert.match(code, /"data"\?: PageResponse_DrillProjectResponse_ \| null/);
  assert.doesNotMatch(code, /\| unknown/);
});

test("supports a module-specific type import", () => {
  const groups = groupByTag(document);
  const result = generateApiFile(
    "User",
    groups.User,
    document.components.schemas,
    { typeImportPath: "../types/user" },
  );
  assert.match(result.code, /from '\.\.\/types\/user'/);
});

test("contract analysis provides auditable evidence", () => {
  const plan = analyzeContract(groupByTag(document));
  const detail = plan.modules[0].operations.find((x) =>
    x.path.includes("{id}"),
  );
  assert.equal(detail.inferredRole, "detail");
  assert.ok(detail.confidence >= 0.55);
  assert.ok(detail.evidence.length > 0);
});

test("builds deterministic fields, widgets, validation and response paths", () => {
  const groups = groupByTag(document);
  const generated = generateApiFile(
    "User",
    groups.User,
    document.components.schemas,
  );
  const plan = buildUiPlan({
    tag: "User",
    moduleName: generated.fileName,
    operations: generated.operations,
    schemas: document.components.schemas,
  });

  assert.equal(plan.operations.list.functionName, "fetchListUsers");
  assert.equal(plan.operations.detail.role, "detail");
  assert.equal(plan.formPage.createFunction, "fetchCreateUser");
  assert.deepEqual(
    plan.formPage.fields.map((field) => field.name),
    ["name"],
  );
  assert.equal(plan.formPage.fields[0].required, true);
  assert.equal(plan.formPage.fields[0].widget, "text");
  assert.equal(plan.listPage.responseDataPath, "");
  assert.ok(plan.constraints.allowedBusinessFields.includes("name"));
});
