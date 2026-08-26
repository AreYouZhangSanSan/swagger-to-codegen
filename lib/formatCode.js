// lib/formatCode.js
/**
 * 格式化检查
 */
import prettier from "prettier";
import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

export async function formatVueCode(code) {
  const options = await prettier.resolveConfig(process.cwd());
  return prettier.format(code, { ...options, parser: "vue" });
}

export function checkTypes(filePath, projectRoot) {
  return new Promise((resolve) => {
    const vueTscPath = path.join(
      projectRoot,
      "node_modules",
      "vue-tsc",
      "bin",
      "vue-tsc.js",
    );
    execFile(
      process.execPath,
      [vueTscPath, "--noEmit", "--skipLibCheck"],
      { cwd: projectRoot },
      (error, stdout, stderr) => {
        const output = stderr || stdout;
        if (error) resolve({ success: false, errors: output });
        else resolve({ success: true });
      },
    );
  });
}

export async function checkVueCode(code, intendedPath) {
  const directory = path.dirname(intendedPath);
  const projectRoot = await findProjectRoot(directory);
  if (!projectRoot) {
    return {
      success: false,
      errors: `无法从 ${intendedPath} 定位包含 package.json 的目标项目`,
    };
  }
  try {
    await fs.access(
      path.join(projectRoot, "node_modules", "vue-tsc", "bin", "vue-tsc.js"),
    );
  } catch {
    return { success: false, errors: `目标项目未安装 vue-tsc: ${projectRoot}` };
  }
  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.codegen-check-${process.pid}-${randomUUID()}.vue`,
  );
  try {
    await fs.writeFile(temporaryPath, code, "utf8");
    return await checkTypes(temporaryPath, projectRoot);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

async function findProjectRoot(startDirectory) {
  let current = path.resolve(startDirectory);
  while (true) {
    try {
      await fs.access(path.join(current, "package.json"));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}
