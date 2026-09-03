import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const cliPath = path.join(projectRoot, "codegen.js");

function runCli(...args) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
  });
}

function runCliFailure(...args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0, `命令应当失败: ${args.join(" ")}`);
  return `${result.stdout || ""}${result.stderr || ""}`;
}

test("aquasage help documents dry-run and safe first-run example", () => {
  const help = runCli("aquasage", "--help");
  assert.match(help, /--dry-run\s+只输出计划和文件列表，不写入目标项目/);
  assert.match(help, /aquasage .*--dry-run/);
  assert.match(help, /只做读取、规划和格式化/);
});

test("every CLI command provides a beginner example", () => {
  const commands = [
    "aquasage",
    "sync-zh-cn",
    "analyze",
    "plan",
    "api",
    "style",
    "page",
    "generate",
  ];
  for (const command of commands) {
    const help = runCli(command, "--help");
    assert.match(help, /使用示例与提示/);
    assert.match(help, new RegExp(`codegen\\.js ${command}`));
  }
});

test("root help explains how to detect an old CLI package", () => {
  const help = runCli("--help");
  assert.match(help, /3\.1\.0/);
  assert.match(help, /没有 --dry-run/);
  assert.equal(runCli("--version").trim(), "3.1.0");
});

test("CLI rejects option combinations that used to be silently ignored", () => {
  const apiError = runCliFailure("api", "-s", "missing.json", "-t", "list.vue");
  assert.match(apiError, /使用 -t 生成页面时必须同时提供 -m/);

  const generateError = runCliFailure(
    "generate",
    "--skip-api",
    "-m",
    "政策相关",
    "-t",
    "list.vue",
  );
  assert.match(generateError, /--skip-api 时必须提供 --api-module/);
});
