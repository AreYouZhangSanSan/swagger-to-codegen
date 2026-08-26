// lib/generator.js
/**
 * 将 Swagger Schema 转为 TypeScript 类型字符串
 */
export function swaggerTypeToTS(schema, schemas = {}, collectFn = null) {
  if (!schema) return "unknown";
  if (schema.oneOf || schema.anyOf) {
    const variants = schema.oneOf || schema.anyOf;
    const types = variants.map((item) =>
      swaggerTypeToTS(item, schemas, collectFn),
    );
    return [...new Set(types)].join(" | ");
  }
  if (schema.allOf) {
    return schema.allOf
      .map((item) => swaggerTypeToTS(item, schemas, collectFn))
      .join(" & ");
  }
  if (schema.$ref) {
    const typeName = schema.$ref.split("/").pop();
    if (collectFn && !isExcludedType(typeName)) collectFn(typeName);
    return typeName;
  }
  switch (schema.type) {
    case "integer":
    case "number":
      return schema.nullable ? "number | null" : "number";
    case "string":
      if (schema.enum) {
        const enumType = schema.enum.map((v) => JSON.stringify(v)).join(" | ");
        return schema.nullable ? `${enumType} | null` : enumType;
      }
      return schema.nullable ? "string | null" : "string";
    case "boolean":
      return schema.nullable ? "boolean | null" : "boolean";
    case "null":
      return "null";
    case "array":
      if (schema.items) {
        const arrayType = `${swaggerTypeToTS(schema.items, schemas, collectFn)}[]`;
        return schema.nullable ? `${arrayType} | null` : arrayType;
      }
      return "unknown[]";
    case "object":
      if (schema.properties) {
        const required = new Set(schema.required || []);
        const props = Object.entries(schema.properties)
          .map(
            ([key, prop]) =>
              `${JSON.stringify(key)}${required.has(key) ? "" : "?"}: ${swaggerTypeToTS(prop, schemas, collectFn)}`,
          )
          .join("; ");
        return `{ ${props} }`;
      }
      if (schema.additionalProperties) {
        return `Record<string, ${swaggerTypeToTS(schema.additionalProperties, schemas, collectFn)}>`;
      }
      return "Record<string, unknown>";
    default:
      return "unknown";
  }
}

/**
 * 根据接口路径前缀生成文件名
 * 例如 /api/v1/doc/xxx → doc
 *       /api/v1/corp-rule/xxx → corp-rule
 */
export function deriveFileNameFromPaths(endpoints) {
  if (!endpoints || endpoints.length === 0) return "api";

  // 提取所有路径
  const paths = endpoints.map((ep) => ep.path);

  // 找到最短路径长度
  const minLen = Math.min(...paths.map((p) => p.length));

  // 从短路径中提取公共前缀（去掉末尾的 /xxx/:id 部分）
  let prefix = "";
  for (let i = 0; i < minLen; i++) {
    const char = paths[0][i];
    if (paths.every((p) => p[i] === char)) {
      prefix += char;
    } else {
      break;
    }
  }

  // 去掉末尾的 / 分隔符
  prefix = prefix.replace(/\/+$/, "");

  // 从前缀末尾提取最后一个有意义的词段
  // 例如 /api/v1/doc → doc
  //     /api/v1/corp-rule → corp-rule
  //     / → api
  const segments = prefix.split("/").filter(Boolean);
  const fileName = segments.length > 0 ? segments[segments.length - 1] : "api";

  // 特殊路径片段转换
  const pathSegmentMap = {
    v1: "api",
    v2: "api",
    v3: "api",
    openapi: "api",
    doc: "doc",
    docs: "doc",
  };

  return pathSegmentMap[fileName] || fileName;
}

/**
 * 生成 API 文件内容
 * @returns { code, fileName }
 */
export function generateApiFile(tag, endpoints, schemas = {}, options = {}) {
  // 收集所有用到的 $ref 类型名
  const usedTypes = new Set();

  // 先遍历一遍收集类型
  for (const ep of endpoints) {
    const { requestBody, responseSchema } = ep;
    if (requestBody?.content?.["application/json"]?.schema) {
      swaggerTypeToTS(
        requestBody.content["application/json"].schema,
        schemas,
        (t) => usedTypes.add(t),
      );
    }
    swaggerTypeToTS(responseSchema, schemas, (t) => usedTypes.add(t));
  }

  // 从路径前缀推导文件名
  const fileName = deriveFileNameFromPaths(endpoints);
  const typeImportPath = options.typeImportPath || "../types/api";

  // 跟踪已使用的函数名，用于去重
  const usedFuncNames = new Set();
  const operations = [];

  const lines = [
    `// Auto-generated API module: ${tag}`,
    `import { request } from '../../request';`,
    usedTypes.size > 0
      ? `import type { ${[...usedTypes].sort().join(", ")} } from '${typeImportPath}';`
      : "",
    "",
  ];

  for (const ep of endpoints) {
    const {
      method,
      path,
      summary,
      parameters,
      requestBody,
      responseSchema,
      operationId,
    } = ep;

    // 函数名，加 fetch 前缀
    let baseName = simplifyFuncName(operationId, path, method);
    let funcName = `fetch${capitalize(baseName)}`;

    // 如果函数名重复，拼接 URL 最后一段区分
    if (usedFuncNames.has(funcName)) {
      const urlLastSegment = path
        .split("/")
        .pop()
        .replace(/[^a-zA-Z0-9]/g, "_");
      baseName = `${baseName}_${urlLastSegment}`;
      funcName = `fetch${capitalize(baseName)}`;
    }
    usedFuncNames.add(funcName);

    // 路径参数（:id）处理
    const pathParams = parameters.filter((p) => p.in === "path");
    const queryParams = parameters.filter((p) => p.in === "query");

    // 构建函数参数列表
    const args = [];
    // 路径参数
    for (const p of pathParams) {
      args.push(`${p.name}: number | string`);
    }
    // 查询参数对象（内联到函数签名）
    if (queryParams.length > 0) {
      const paramsType = queryParams
        .map(
          (p) =>
            `${p.name}${p.required ? "" : "?"}: ${swaggerTypeToTS(p.schema)}`,
        )
        .join("; ");
      args.push(`params: { ${paramsType} }`);
    }
    // 请求体参数
    if (requestBody?.content?.["application/json"]?.schema) {
      const bodyType = swaggerTypeToTS(
        requestBody.content["application/json"].schema,
        schemas,
        (t) => usedTypes.add(t),
      );
      args.push(`data: ${bodyType}`);
    }

    // URL 字符串（路径参数替换为模板字符串）
    const urlPath = (path.startsWith("/") ? path : `/${path}`).replace(
      /\{(\w+)\}/g,
      "${$1}",
    );
    const hasPathParams = /\$\{\w+\}/.test(urlPath);

    // 响应类型
    const returnType = swaggerTypeToTS(responseSchema, schemas, (t) =>
      usedTypes.add(t),
    );
    operations.push({
      roleHint: null,
      functionName: funcName,
      method,
      path,
      pathParams: pathParams.map((p) => ({
        name: p.name,
        required: p.required !== false,
        schema: p.schema || {},
      })),
      queryParams: queryParams.map((p) => ({
        name: p.name,
        required: Boolean(p.required),
        schema: p.schema || {},
      })),
      requestSchema: requestBody?.content?.["application/json"]?.schema || null,
      responseSchema,
      summary,
      operationId: operationId || null,
      returnType,
    });

    // 生成 JSDoc 注释
    lines.push(`/**`);
    lines.push(` * ${summary}`);
    if (queryParams.length > 0) {
      lines.push(` *`);
      lines.push(` * @param params - 查询参数`);
    }
    lines.push(` */`);

    // 生成函数体
    lines.push(
      `export function ${funcName}(${args.join(", ")}): Promise<${returnType}> {`,
    );

    // 构建 request 调用
    let requestArgs = `{ url: ${hasPathParams ? "`" + urlPath + "`" : "'" + urlPath + "'"}, method: '${method.toLowerCase()}'`;
    if (queryParams.length > 0) {
      requestArgs += `, params`;
    }
    if (requestBody?.content?.["application/json"]?.schema) {
      requestArgs += `, data`;
    }
    requestArgs += ` }`;

    lines.push(`  return request(${requestArgs});`);
    lines.push("}");
    lines.push("");
  }

  return { code: lines.join("\n"), fileName, usedTypes, operations };
}

/**
 * 递归收集 $ref 类型名
 */
function collectUsedTypes(schema, usedTypes) {
  if (!schema) return;
  if (schema.$ref) {
    usedTypes.add(schema.$ref.split("/").pop());
  }
  for (const compositionKey of ["oneOf", "anyOf", "allOf"]) {
    for (const item of schema[compositionKey] || []) {
      collectUsedTypes(item, usedTypes);
    }
  }
  if (schema.items) {
    collectUsedTypes(schema.items, usedTypes);
  }
  if (
    schema.additionalProperties &&
    typeof schema.additionalProperties === "object"
  ) {
    collectUsedTypes(schema.additionalProperties, usedTypes);
  }
  if (schema.properties) {
    for (const prop of Object.values(schema.properties)) {
      collectUsedTypes(prop, usedTypes);
    }
  }
}

/**
 * 首字母大写
 */
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * 简化函数名，去掉冗余的后缀
 * 例如 fetchList_cultural_relics_api_v1_relic_cultural_relics_page_get → fetchList_cultural_relics
 *     fetchGet_cultural_relics_detail_api_v1_relic_cultural_relics_detail_get → fetchGet_cultural_relics_detail
 */
function simplifyFuncName(operationId, path, method) {
  if (operationId) {
    // 如果 operationId 过长，尝试简化
    return simplifyOperationId(operationId);
  }

  // 从路径提取关键部分
  // 例如 /api/v1/relic/cultural-relics/page → cultural-relics
  //     /api/v1/relic/cultural-relics/detail → cultural-relics-detail
  const segments = path.split("/").filter(Boolean);

  // 去掉前缀（通常是 api, v1, 模块名）
  // 保留最后 2-3 个有意义的段
  let meaningfulSegments = segments.filter(
    (s) => !/^(api|v[0-9]+|v[0-9])$/i.test(s),
  );

  // 如果最后一段是 {xxx} 或 xxxId，去掉
  meaningfulSegments = meaningfulSegments.filter(
    (s) => !/^\{.+\}$/.test(s) && !/Id$/.test(s),
  );

  if (meaningfulSegments.length === 0) {
    return `${method.toLowerCase()}Unknown`;
  }

  // 提取最后 2 个段
  const lastSegments = meaningfulSegments.slice(-2);

  // 组合：方法 + 名称
  // 例如 get + cultural-relics-detail → getCultural-relics-detail
  //     list + cultural-relics → listCultural-relics
  let name = lastSegments.join("-");

  // 去掉 HTTP 方法前缀（如果有）
  const methodPrefix = `${method.toLowerCase()}_`;
  if (name.startsWith(methodPrefix)) {
    name = name.slice(methodPrefix.length);
  }

  return name;
}

/**
 * 简化 operationId
 */
function simplifyOperationId(operationId) {
  // 如果包含 _api_v1_ 或类似前缀，去掉
  let simplified = operationId.replace(/_api[_-]?v[0-9]+_/gi, "_");

  // 如果包含完整路径段，去掉
  simplified = simplified.replace(/_v[0-9]+_/g, "_");

  // 去掉末尾的 get/post/put/delete 等
  simplified = simplified.replace(/_?(get|post|put|delete|patch)$/i, "");

  // 去掉连续的下划线
  simplified = simplified.replace(/_+/g, "_");

  // 如果还很长，只保留前 2-3 个下划线分隔的部分
  const parts = simplified.split("_").filter(Boolean);
  if (parts.length > 4) {
    simplified = parts.slice(0, 3).join("_");
  }

  return simplified || operationId;
}

/**
 * Tag 名称转换为合法的文件名（英文）
 * 支持中英文混合，自动提取英文部分或拼音
 */
function tagToFileName(tag) {
  // 如果是纯英文，直接转小写
  if (/^[a-zA-Z]+$/.test(tag)) {
    return tag.toLowerCase();
  }

  // 常见中文 tag 映射表
  const tagMap = {
    会话相关: "session",
    会话: "session",
    用户: "user",
    用户相关: "user",
    订单: "order",
    订单相关: "order",
    商品: "product",
    商品相关: "product",
    认证: "auth",
    认证相关: "auth",
    权限: "permission",
    权限相关: "permission",
    文件: "file",
    文件相关: "file",
    日志: "log",
    日志相关: "log",
    宠物: "pet",
    宠物相关: "pet",
    系统: "system",
    系统相关: "system",
    管理: "admin",
    管理相关: "admin",
  };

  // 精确匹配
  if (tagMap[tag]) {
    return tagMap[tag];
  }

  // 模糊匹配（包含关系）
  for (const [cn, en] of Object.entries(tagMap)) {
    if (tag.includes(cn)) {
      return en;
    }
  }

  // 尝试提取中文括号内的英文
  const englishMatch = tag.match(/[\(（]?([a-zA-Z]+)[\)）]?/);
  if (englishMatch && englishMatch[1]) {
    return englishMatch[1].toLowerCase();
  }

  // 无法转换则保留原名（只保留英文和数字）
  return tag.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "api";
}

/**
 * 判断是否是排除的类型（框架自动生成的通用包装类型）
 */
function isExcludedType(name) {
  const excludePatterns = [
    // 简单类型
    /^List$/i,
    /^Map$/i,
    /^Set$/i,
    /^Array$/i,
    /^Result$/i,
    /^Page$/i,
    /^Boolean$/i,
    /^String$/i,
    /^Integer$/i,
    /^Long$/i,
    /^Double$/i,
    /^Float$/i,
    /^BigDecimal$/i,
    /^LocalDateTime$/i,
    /^Date$/i,
    /^MultipartFile$/i,
    /^I18nString$/i,
    /^Void$/i,
    /^Object$/i,
    /^ApiResponse$/i,
    /^AjaxResult$/i,
    /^R$/i,
    /^AjaxResponse$/i,
    /^Any$/i,
  ];

  for (const pattern of excludePatterns) {
    if (pattern.test(name)) return true;
  }
  return false;
}

/**
 * 判断 schema 是否有意义（对象类型且有属性）
 */
function isMeaningfulSchema(name, schema) {
  // 排除框架包装类型
  if (isExcludedType(name)) return false;
  if (schema.enum?.length) return true;
  if (schema.type === "object" && schema.properties) {
    return Object.keys(schema.properties).length > 0;
  }
  return Boolean(schema.oneOf || schema.anyOf || schema.allOf);
}

/**
 * 生成 TypeScript 类型文件
 */
export function generateTypeFile(schemas, usedTypes = new Set()) {
  const lines = ["// Auto-generated type definitions", ""];

  // 只保留 API 文件中实际引用的类型，且要有意义
  const expandedTypes = expandReferencedTypes(schemas, usedTypes);
  const filteredSchemas = Object.entries(schemas).filter(([name, schema]) => {
    if (expandedTypes.size > 0 && !expandedTypes.has(name)) return false;
    return isMeaningfulSchema(name, schema);
  });

  for (const [name, schema] of filteredSchemas) {
    if (schema.enum) {
      lines.push(
        `export type ${name} = ${schema.enum.map((v) => JSON.stringify(v)).join(" | ")};`,
      );
    } else if (schema.type === "object" && schema.properties) {
      lines.push(`export interface ${name} {`);
      for (const [prop, propSchema] of Object.entries(schema.properties)) {
        const required = schema.required?.includes(prop) ? "" : "?";
        lines.push(
          `  ${JSON.stringify(prop)}${required}: ${swaggerTypeToTS(propSchema, schemas)};`,
        );
      }
      lines.push("}");
    } else {
      // 其他简单类型
      lines.push(`export type ${name} = ${swaggerTypeToTS(schema, schemas)};`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function expandReferencedTypes(schemas, initialTypes) {
  const result = new Set(initialTypes);
  const queue = [...result];
  while (queue.length > 0) {
    const name = queue.shift();
    const found = new Set();
    collectUsedTypes(schemas[name], found);
    for (const dependency of found) {
      if (!result.has(dependency) && schemas[dependency]) {
        result.add(dependency);
        queue.push(dependency);
      }
    }
  }
  return result;
}
