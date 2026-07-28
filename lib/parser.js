/*
 * @title: 
 */
// lib/parser.js
import axios from 'axios';
import * as yaml from 'js-yaml';

/**
 * 从 URL 加载 Swagger 文档（自动识别 JSON/YAML）
 */
export async function loadSwagger(url) {
  const response = await axios.get(url, { responseType: 'text' });
  const content = response.data;
  // 简单判断：以 openapi 开头的 YAML，或者内容不含 '{' 可能是 YAML
  if (
    url.endsWith('.yaml') ||
    url.endsWith('.yml') ||
    /^\s*openapi\s*:/i.test(content) ||
    !content.trim().startsWith('{')
  ) {
    return yaml.load(content);
  }
  return JSON.parse(content);
}

/**
 * 提取接口的成功响应（200/201）的 JSON Schema
 */
function getResponseSchema(operation) {
  const responses = operation.responses || {};
  const successKey = Object.keys(responses).find(code => code.startsWith('2'));
  if (!successKey) return null;
  const content = responses[successKey].content;
  return content?.['application/json']?.schema || null;
}

/**
 * 按 tags 分组接口
 * 返回 { [tag]: [ { method, path, summary, parameters, requestBody, responseSchema, operationId } ] }
 */
export function groupByTag(swagger) {
  const groups = {};
  for (const [urlPath, methods] of Object.entries(swagger.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) continue;
      const tag = operation.tags?.[0] || 'Default';
      if (!groups[tag]) groups[tag] = [];

      // 将 {id} 替换为 :id 方便前端使用
      const frontendPath = urlPath.replace(/\{(\w+)\}/g, ':$1');

      groups[tag].push({
        method: method.toUpperCase(),
        path: frontendPath,
        summary: operation.summary || '',
        parameters: operation.parameters || [],
        requestBody: operation.requestBody || null,
        responseSchema: getResponseSchema(operation),
        operationId: operation.operationId,
      });
    }
  }
  return groups;
}

/**
 * 获取所有 components/schemas
 */
export function getAllSchemas(swagger) {
  return swagger.components?.schemas || {};
}