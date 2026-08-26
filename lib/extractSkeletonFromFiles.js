// lib/extractSkeletonFromFiles.js
import fs from "fs";
import path from "path";

export function extractSkeletonFromFiles(apiDir, typesDir, moduleName) {
  const apiFilePath = path.join(apiDir, `${moduleName}.ts`);
  const moduleTypesFilePath = path.join(typesDir, `${moduleName}.d.ts`);
  const legacyTypesFilePath = path.join(typesDir, "api.d.ts");
  const typesFilePath = fs.existsSync(moduleTypesFilePath)
    ? moduleTypesFilePath
    : legacyTypesFilePath;

  if (!fs.existsSync(apiFilePath))
    throw new Error(`API 文件不存在: ${apiFilePath}`);
  if (!fs.existsSync(typesFilePath))
    throw new Error(`类型文件不存在: ${typesFilePath}`);

  const apiCode = fs.readFileSync(apiFilePath, "utf-8");
  const typesCode = fs.readFileSync(typesFilePath, "utf-8");

  const endpoints = parseApiFunctions(apiCode);
  const types = parseTypeDefinitions(typesCode);

  // 识别 CRUD 端点
  const listEp = endpoints.find(
    (e) => e.method.toUpperCase() === "GET" && !e.url.includes(":"),
  );
  const detailEp = endpoints.find(
    (e) => e.method.toUpperCase() === "GET" && e.url.includes(":"),
  );
  const createEp = endpoints.find(
    (e) =>
      e.method.toUpperCase() === "POST" &&
      (e.url.includes("create") || e.url.includes("add")),
  );
  const updateEp = endpoints.find(
    (e) =>
      e.method.toUpperCase() === "PUT" ||
      (e.method.toUpperCase() === "POST" && e.url.includes("update")),
  );
  const deleteEp = endpoints.find(
    (e) =>
      e.method.toUpperCase() === "DELETE" ||
      (e.method.toUpperCase() === "POST" && e.url.includes("delete")),
  );

  // 尝试从类型文件推断字段（如果有明确的请求/响应类型）
  const listFields = listEp ? inferListFields(listEp, types) : [];
  const detailFields = detailEp ? inferDetailFields(detailEp, types) : [];
  const createFields = createEp ? inferBodyFields(createEp, types) : [];
  const updateFields = updateEp ? inferBodyFields(updateEp, types) : [];

  return {
    module: moduleName,
    listApi: listEp
      ? {
          method: listEp.method,
          path: listEp.url,
          funcName: listEp.funcName,
          queryParams: listEp.params || [],
          columns: listFields,
          responseField: "data.records", // 根据实际分页结构调整
        }
      : null,
    detailApi: detailEp
      ? {
          method: detailEp.method,
          path: detailEp.url,
          funcName: detailEp.funcName,
          responseFields: detailFields,
        }
      : null,
    createApi: createEp
      ? {
          method: createEp.method,
          path: createEp.url,
          funcName: createEp.funcName,
          bodyFields: createFields,
        }
      : null,
    updateApi: updateEp
      ? {
          method: updateEp.method,
          path: updateEp.url,
          funcName: updateEp.funcName,
          bodyFields: updateFields,
        }
      : null,
    deleteApi: deleteEp
      ? {
          method: deleteEp.method,
          path: deleteEp.url,
          funcName: deleteEp.funcName,
        }
      : null,
  };
}

// ----- 解析 API 函数 (支持 request({...}) 风格) -----
function parseApiFunctions(code) {
  const endpoints = [];
  // 匹配 export function xxx(...) { ... return request({ ... }); }
  const funcRegex =
    /export\s+function\s+(\w+)\s*\(([^)]*)\)\s*{[\s\S]*?return\s+request\s*\(\s*\{([^}]+)\}\s*\)/g;
  let match;
  while ((match = funcRegex.exec(code)) !== null) {
    const funcName = match[1];
    const argsStr = match[2];
    const configStr = match[3];
    const { method, url } = extractRequestConfig(configStr);
    if (!method || !url) continue;

    const params = parseArgs(argsStr);
    endpoints.push({
      funcName,
      method,
      url,
      params: params.filter((p) => p.in !== "body"), // 查询参数
      bodyParam: params.find((p) => p.in === "body"),
    });
  }
  return endpoints;
}

function extractRequestConfig(configStr) {
  // 简单提取 method 和 url 的值
  const methodMatch = configStr.match(/method\s*:\s*["'](\w+)["']/);
  const urlMatch = configStr.match(/url\s*:\s*["']([^"']+)["']/);
  return {
    method: methodMatch ? methodMatch[1] : "",
    url: urlMatch ? urlMatch[1] : "",
  };
}

// 解析参数列表，识别 params, data, id 等
function parseArgs(argsStr) {
  const params = [];
  if (!argsStr.trim()) return params;
  // 按逗号分割，注意处理对象内的逗号
  const parts = splitArguments(argsStr);
  for (const part of parts) {
    const colonIdx = part.indexOf(":");
    if (colonIdx === -1) continue;
    const name = part.slice(0, colonIdx).trim();
    const typePart = part.slice(colonIdx + 1).trim();

    if (name === "data" || name === "body") {
      // 请求体参数
      params.push({ name, type: typePart, in: "body" });
    } else if (name === "params") {
      // 查询参数对象，提取内部字段
      const fields = extractInlineTypeFields(typePart);
      params.push(
        ...fields.map((f) => ({ name: f.name, type: f.type, in: "query" })),
      );
    } else if (
      typePart.includes("number") ||
      typePart.includes("string") ||
      typePart.includes("any")
    ) {
      params.push({ name, type: typePart, in: "path" });
    }
  }
  return params;
}

function splitArguments(str) {
  // 简单按逗号分割，忽略括号内的逗号
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of str) {
    if (ch === "{" || ch === "(") depth++;
    else if (ch === "}" || ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function extractInlineTypeFields(typeStr) {
  // 从 { key: type; ... } 中提取字段
  const match = typeStr.match(/\{([^}]+)\}/);
  if (!match) return [];
  const inner = match[1];
  const fields = [];
  const fieldRegex = /(\w+)\??\s*:\s*([^;]+)/g;
  let fm;
  while ((fm = fieldRegex.exec(inner)) !== null) {
    fields.push({ name: fm[1], type: fm[2].trim() });
  }
  return fields;
}

// ----- 类型文件解析 -----
function parseTypeDefinitions(code) {
  const types = {};
  const interfaceRegex = /export\s+interface\s+(\w+)\s*\{([^}]+)\}/g;
  let match;
  while ((match = interfaceRegex.exec(code)) !== null) {
    const name = match[1];
    const body = match[2];
    const fields = [];
    const fieldRegex = /(\w+)\??\s*:\s*([^;]+)/g;
    let fm;
    while ((fm = fieldRegex.exec(body)) !== null) {
      fields.push({ name: fm[1], type: fm[2].trim() });
    }
    types[name] = fields;
  }
  return types;
}

// ----- 字段推断 -----
function inferListFields(listEp, types) {
  // 优先从参数中可能的泛型推断，例如 fetchQuery_drill_project 返回类型未明确，只能靠猜测
  // 这里简单返回空，表示无字段信息，后续提示词会处理
  return []; // 实际项目中可扩展通过 Swagger 补充
}

function inferDetailFields(detailEp, types) {
  return [];
}

function inferBodyFields(ep, types) {
  // 从请求体参数的类型名查找接口字段
  if (ep.bodyParam) {
    const typeName = ep.bodyParam.type.replace(/\[\]/g, "");
    if (types[typeName]) return types[typeName];
  }
  // 如果函数参数是内联对象，已经提取在 query/body 字段中
  if (ep.bodyParam && !types[ep.bodyParam.type]) {
    // 可能是内联对象，已经在 parseArgs 中提取了字段
    return []; // 实际我们可通过 ep 的参数列表获取 body 内联字段，但暂未存储
  }
  return [];
}
