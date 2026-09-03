import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";

export async function validateAquaSageProject(projectRoot) {
  const packagePath = path.join(projectRoot, "package.json");
  const packageJson = JSON.parse(await fs.readFile(packagePath, "utf8"));
  if (packageJson.name !== "zdwp-aquasage-web") {
    throw new Error(`目标目录不是 zdwp-aquasage-web: ${projectRoot}`);
  }
  for (const requiredPath of [
    "src/service/request/index.ts",
    "src/components/common/engineering-form/index.vue",
    "src/components/advanced/top-search-tool.vue",
    "src/hooks/common/table.ts",
  ]) {
    await fs.access(path.join(projectRoot, requiredPath));
  }
  return packageJson;
}

export async function collectTypeDiagnostics(projectRoot) {
  const vueTscPath = path.join(
    projectRoot,
    "node_modules",
    "vue-tsc",
    "bin",
    "vue-tsc.js",
  );
  try {
    await fs.access(vueTscPath);
  } catch {
    return {
      available: false,
      diagnostics: new Set(),
      output: `未找到 ${vueTscPath}`,
    };
  }

  const result = await execute(
    process.execPath,
    [vueTscPath, "--noEmit", "--skipLibCheck"],
    {
      cwd: projectRoot,
    },
  );
  const diagnostics = new Set(
    result.output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /\berror TS\d+:/.test(line)),
  );
  return {
    available: true,
    diagnostics,
    output: result.output,
    exitCode: result.exitCode,
  };
}

export function diffDiagnostics(before, after) {
  return [...after.diagnostics].filter(
    (diagnostic) => !before.diagnostics.has(diagnostic),
  );
}

export async function runRouteGenerator(projectRoot) {
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = await execute(executable, ["gen-route"], { cwd: projectRoot });
  if (result.exitCode !== 0) {
    throw new Error(`路由生成失败:\n${result.output}`);
  }
  return result.output;
}

function execute(file, args, options) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { ...options, windowsHide: true, maxBuffer: 20 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          exitCode:
            typeof error?.code === "number" ? error.code : error ? 1 : 0,
          output: [stdout, stderr].filter(Boolean).join("\n"),
        });
      },
    );
  });
}
