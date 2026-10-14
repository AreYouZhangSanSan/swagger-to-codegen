import { getAllSchemas, groupByTag } from "../parser.js";

const ACTION_SEGMENTS = new Set([
  "page",
  "list",
  "detail",
  "info",
  "create",
  "add",
  "save",
  "update",
  "edit",
  "modify",
  "delete",
  "del",
  "remove",
  "batch-delete",
  "batch_delete",
  "upload",
  "download",
  "export",
  "import",
  "simple",
]);

const SYSTEM_QUERY_FIELDS = new Set([
  "current",
  "size",
  "page",
  "page_num",
  "page_size",
  "limit",
  "order",
  "order_by",
]);

const SYSTEM_FORM_FIELDS = new Set([
  "id",
  "created_at",
  "updated_at",
  "deleted_at",
  "createdAt",
  "updatedAt",
  "version",
]);

const DETAIL_KEYS = ["project_code", "std_code", "id", "code"];

export function planAquaSageResources(document, options = {}) {
  const schemas = getAllSchemas(document);
  const groups = groupByTag(document);
  const endpoints = Object.entries(groups).flatMap(([tag, items]) =>
    items.map((endpoint) => ({ ...endpoint, tag })),
  );
  const resources = mergeLookupGroups(groupEndpointsByResource(endpoints));
  const selected = selectResources(resources, options);

  if (selected.length === 0) {
    const available = [...resources.keys()].sort().join(", ");
    throw new Error(`未找到匹配的业务资源。可用资源: ${available || "无"}`);
  }

  return selected.map(([basePath, resourceEndpoints]) =>
    buildResourcePlan(basePath, resourceEndpoints, schemas, options),
  );
}

export function groupEndpointsByResource(endpoints) {
  const resources = new Map();
  for (const endpoint of endpoints) {
    const basePath = deriveResourceBase(endpoint.path);
    if (!resources.has(basePath)) resources.set(basePath, []);
    resources.get(basePath).push(endpoint);
  }
  return resources;
}

/**
 * 把纯查询子组合并进最近父资源。
 * 例如 /api/v1/space/district/options、/tree、/provinces 只有 GET 查询接口，
 * 且没有 /page、/list 这类分页后缀，应作为 district 资源的附加接口，
 * 而不是独立资源。只有 GET、且无分页后缀的组满足条件。
 */
export function mergeLookupGroups(resources) {
  const entries = [...resources.entries()].sort(
    ([baseA], [baseB]) =>
      baseB.split("/").filter(Boolean).length -
      baseA.split("/").filter(Boolean).length,
  );
  for (const [basePath, endpoints] of entries) {
    if (!isLookupOnly(endpoints)) continue;
    const parentBase = parentOf(basePath);
    if (!parentBase || !resources.has(parentBase)) continue;
    resources.get(parentBase).push(...endpoints);
    resources.delete(basePath);
  }
  return resources;
}

function isLookupOnly(endpoints) {
  return (
    endpoints.length > 0 &&
    endpoints.every((endpoint) => endpoint.method.toUpperCase() === "GET") &&
    endpoints.every((endpoint) => !/\/(page|list)$/i.test(endpoint.path))
  );
}

function parentOf(basePath) {
  const segments = basePath.split("/").filter(Boolean);
  return segments.length > 1 ? `/${segments.slice(0, -1).join("/")}` : null;
}

export function deriveResourceBase(urlPath) {
  const segments = String(urlPath).split("/").filter(Boolean);
  const actionIndex = segments.findIndex(
    (segment) =>
      ACTION_SEGMENTS.has(segment.toLowerCase()) || /^\{.+\}$/.test(segment),
  );
  const stableSegments =
    actionIndex === -1 ? segments : segments.slice(0, actionIndex);
  return `/${stableSegments.join("/")}`;
}

/**
 * 从资源基础路径推导后端模块段，例如：
 *   /api/v1/space/district     → space
 *   /api/v1/prj/pumping-station → prj
 *   /pumping-station           → null（无模块段，回退默认分组）
 * 规则：跳过 api 与版本段（v1、v2……）后取第一段；
 * 剩余段不足两段（模块 + 资源）时视为没有模块。
 */
export function deriveApiModule(resourceBasePath) {
  const segments = String(resourceBasePath).split("/").filter(Boolean);
  let index = 0;
  if (segments[index]?.toLowerCase() === "api") index += 1;
  if (/^v\d+$/i.test(segments[index] || "")) index += 1;
  const remaining = segments.slice(index);
  const module = remaining.length > 1 ? remaining[0] : null;
  return module && /^[a-z0-9-]+$/i.test(module) ? module : null;
}

function selectResources(resources, options) {
  if (options.resource) {
    const selector = normalizePath(options.resource);
    return [...resources.entries()].filter(([basePath]) => {
      const normalizedBase = normalizePath(basePath);
      return normalizedBase === selector || normalizedBase.endsWith(selector);
    });
  }

  if (options.slug) {
    return [...resources.entries()].filter(
      ([basePath]) => slugFromPath(basePath) === options.slug,
    );
  }

  if (options.tag) {
    return [...resources.entries()].filter(([, items]) =>
      items.some((item) => item.tag === options.tag),
    );
  }

  return [...resources.entries()];
}

function buildResourcePlan(basePath, endpoints, schemas, options) {
  const operations = {
    list: selectOperation(endpoints, "list"),
    detail: selectOperation(endpoints, "detail"),
    create: selectOperation(endpoints, "create"),
    update: selectOperation(endpoints, "update"),
    delete: selectOperation(endpoints, "delete"),
  };

  if (!operations.list) {
    throw new Error(`资源 ${basePath} 没有可识别的分页/列表接口`);
  }

  const slug = options.slug || slugFromPath(basePath);
  const namespace = toPascalCase(slug);
  const listResponse = analyzeListResponse(
    operations.list.responseSchema,
    schemas,
  );
  const title =
    options.title ||
    inferTitle(endpoints, namespace, listResponse.itemSchema);
  const detailResponse = analyzeDetailResponse(
    operations.detail?.responseSchema,
    schemas,
  );
  const createBody = requestBodyInfo(operations.create);
  const updateBody = requestBodyInfo(operations.update);
  const saveSchema = createBody.schema || updateBody.schema;

  const searchFields = (operations.list.parameters || [])
    .filter(
      (parameter) =>
        parameter.in === "query" && !SYSTEM_QUERY_FIELDS.has(parameter.name),
    )
    .map((parameter) =>
      buildField(
        parameter.name,
        parameter.schema || {},
        Boolean(parameter.required),
        schemas,
      ),
    );

  const itemFields = schemaFields(
    listResponse.itemSchema || detailResponse.schema,
    schemas,
  );
  const detailFields = schemaFields(detailResponse.schema, schemas);
  const formFields = schemaFields(saveSchema, schemas)
    .filter((field) => !SYSTEM_FORM_FIELDS.has(field.name))
    .map((field) => ({
      ...field,
      hideOnAdd: field.name === "project_code" && !field.required,
      span: field.widget === "textarea" || field.widget === "table" ? 24 : 8,
    }));

  const tableFields = chooseTableFields(itemFields);
  const rowKey = itemFields.some((field) => field.name === "id")
    ? "id"
    : itemFields[0]?.name || "id";
  const detailParam = chooseDetailParameter(operations.detail);
  const detailRefField =
    detailParam?.name ||
    DETAIL_KEYS.find((key) => itemFields.some((field) => field.name === key)) ||
    rowKey;
  const attachmentRefField = itemFields.some(
    (field) => field.name === "std_code",
  )
    ? "std_code"
    : itemFields.some((field) => field.name === "project_code")
      ? "project_code"
      : null;

  const functionBase = namespace;
  const functionNames = {
    list: operations.list ? `fetchGetPrj${functionBase}List` : null,
    detail: operations.detail ? `fetchGetPrj${functionBase}Info` : null,
    create: operations.create ? `fetchCreatePrj${functionBase}` : null,
    update: operations.update ? `fetchUpdatePrj${functionBase}` : null,
    delete: operations.delete ? `fetchDeletePrj${functionBase}` : null,
  };
  const extraOperations = buildExtraOperations(
    endpoints,
    Object.values(operations).filter(Boolean),
    schemas,
    basePath,
  );

  return {
    version: 1,
    project: "zdwp-aquasage-web",
    resource: {
      basePath,
      slug,
      namespace,
      title,
      tag: operations.list?.tag || endpoints[0]?.tag || null,
      routeBase: `/knowledge-engineering/engineering-catalog/${slug}`,
    },
    operations,
    functionNames,
    extraOperations,
    list: {
      searchFields,
      tableFields,
      itemFields,
      rowKey,
      recordsPath: listResponse.recordsPath || "data.data",
      totalPath: listResponse.totalPath || "data.total",
      pageParam:
        findParameterName(operations.list, ["current", "page", "page_num"]) ||
        "current",
      sizeParam:
        findParameterName(operations.list, ["size", "page_size", "limit"]) ||
        "size",
    },
    form: {
      fields: formFields,
      detailFields,
      detailParam: detailParam
        ? {
            name: detailParam.name,
            type: primitiveType(detailParam.schema, schemas),
          }
        : null,
      detailRefField,
      createContentType: createBody.contentType,
      updateContentType: updateBody.contentType,
    },
    attachment: {
      enabled: Boolean(options.withAttachment && attachmentRefField),
      refField: attachmentRefField,
    },
    review: buildReviewItems({
      operations,
      listResponse,
      formFields,
      detailParam,
      createBody,
      updateBody,
    }),
  };
}

function selectOperation(endpoints, role) {
  const ranked = endpoints
    .map((endpoint) => ({ endpoint, score: scoreOperation(endpoint, role) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.endpoint || null;
}

function scoreOperation(endpoint, role) {
  const method = endpoint.method.toUpperCase();
  const path = endpoint.path.toLowerCase();
  const text =
    `${endpoint.operationId || ""} ${endpoint.summary || ""} ${path}`.toLowerCase();
  const last = path.split("/").filter(Boolean).at(-1) || "";
  const queryNames = (endpoint.parameters || [])
    .filter((item) => item.in === "query")
    .map((item) => item.name);
  const hasDetailParam =
    queryNames.some((name) => DETAIL_KEYS.includes(name)) ||
    /\{[^}]+\}/.test(path);

  if (role === "list") {
    if (method !== "GET") return 0;
    let score = /\/(page|list)$/.test(path) ? 8 : 2;
    if (/page|分页|列表|list|query/.test(text)) score += 3;
    if (hasDetailParam && /detail|info|详情/.test(text)) score -= 8;
    return score;
  }
  if (role === "detail") {
    if (method !== "GET") return 0;
    let score = /\/(detail|info)$/.test(path) ? 8 : 0;
    if (/detail|详情|get.*info|信息/.test(text)) score += 3;
    if (hasDetailParam) score += 4;
    if (/\/(page|list)$/.test(path)) score -= 8;
    return score;
  }
  if (role === "create") {
    if (method !== "POST") return 0;
    let score = /\/(create|add|save)$/.test(path)
      ? 8
      : last === deriveResourceBase(path).split("/").at(-1)
        ? 4
        : 1;
    if (/create|新增|创建|add/.test(text)) score += 4;
    if (/update|delete|del|remove|修改|删除/.test(text)) score -= 10;
    return score;
  }
  if (role === "update") {
    if (!["POST", "PUT", "PATCH"].includes(method)) return 0;
    let score = /\/(update|edit|modify)$/.test(path)
      ? 8
      : ["PUT", "PATCH"].includes(method)
        ? 5
        : 0;
    if (/update|edit|modify|更新|修改/.test(text)) score += 4;
    return score;
  }
  if (role === "delete") {
    if (!["POST", "DELETE"].includes(method)) return 0;
    let score =
      /\/(delete|del|remove)$/.test(path) || method === "DELETE" ? 8 : 0;
    if (/delete|remove|删除|批量删除|_del_/.test(text)) score += 4;
    return score;
  }
  return 0;
}

/**
 * 收集资源基础路径下未被 CRUD 五角色选中的其余接口，
 * 让 service、类型和字段配置覆盖 Swagger 中该资源的全部相关接口。
 */
function buildExtraOperations(endpoints, selectedEndpoints, schemas, basePath) {
  const selected = new Set(selectedEndpoints);
  return endpoints
    .filter((endpoint) => !selected.has(endpoint))
    .sort((a, b) => String(a.path).localeCompare(String(b.path)))
    .map((endpoint) => buildExtraOperation(endpoint, schemas, basePath));
}

function buildExtraOperation(endpoint, schemas, basePath) {
  // 动作名取资源基础路径之后的剩余路径段，例如
  // /api/v1/space/district/options → Options、/simple/qsc/list → SimpleQscList
  const baseSegments = String(basePath).split("/").filter(Boolean);
  const actionSegments = String(endpoint.path)
    .split("/")
    .filter(Boolean)
    .slice(baseSegments.length)
    .filter((segment) => !/^\{.+\}$/.test(segment));
  const action = actionSegments.length
    ? toPascalCase(actionSegments.join("-"))
    : fallbackExtraAction(endpoint);
  const parameters = endpoint.parameters || [];
  const queryFields = parameters
    .filter(
      (parameter) =>
        parameter.in === "query" && !SYSTEM_QUERY_FIELDS.has(parameter.name),
    )
    .map((parameter) =>
      buildField(
        parameter.name,
        parameter.schema || {},
        Boolean(parameter.required),
        schemas,
      ),
    );
  const pathFields = parameters
    .filter((parameter) => parameter.in === "path")
    .map((parameter) =>
      buildField(parameter.name, parameter.schema || {}, true, schemas),
    );
  const body = requestBodyInfo(endpoint);
  const bodyFields = body.schema
    ? schemaFields(body.schema, schemas).filter(
        (field) => !SYSTEM_FORM_FIELDS.has(field.name),
      )
    : [];
  return {
    action,
    method: endpoint.method.toUpperCase(),
    path: endpoint.path,
    operationId: endpoint.operationId || null,
    summary: endpoint.summary || null,
    parameters,
    queryFields,
    pathFields,
    bodyFields,
    bodyContentType: body.contentType,
    response: analyzeExtraResponse(endpoint.responseSchema, schemas),
  };
}

function fallbackExtraAction(endpoint) {
  const head = String(endpoint.operationId || "").split("_endpoint_")[0].trim();
  if (head) return toPascalCase(head);
  return endpoint.method.charAt(0).toUpperCase() + endpoint.method.slice(1);
}

function analyzeExtraResponse(schema, schemas) {
  let current = normalizeSchema(schema, schemas);
  for (let depth = 0; depth < 8 && current; depth += 1) {
    if (current.type === "array") {
      const itemSchema = normalizeSchema(current.items, schemas);
      return {
        isArray: true,
        itemSchema,
        itemFields: itemSchema?.properties
          ? schemaFields(itemSchema, schemas)
          : [],
      };
    }
    const properties = current.properties || {};
    const dataKey = ["data", "result", "payload"].find(
      (key) => properties[key],
    );
    if (!dataKey) {
      return {
        isArray: false,
        itemSchema: current,
        itemFields: current?.properties ? schemaFields(current, schemas) : [],
      };
    }
    current = normalizeSchema(properties[dataKey], schemas);
  }
  return { isArray: false, itemSchema: null, itemFields: [] };
}

function requestBodyInfo(operation) {
  if (!operation?.requestBody?.content)
    return { schema: null, contentType: null };
  const content = operation.requestBody.content;
  const contentType = content["application/json"]
    ? "application/json"
    : content["multipart/form-data"]
      ? "multipart/form-data"
      : Object.keys(content)[0] || null;
  return {
    schema: contentType ? content[contentType]?.schema || null : null,
    contentType,
  };
}

function analyzeListResponse(schema, schemas) {
  let current = normalizeSchema(schema, schemas);
  const path = [];
  for (let depth = 0; depth < 8 && current; depth += 1) {
    if (current.type === "array") {
      return {
        recordsPath: path.join("."),
        totalPath: null,
        itemSchema: normalizeSchema(current.items, schemas),
      };
    }
    const properties = current.properties || {};
    const arrayEntry = Object.entries(properties).find(
      ([, property]) => normalizeSchema(property, schemas)?.type === "array",
    );
    if (
      arrayEntry &&
      (properties.total || properties.total_count || properties.count)
    ) {
      const [recordsKey, recordsSchema] = arrayEntry;
      const totalKey = properties.total
        ? "total"
        : properties.total_count
          ? "total_count"
          : "count";
      return {
        recordsPath: [...path, recordsKey].join("."),
        totalPath: [...path, totalKey].join("."),
        itemSchema: normalizeSchema(
          normalizeSchema(recordsSchema, schemas)?.items,
          schemas,
        ),
      };
    }
    const dataKey = ["data", "result", "payload"].find(
      (key) => properties[key],
    );
    if (!dataKey) break;
    path.push(dataKey);
    current = normalizeSchema(properties[dataKey], schemas);
  }
  return { recordsPath: path.join("."), totalPath: null, itemSchema: current };
}

function analyzeDetailResponse(schema, schemas) {
  let current = normalizeSchema(schema, schemas);
  const path = [];
  for (let depth = 0; depth < 5 && current?.properties; depth += 1) {
    const dataKey = ["data", "result", "payload"].find(
      (key) => current.properties[key],
    );
    if (!dataKey) break;
    path.push(dataKey);
    current = normalizeSchema(current.properties[dataKey], schemas);
  }
  return { path: path.join("."), schema: current };
}

export function normalizeSchema(schema, schemas, seen = new Set()) {
  if (!schema || typeof schema !== "object") return null;
  if (schema.$ref) {
    const name = schema.$ref.split("/").pop();
    if (seen.has(name)) return { type: "object", title: name, properties: {} };
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
    const resolved = normalizeSchema(nonNull, schemas, seen) || {};
    // 字段级 description/title 往往挂在 anyOf/oneOf 外层（如
    // anyOf: [{type: string}, {type: null}] + description: "调查时间"），
    // 解包时要保留，否则字段中文名会丢失
    return {
      ...resolved,
      title: schema.title || resolved.title,
      description: schema.description || resolved.description,
      nullable:
        candidates.some((item) => item.type === "null") || schema.nullable,
    };
  }
  return schema;
}

function schemaFields(schema, schemas, depth = 2) {
  const normalized = normalizeSchema(schema, schemas);
  if (!normalized?.properties) return [];
  const required = new Set(normalized.required || []);
  return Object.entries(normalized.properties).map(([name, property]) =>
    buildField(name, property, required.has(name), schemas, depth),
  );
}

function buildField(name, rawSchema, required, schemas, depth = 2) {
  const schema = normalizeSchema(rawSchema, schemas) || {};
  const type = schema.type || inferSchemaType(schema);
  const format = schema.format || null;
  const enumValues = schema.enum || null;
  return {
    name,
    label: fieldLabel(name, schema),
    description: schema.description || null,
    type,
    format,
    required,
    nullable: Boolean(schema.nullable),
    enum: enumValues,
    widget: inferWidget(name, type, format, enumValues, schema),
    defaultValue: schema.default ?? defaultValue(type),
    validation: compact({
      required,
      minLength: schema.minLength,
      maxLength: schema.maxLength,
      minimum: schema.minimum,
      maximum: schema.maximum,
      pattern: schema.pattern,
    }),
    // depth 限制防止自引用 Schema（如树形 children）无限展开
    itemFields:
      type === "array" && depth > 0
        ? schemaFields(schema.items, schemas, depth - 1)
        : [],
  };
}

function chooseTableFields(fields) {
  const scalar = fields.filter(
    (field) =>
      !SYSTEM_FORM_FIELDS.has(field.name) &&
      !["object", "array"].includes(field.type),
  );
  const preferred = [
    "project_code",
    "std_code",
    "name",
    "city_code",
    "city",
    "area_name",
    "town",
    "scale",
    "type_name",
  ];
  return [...scalar]
    .sort((a, b) => {
      const ai = preferred.indexOf(a.name);
      const bi = preferred.indexOf(b.name);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    })
    .slice(0, 8);
}

function chooseDetailParameter(operation) {
  if (!operation) return null;
  const parameters = operation.parameters || [];
  return (
    DETAIL_KEYS.map((name) =>
      parameters.find((parameter) => parameter.name === name),
    ).find(Boolean) ||
    parameters.find(
      (parameter) => parameter.in === "path" || parameter.in === "query",
    ) ||
    null
  );
}

function findParameterName(operation, names) {
  return (
    (operation?.parameters || []).find((parameter) =>
      names.includes(parameter.name),
    )?.name || null
  );
}

function inferWidget(name, type, format, enumValues, schema) {
  if (name === "city_code" || name === "area_code") return "tree";
  if (enumValues?.length) return "select";
  if (format === "binary") return "upload";
  if (format === "date-time") return "datetime";
  if (format === "date") return "date";
  if (type === "boolean") return "switch";
  if (type === "integer" || type === "number") return "number";
  if (
    type === "array" &&
    (schema.items?.type === "object" ||
      schema.items?.properties ||
      schema.items?.$ref)
  )
    return "table";
  if (type === "array") return "input";
  if (
    schema.maxLength > 200 ||
    /description|content|remark|note|说明|备注/.test(name)
  )
    return "textarea";
  return "input";
}

function fieldLabel(name, schema) {
  const description = String(schema.description || "").trim();
  const chinese = description
    .match(/[\u3400-\u9fff][\u3400-\u9fffA-Za-z0-9/（）()·ⅠⅡⅢⅣⅤ\s-]*/)?.[0]
    ?.trim();
  if (chinese) return chinese.split(/\s*[-→：:]\s*/)[0].trim();
  if (schema.title && /[\u3400-\u9fff]/.test(schema.title)) return schema.title;
  return humanize(name);
}

function primitiveType(schema, schemas) {
  const type = normalizeSchema(schema, schemas)?.type;
  if (type === "integer" || type === "number") return "number";
  if (type === "boolean") return "boolean";
  return "string";
}

function inferSchemaType(schema) {
  if (schema.properties) return "object";
  if (schema.items) return "array";
  if (schema.enum)
    return typeof schema.enum[0] === "number" ? "number" : "string";
  return "unknown";
}

function defaultValue(type) {
  if (type === "boolean") return false;
  if (type === "array") return [];
  return null;
}

const TITLE_STRIP_WORDS = [
  "分页查询",
  "根据入参",
  "根据id",
  "批量",
  "简易",
  "下拉",
  "响应",
  "模型",
  "查询",
  "获取",
  "新增",
  "创建",
  "修改",
  "更新",
  "删除",
  "详情",
  "信息",
  "列表",
  "数据",
  "记录",
  "接口",
  "节点",
];

/**
 * 从列表项 Schema 的中文描述/标题推断业务中文名，摘要兜底。
 * 例如：Schema 描述 "鱼类调查信息" → "鱼类调查"；摘要 "根据入参分页查询河流信息" → "河流"。
 */
function inferTitle(endpoints, fallback, itemSchema) {
  const fromSchema =
    cleanBusinessName(itemSchema?.description) ||
    cleanBusinessName(itemSchema?.title);
  if (fromSchema) return fromSchema;
  for (const endpoint of endpoints) {
    const fromSummary = cleanBusinessName(endpoint.summary);
    if (fromSummary) return fromSummary;
  }
  return fallback;
}

function cleanBusinessName(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(
    /[\u3400-\u9fff][\u3400-\u9fff0-9（）()·ⅠⅡⅢⅣⅤ\s-]*/
  );
  if (!match) return "";
  let name = match[0].trim();
  for (const word of TITLE_STRIP_WORDS) {
    name = name.split(word).join("");
  }
  name = name.replace(/[（）()·\s-]/g, "").trim();
  if (name.length < 2 || name.length > 12) return "";
  if (/^(查询|获取|新增|创建|修改|更新|删除|分页|入参|根据|id)$/.test(name))
    return "";
  return name;
}

function buildReviewItems({
  operations,
  listResponse,
  formFields,
  detailParam,
  createBody,
  updateBody,
}) {
  const review = [];
  for (const role of ["detail", "create", "update", "delete"]) {
    if (!operations[role])
      review.push(`缺少 ${role} 接口，相关页面功能将被省略`);
  }
  if (!listResponse.totalPath)
    review.push("未从响应契约识别到 total 路径，使用 AquaSage 默认 data.total");
  if (operations.detail && !detailParam)
    review.push("详情接口没有可识别的 id/project_code/std_code 参数");
  if ((operations.create || operations.update) && formFields.length === 0)
    review.push("保存接口没有可识别的表单字段");
  if (
    [createBody.contentType, updateBody.contentType].some(
      (type) => type && type !== "application/json",
    )
  ) {
    review.push(
      "保存接口不是 application/json，需要人工确认 EngineeringForm 是否适用",
    );
  }
  return review;
}

function normalizePath(value) {
  return `/${String(value).split("/").filter(Boolean).join("/")}`.toLowerCase();
}

function slugFromPath(value) {
  return (
    String(value).split("/").filter(Boolean).at(-1)?.toLowerCase() || "resource"
  );
}

export function toPascalCase(value) {
  return (
    String(value)
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("") || "Resource"
  );
}

function humanize(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function compact(object) {
  return Object.fromEntries(
    Object.entries(object).filter(
      ([, value]) => value !== undefined && value !== false,
    ),
  );
}
