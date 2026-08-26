import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { createIncrementalWriter } from "../lib/incrementalWriter.js";

async function withTemporaryDirectory(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codegen-writer-"));
  try {
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("updates files that still match the generated baseline", async () => {
  await withTemporaryDirectory(async root => {
    const target = path.join(root, "modules", "user.ts");
    const first = await createIncrementalWriter(root);
    assert.equal((await first.writeFile(target, "v1")).action, "created");
    await first.finalize();

    const second = await createIncrementalWriter(root);
    assert.equal((await second.writeFile(target, "v2")).action, "updated");
    await second.finalize();
    assert.equal(await fs.readFile(target, "utf8"), "v2");
  });
});

test("preserves manual changes and writes a conflict candidate", async () => {
  await withTemporaryDirectory(async root => {
    const target = path.join(root, "views", "list.vue");
    const first = await createIncrementalWriter(root);
    await first.writeFile(target, "generated-v1");
    await first.finalize();
    await fs.writeFile(target, "manual-edit", "utf8");

    const second = await createIncrementalWriter(root);
    const result = await second.writeFile(target, "generated-v2");
    const { report } = await second.finalize();

    assert.equal(result.action, "conflict");
    assert.equal(await fs.readFile(target, "utf8"), "manual-edit");
    assert.equal(await fs.readFile(result.candidatePath, "utf8"), "generated-v2");
    assert.equal(report.summary.conflict, 1);
  });
});

test("force mode backs up manual changes before replacement", async () => {
  await withTemporaryDirectory(async root => {
    const target = path.join(root, "api.ts");
    const first = await createIncrementalWriter(root);
    await first.writeFile(target, "generated-v1");
    await first.finalize();
    await fs.writeFile(target, "manual-edit", "utf8");

    const forced = await createIncrementalWriter(root, { force: true });
    const result = await forced.writeFile(target, "generated-v2");
    await forced.finalize();

    assert.equal(result.action, "forced");
    assert.equal(await fs.readFile(target, "utf8"), "generated-v2");
    assert.equal(await fs.readFile(result.backupPath, "utf8"), "manual-edit");
  });
});

test("rejects output outside the configured root", async () => {
  await withTemporaryDirectory(async root => {
    const writer = await createIncrementalWriter(root);
    await assert.rejects(
      writer.writeFile(path.join(root, "..", "escaped.ts"), "bad"),
      /超出输出目录/
    );
  });
});
