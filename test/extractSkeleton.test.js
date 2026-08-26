import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { extractSkeletonFromFiles } from "../lib/extractSkeletonFromFiles.js";

test("prefers the module-specific type file over legacy api.d.ts", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codegen-skeleton-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const apiDir = path.join(root, "modules");
  const typesDir = path.join(root, "types");
  await fs.mkdir(apiDir, { recursive: true });
  await fs.mkdir(typesDir, { recursive: true });
  await fs.writeFile(
    path.join(apiDir, "hyo.ts"),
    "export function fetchCreate(data: HyoCreate) { return request({ url: '/create', method: 'post', data }); }",
  );
  await fs.writeFile(
    path.join(typesDir, "api.d.ts"),
    "export interface LegacyCreate { legacy: string; }",
  );
  await fs.writeFile(
    path.join(typesDir, "hyo.d.ts"),
    "export interface HyoCreate { name: string; }",
  );

  const skeleton = extractSkeletonFromFiles(apiDir, typesDir, "hyo");
  assert.deepEqual(skeleton.createApi.bodyFields, [
    { name: "name", type: "string" },
  ]);
});
