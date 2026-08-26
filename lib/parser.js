/*
 * @title:
 */
// lib/parser.js
import axios from "axios";
import * as yaml from "js-yaml";
import fs from "fs/promises";

/**
 * 从 URL 加载 Swagger 文档（自动识别 JSON/YAML）
 */
export async function loadSwagger(url) {
  const isRemote = /^https?:\/\//i.test(url);
  const content = isRemote
    ? (await axios.get(url, { responseType: "text", timeout: 15000 })).data
    : await fs.readFile(url, "utf8");
  // 简单判断：以 openapi 开头的 YAML，或者内容不含 '{' 可能是 YAML
  if (
    url.endsWith(".yaml") ||
    url.endsWith(".yml") ||
    /^\s*openapi\s*:/i.test(content) ||
    !content.trim().startsWith("{")
  ) {
    return validateDocument(yaml.load(content));
  }
  return validateDocument(JSON.parse(content));
}

function validateDocument(document) {
  if (!document || typeof document !== "object") {
    throw new Error("OpenAPI 文档内容为空或格式错误");
  }
  if (!document.openapi && !document.swagger) {
    throw new Error("文件不是有效的 OpenAPI/Swagger 文档");
  }
  if (!document.paths || typeof document.paths !== "object") {
    throw new Error("OpenAPI 文档缺少 paths");
  }
  return document;
}

/**
 * 提取接口的成功响应（200/201）的 JSON Schema
 */
function getResponseSchema(operation) {
  const responses = operation.responses || {};
  const successKey = Object.keys(responses).find((code) =>
    code.startsWith("2"),
  );
  if (!successKey) return null;
  const response = responses[successKey];
  if (response.schema) return response.schema;
  const content = response.content || {};
  const mediaType = pickMediaType(content, [
    "application/json",
    "application/*+json",
  ]);
  return mediaType?.schema || null;
}

function pickMediaType(content, preferredTypes = []) {
  for (const type of preferredTypes) {
    if (content[type]) return content[type];
  }
  const jsonEntry = Object.entries(content).find(([type]) =>
    type.includes("json"),
  );
  if (jsonEntry) return jsonEntry[1];
  return Object.values(content)[0] || null;
}

function normalizeRequestBody(operation) {
  if (operation.requestBody) return operation.requestBody;

  const bodyParameter = (operation.parameters || []).find(
    (parameter) => parameter.in === "body",
  );
  if (!bodyParameter?.schema) return null;
  return {
    required: Boolean(bodyParameter.required),
    content: {
      "application/json": { schema: bodyParameter.schema },
    },
  };
}

/**
 * 按 tags 分组接口
 * 返回 { [tag]: [ { method, path, summary, parameters, requestBody, responseSchema, operationId } ] }
 */
export function groupByTag(swagger) {
  const groups = {};
  for (const [urlPath, methods] of Object.entries(swagger.paths || {})) {
    const pathParameters = Array.isArray(methods.parameters)
      ? methods.parameters
      : [];
    for (const [method, operation] of Object.entries(methods)) {
      if (!["get", "post", "put", "delete", "patch"].includes(method)) continue;
      const tag = operation.tags?.[0] || "Default";
      if (!groups[tag]) groups[tag] = [];

      const operationParameters = operation.parameters || [];
      const parameters = mergeParameters(pathParameters, operationParameters);
      const requestBody = normalizeRequestBody({ ...operation, parameters });

      groups[tag].push({
        method: method.toUpperCase(),
        path: urlPath,
        summary: operation.summary || "",
        description: operation.description || "",
        parameters,
        requestBody,
        responseSchema: getResponseSchema(operation),
        operationId: operation.operationId,
        tags: operation.tags || [],
      });
    }
  }
  return groups;
}

function mergeParameters(pathParameters, operationParameters) {
  const merged = new Map();
  for (const parameter of [...pathParameters, ...operationParameters]) {
    const key = `${parameter.in || ""}:${parameter.name || ""}`;
    merged.set(key, parameter);
  }
  return [...merged.values()];
}

/**
 * 获取所有 components/schemas
 */
export function getAllSchemas(swagger) {
  return swagger.components?.schemas || swagger.definitions || {};
}
