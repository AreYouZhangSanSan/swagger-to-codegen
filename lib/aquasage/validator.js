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

/**
 * 检测目标项目是否有 vite dev 服务在运行。
 * dev 服务的 elegant-router 插件会按视图目录重写 routes.ts，
 * 与生成命令同时写会把该文件写坏，因此正式生成前先拦截。
 */
export async function findRunningDevServer(projectRoot) {
  if (process.platform !== "win32") return null;
  const result = await execute(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      // 必须显式把控制台输出编码设为 UTF-8：否则 PowerShell 按 OEM 代码页（中文系统为 GBK）
      // 写 stdout，而 Node 按 UTF-8 解码，命令行里含中文的项目路径会变成 U+FFFD，
      // 导致下面的匹配永远失败、dev 服务检测形同虚设。
      "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " +
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object -ExpandProperty CommandLine",
    ],
    {},
  );
  if (result.spawnError || result.exitCode !== 0) return null;
  return matchDevCommandLine(result.output, projectRoot);
}

/** 只保留可见 ASCII，用于进程命令行编码不可靠时的兜底比较 */
function asciiOnly(value) {
  return String(value).replace(/[^\x20-\x7E]/g, "");
}

export function matchDevCommandLine(output, projectRoot) {
  const normalize = (value) =>
    String(value).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const projectPath = normalize(projectRoot);
  // 项目目录名一般是纯 ASCII，即使路径中的中文被编码问题破坏也仍能比对
  const projectName = projectPath.split("/").filter(Boolean).at(-1) || "";
  const asciiName = asciiOnly(projectName);
  const lines = String(output).split(/\r?\n/);
  for (const line of lines) {
    if (!/vite/i.test(line)) continue;
    const normalized = normalize(line);
    if (normalized.includes(projectPath)) return line.trim();
    // 兜底：只有在命令行里确实出现了解码失败字符（U+FFFD，说明输出编码与预期
    // 不一致、路径中的非 ASCII 段已损坏）时，才退化为只比较纯 ASCII 目录名，
    // 避免把别的同名工程误判成当前工程。
    if (
      asciiName &&
      line.includes("\uFFFD") &&
      asciiOnly(normalized).includes(asciiName)
    ) {
      return line.trim();
    }
  }
  return null;
}

export async function runRouteGenerator(projectRoot) {
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = await execute(executable, ["gen-route"], { cwd: projectRoot });
  return describeRouteGeneration(result, executable, ["gen-route"]);
}

/**
 * 路由生成失败不再中断整个流程：业务文件与路由补丁已经完成，
 * 失败时返回 ok:false 与可操作提示，由调用方打印警告后继续。
 */
function describeRouteGeneration(result, executable, args) {
  if (result.spawnError) {
    const code = result.spawnError.code || "UNKNOWN";
    return {
      ok: false,
      output: `${executable} ${args.join(" ")} 无法启动（${code}: ${result.spawnError.message}）`,
      hint: "请确认 pnpm 已安装且在 PATH 中；也可以添加 --no-route-generation 跳过，生成后手动执行路由生成命令",
    };
  }
  if (result.exitCode !== 0) {
    return {
      ok: false,
      output: result.output,
      hint: "路由生成命令退出码非 0，请检查输出；也可以添加 --no-route-generation 跳过，生成后手动执行",
    };
  }
  return { ok: true, output: result.output, hint: null };
}

function execute(file, args, options) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { ...options, windowsHide: true, maxBuffer: 20 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0,
          spawnError: error && typeof error.code !== "number" ? error : null,
          output: [stdout, stderr].filter(Boolean).join("\n"),
        });
      },
    );
  });
}
