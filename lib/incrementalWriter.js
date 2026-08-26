import { createHash, randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";

const MANIFEST_VERSION = 1;

export async function createIncrementalWriter(outputRoot, options = {}) {
  const root = path.resolve(outputRoot);
  const metadataDir = path.join(root, ".codegen");
  const manifestPath = path.join(metadataDir, "manifest.json");
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const manifest = await readJson(manifestPath, {
    version: MANIFEST_VERSION,
    files: {},
  });
  const report = {
    version: 1,
    runId,
    startedAt: new Date().toISOString(),
    outputRoot: root,
    force: Boolean(options.force),
    files: [],
  };

  async function writeFile(targetPath, content, metadata = {}) {
    const target = assertInsideRoot(root, targetPath);
    const relativePath = toPortablePath(path.relative(root, target));
    if (!relativePath || relativePath.startsWith(".codegen/")) {
      throw new Error(`不能把生成结果写入元数据目录: ${relativePath}`);
    }

    const nextHash = hash(content);
    const previousEntry = manifest.files[relativePath];
    const currentContent = await readOptional(target);
    const currentHash = currentContent === null ? null : hash(currentContent);
    let action;

    if (currentContent === null) {
      await atomicWrite(target, content);
      action = "created";
      updateManifest(relativePath, nextHash, metadata);
    } else if (currentHash === nextHash) {
      action = "unchanged";
      updateManifest(relativePath, nextHash, metadata);
    } else if (previousEntry && currentHash === previousEntry.generatedHash) {
      await atomicWrite(target, content);
      action = "updated";
      updateManifest(relativePath, nextHash, metadata);
    } else if (options.force) {
      const backupPath = path.join(metadataDir, "backups", runId, relativePath);
      await atomicWrite(backupPath, currentContent);
      await atomicWrite(target, content);
      action = "forced";
      updateManifest(relativePath, nextHash, metadata);
      report.files.push(fileResult(relativePath, action, currentHash, nextHash, { backupPath }));
      return { action, target, backupPath };
    } else {
      const candidatePath = path.join(metadataDir, "conflicts", runId, `${relativePath}.generated`);
      await atomicWrite(candidatePath, content);
      action = "conflict";
      report.files.push(fileResult(relativePath, action, currentHash, nextHash, { candidatePath }));
      return { action, target, candidatePath };
    }

    report.files.push(fileResult(relativePath, action, currentHash, nextHash));
    return { action, target };
  }

  function updateManifest(relativePath, generatedHash, metadata) {
    manifest.files[relativePath] = {
      generatedHash,
      generator: metadata.generator || "unknown",
      contractSource: metadata.contractSource || null,
      updatedAt: new Date().toISOString(),
    };
  }

  async function finalize() {
    report.finishedAt = new Date().toISOString();
    report.summary = report.files.reduce(
      (summary, item) => {
        summary[item.action] = (summary[item.action] || 0) + 1;
        return summary;
      },
      {}
    );
    await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const reportPath = path.join(metadataDir, "reports", `${runId}.json`);
    await atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    return { report, reportPath };
  }

  return { root, writeFile, finalize };
}

function fileResult(relativePath, action, currentHash, generatedHash, extra = {}) {
  return {
    path: relativePath,
    action,
    currentHash,
    generatedHash,
    ...Object.fromEntries(
      Object.entries(extra).map(([key, value]) => [key, toPortablePath(value)])
    ),
  };
}

function assertInsideRoot(root, targetPath) {
  const target = path.resolve(targetPath);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`生成目标超出输出目录: ${targetPath}`);
  }
  return target;
}

async function atomicWrite(target, content) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  await fs.writeFile(temporary, content, "utf8");
  await fs.rename(temporary, target);
}

async function readOptional(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function readJson(filePath, fallback) {
  const content = await readOptional(filePath);
  if (content === null) return fallback;
  const parsed = JSON.parse(content);
  if (parsed.version !== MANIFEST_VERSION || typeof parsed.files !== "object") {
    throw new Error(`不支持的生成清单格式: ${filePath}`);
  }
  return parsed;
}

function hash(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function toPortablePath(value) {
  return String(value).replace(/\\/g, "/");
}
