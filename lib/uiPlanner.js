const SYSTEM_FIELDS = new Set([
  "id",
  "createdAt",
  "createTime",
  "updatedAt",
  "updateTime",
  "deletedAt",
  "creatorId",
  "updaterId",
  "version",
]);
const PAGE_NAMES = new Set(["page", "current", "pageNum", "pageNumber"]);
const SIZE_NAMES = new Set(["size", "pageSize", "limit"]);
const TOTAL_NAMES = ["total", "totalElements", "count"];
const LIST_NAMES = ["records", "rows", "list", "items", "content"];
const DATA_NAMES = ["data", "result", "payload"];
const HIDDEN_SEARCH_NAMES = new Set(["order", "order_by", "sort", "sort_by"]);

/** 把契约事实转换为完全可序列化、可审计的页面计划。 */
export function buildUiPlan({ tag, moduleName, operations, schemas }) {
  const plannedOperations = operations.map((operation) => ({
    ...operation,
    role: inferRole(operation),
  }));
  const byRole = Object.fromEntries(
    ["list", "detail", "create", "update", "delete"].map((role) => [
      role,
      plannedOperations.find((item) => item.role === role) || null,
    ]),
  );

  const listInfo = analyzeResponse(byRole.list?.responseSchema, schemas);
  const detailInfo = analyzeResponse(byRole.detail?.responseSchema, schemas);
  const formSchema =
    byRole.create?.requestSchema || byRole.update?.requestSchema || null;
  const formFields = schemaFields(formSchema, schemas).filter(
    (field) => !SYSTEM_FIELDS.has(field.name),
  );
  const tableFields = schemaFields(
    listInfo.itemSchema || detailInfo.valueSchema,
    schemas,
  ).filter((field) => isTableField(field));
  const searchFields = (byRole.list?.queryParams || [])
    .filter(
      (param) =>
        !PAGE_NAMES.has(param.name) &&
        !SIZE_NAMES.has(param.name) &&
        !HIDDEN_SEARCH_NAMES.has(param.name),
    )
    .map((param) =>
      fieldPlan(param.name, param.schema, Boolean(param.required), schemas),
    );

  return {
    version: 1,
    module: { tag, name: moduleName },
    generatedAt: new Date().toISOString(),
    operations: byRole,
    listPage: {
      enabled: Boolean(byRole.list),
      searchFields,
      tableFields,
      pagination: paginationPlan(byRole.list, listInfo),
      responseDataPath: listInfo.listPath,
      totalPath: listInfo.totalPath,
      rowKey: tableFields.some((field) => field.name === "id")
        ? "id"
        : tableFields[0]?.name || null,
      actions: {
        create: Boolean(byRole.create),
        detail: Boolean(byRole.detail),
        update: Boolean(byRole.update),
        delete: Boolean(byRole.delete),
      },
    },
    formPage: {
      enabled: Boolean(byRole.create || byRole.update),
      fields: formFields,
      createFunction: byRole.create?.functionName || null,
      updateFunction: byRole.update?.functionName || null,
      detailFunction: byRole.detail?.functionName || null,
      detailDataPath: detailInfo.valuePath,
    },
    constraints: {
      apiFunctions: plannedOperations.map((item) => item.functionName),
      allowedBusinessFields: [
        ...new Set([
          ...searchFields.map((field) => field.name),
          ...tableFields.map((field) => field.name),
          ...formFields.map((field) => field.name),
        ]),
      ],
      forbiddenBehaviors: [
        "invent-api-function",
        "invent-business-field",
        "change-api-signature",
        "change-response-path",
        "write-outside-output-root",
      ],
    },
  };
}

function inferRole(operation) {
  const method = operation.method.toUpperCase();
  const text =
    `${operation.operationId || ""} ${operation.summary || ""} ${operation.path}`.toLowerCase();
  const hasId = /\{[^}]+\}/.test(operation.path);
  if (method === "DELETE" || hasAny(text, ["delete", "remove"]))
    return "delete";
  if (
    method === "GET" &&
    (hasId || hasAny(text, ["detail", "info", "findbyid", "getbyid"]))
  )
    return "detail";
  if (method === "GET") return "list";
  if (
    ["PUT", "PATCH"].includes(method) ||
    hasAny(text, ["update", "edit", "modify"])
  )
    return "update";
  if (method === "POST" && hasAny(text, ["delete", "remove"])) return "delete";
  if (method === "POST") return "create";
  return "custom";
}

function hasAny(text, words) {
  return words.some((word) => text.includes(word));
}

function analyzeResponse(schema, schemas) {
  let current = normalizeSchema(schema, schemas);
  const path = [];
  for (let depth = 0; depth < 4 && current?.type === "object"; depth++) {
    const properties = current.properties || {};
    const pagedArrayEntry = Object.entries(properties).find(([, property]) => {
      const normalized = normalizeSchema(property, schemas);
      return normalized?.type === "array";
    });
    const pageTotalKey = TOTAL_NAMES.find((name) => properties[name]);
    if (pagedArrayEntry && pageTotalKey) {
      const [recordsKey, recordsSchema] = pagedArrayEntry;
      const normalizedRecords = normalizeSchema(recordsSchema, schemas);
      return {
        listPath: [...path, recordsKey].join("."),
        totalPath: [...path, pageTotalKey].join("."),
        itemSchema: normalizeSchema(normalizedRecords?.items, schemas),
        valuePath: path.join("."),
        valueSchema: current,
      };
    }
    const dataKey = DATA_NAMES.find((name) => properties[name]);
    const listKey = LIST_NAMES.find((name) => properties[name]);
    if (listKey) {
      const listSchema = normalizeSchema(properties[listKey], schemas);
      const itemSchema = normalizeSchema(listSchema?.items, schemas);
      const totalKey = TOTAL_NAMES.find((name) => properties[name]);
      return {
        listPath: [...path, listKey].join("."),
        totalPath: totalKey ? [...path, totalKey].join(".") : null,
        itemSchema,
        valuePath: path.join("."),
        valueSchema: current,
      };
    }
    if (dataKey) {
      path.push(dataKey);
      current = normalizeSchema(properties[dataKey], schemas);
      continue;
    }
    break;
  }
  if (current?.type === "array") {
    return {
      listPath: path.join("."),
      totalPath: null,
      itemSchema: normalizeSchema(current.items, schemas),
      valuePath: path.join("."),
      valueSchema: current,
    };
  }
  return {
    listPath: path.join("."),
    totalPath: null,
    itemSchema: current,
    valuePath: path.join("."),
    valueSchema: current,
  };
}

function schemaFields(schema, schemas) {
  const normalized = normalizeSchema(schema, schemas);
  if (!normalized?.properties) return [];
  const required = new Set(normalized.required || []);
  return Object.entries(normalized.properties).map(([name, property]) =>
    fieldPlan(name, property, required.has(name), schemas),
  );
}

function fieldPlan(name, rawSchema, required, schemas) {
  const schema = normalizeSchema(rawSchema, schemas) || {};
  const type = schema.type || inferSchemaType(schema);
  const format = schema.format || null;
  const enumValues = schema.enum || null;
  return {
    name,
    label:
      schema.title || conciseDescription(schema.description) || humanize(name),
    description: schema.description || null,
    type,
    format,
    required,
    nullable: Boolean(schema.nullable) || schema.type === "null",
    enum: enumValues,
    widget: inferWidget(name, type, format, enumValues, schema),
    defaultValue: schema.default ?? defaultValue(type, enumValues),
    validation: compact({
      required,
      minLength: schema.minLength,
      maxLength: schema.maxLength,
      minimum: schema.minimum,
      maximum: schema.maximum,
      pattern: schema.pattern,
    }),
    readOnly: Boolean(schema.readOnly),
    writeOnly: Boolean(schema.writeOnly),
  };
}

function normalizeSchema(schema, schemas, seen = new Set()) {
  if (!schema) return null;
  if (schema.$ref) {
    const name = schema.$ref.split("/").pop();
    if (seen.has(name)) return { type: "object", title: name };
    return normalizeSchema(schemas[name], schemas, new Set([...seen, name]));
  }
  if (schema.allOf) {
    const parts = schema.allOf
      .map((part) => normalizeSchema(part, schemas, seen))
      .filter(Boolean);
    return {
      ...schema,
      type: "object",
      properties: Object.assign(
        {},
        ...parts.map((part) => part.properties || {}),
        schema.properties || {},
      ),
      required: [
        ...new Set(
          parts
            .flatMap((part) => part.required || [])
            .concat(schema.required || []),
        ),
      ],
      allOf: undefined,
    };
  }
  if (schema.oneOf || schema.anyOf) {
    const candidates = schema.oneOf || schema.anyOf;
    const nonNull =
      candidates.find((item) => item.type !== "null") || candidates[0];
    return {
      ...normalizeSchema(nonNull, schemas, seen),
      nullable: candidates.some((item) => item.type === "null"),
    };
  }
  return schema;
}

function paginationPlan(operation, responseInfo) {
  const params = operation?.queryParams || [];
  return {
    enabled:
      params.some(
        (item) => PAGE_NAMES.has(item.name) || SIZE_NAMES.has(item.name),
      ) || Boolean(responseInfo.totalPath),
    pageParam: params.find((item) => PAGE_NAMES.has(item.name))?.name || null,
    sizeParam: params.find((item) => SIZE_NAMES.has(item.name))?.name || null,
    totalPath: responseInfo.totalPath,
  };
}

function inferWidget(name, type, format, enumValues, schema) {
  const lower = name.toLowerCase();
  if (enumValues?.length) return "select";
  if (format === "date-time") return "datetime";
  if (format === "date") return "date";
  if (format === "email") return "email";
  if (format === "binary" || lower.includes("file")) return "upload";
  if (lower.includes("password")) return "password";
  if (type === "boolean") return "switch";
  if (["integer", "number"].includes(type)) return "number";
  if (type === "array") return "multi-value";
  if (schema.maxLength > 200 || /description|content|remark|note/.test(lower))
    return "textarea";
  return "text";
}

function isTableField(field) {
  return (
    !field.writeOnly &&
    !["password", "textarea", "upload", "multi-value"].includes(field.widget) &&
    !["object", "array"].includes(field.type)
  );
}

function inferSchemaType(schema) {
  if (schema.properties) return "object";
  if (schema.items) return "array";
  if (schema.enum)
    return typeof schema.enum[0] === "number" ? "number" : "string";
  return "unknown";
}

function defaultValue(type, enumValues) {
  if (enumValues?.length) return null;
  if (type === "boolean") return false;
  if (type === "array") return [];
  return null;
}

function humanize(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}

function conciseDescription(description) {
  if (!description) return null;
  const first = description.split(/[。.!！\n]/)[0].trim();
  return first.length <= 30 ? first : null;
}

function compact(object) {
  return Object.fromEntries(
    Object.entries(object).filter(
      ([, value]) => value !== undefined && value !== false,
    ),
  );
}
