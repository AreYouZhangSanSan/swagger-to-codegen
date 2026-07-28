// import { DynamicTool } from "@langchain/core/tools";
// import fs from "fs/promises";

// export const readFileTool = new DynamicTool({
//   name: "read_file",
//   description: "读取指定路径的文件内容。输入为文件的相对或绝对路径字符串。",
//   func: async (filePath) => {
//     try {
//       return await fs.readFile(filePath, "utf-8");
//     } catch (e) {
//       return `读取文件失败: ${e.message}`;
//     }
//   },
// });

import * as fs from "fs/promises";
import * as path from "path";

// 内存缓存：key 为绝对路径，value 为文件内容
const fileCache = new Map();

/**
 * 读取单个文件，带缓存
 * @param {string} filePath - 文件路径
 * @returns {Promise<string>} 文件内容
 */
async function readSingleFile(filePath) {
  const absPath = path.resolve(filePath);
  if (fileCache.has(absPath)) {
    return fileCache.get(absPath);
  }
  const content = await fs.readFile(absPath, "utf-8");
  fileCache.set(absPath, content);
  return content;
}

/**
 * 读取多个文件（并行读取）
 * @param {string|string[]} paths - 单个路径或路径数组
 * @param {Object} options - 选项
 * @param {boolean} options.cache - 是否启用缓存，默认 true
 * @returns {Promise<Object>} { [filePath]: content }
 */
export async function readFiles(paths, options = { cache: true }) {
  const pathList = Array.isArray(paths) ? paths : [paths];
  const results = {};

  if (options.cache) {
    // 并行读取
    const contents = await Promise.all(
      pathList.map(async (p) => {
        try {
          return await readSingleFile(p);
        } catch (e) {
          return `[Error reading ${p}: ${e.message}]`;
        }
      })
    );
    pathList.forEach((p, i) => {
      results[p] = contents[i];
    });
  } else {
    // 不使用缓存，直接并行读取
    const contents = await Promise.all(
      pathList.map(async (p) => {
        try {
          return await fs.readFile(path.resolve(p), "utf-8");
        } catch (e) {
          return `[Error reading ${p}: ${e.message}]`;
        }
      })
    );
    pathList.forEach((p, i) => {
      results[p] = contents[i];
    });
  }

  return results;
}

/**
 * 清空文件缓存
 */
export function clearCache() {
  fileCache.clear();
}

/**
 * 获取缓存大小
 * @returns {number} 缓存条目数
 */
export function getCacheSize() {
  return fileCache.size;
}