import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { resolveEntrypoint } from "../src/entrypoint.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "jsrex-entry-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

let counter = 0;

/**
 * Create a throwaway package directory with the given manifest and files.
 * @param {object} manifest
 * @param {string[]} files Relative paths to create as empty files.
 */
function makePackage(manifest, files) {
  const dir = path.join(root, `pkg-${counter++}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest));
  for (const file of files) {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "");
  }
  return dir;
}

test("resolves the conditional default export, as JSR publishes it", () => {
  const dir = makePackage(
    {
      name: "@jsr/kuboon__package",
      exports: { ".": { types: "./_dist/mod.d.ts", default: "./_dist/mod.js" } },
    },
    ["_dist/mod.js"],
  );
  assert.equal(resolveEntrypoint(dir, "."), path.join(dir, "_dist/mod.js"));
});

test("prefers node over import and require", () => {
  const dir = makePackage(
    { exports: { ".": { require: "./cjs.js", import: "./esm.js", node: "./node.js" } } },
    ["cjs.js", "esm.js", "node.js"],
  );
  assert.equal(resolveEntrypoint(dir, "."), path.join(dir, "node.js"));
});

test("resolves a subpath export", () => {
  const dir = makePackage(
    { exports: { ".": "./mod.js", "./cli": "./cli.js" } },
    ["mod.js", "cli.js"],
  );
  assert.equal(resolveEntrypoint(dir, "./cli"), path.join(dir, "cli.js"));
});

test("resolves a wildcard export", () => {
  const dir = makePackage({ exports: { "./*": "./src/*.js" } }, ["src/tools/fmt.js"]);
  assert.equal(resolveEntrypoint(dir, "./tools/fmt"), path.join(dir, "src/tools/fmt.js"));
});

test("accepts a string exports field and a bare condition map", () => {
  const stringExports = makePackage({ exports: "./mod.js" }, ["mod.js"]);
  assert.equal(resolveEntrypoint(stringExports, "."), path.join(stringExports, "mod.js"));

  const conditionMap = makePackage({ exports: { import: "./esm.js" } }, ["esm.js"]);
  assert.equal(resolveEntrypoint(conditionMap, "."), path.join(conditionMap, "esm.js"));
});

test("falls back to module/main when there is no exports field", () => {
  const withModule = makePackage({ module: "./esm.js", main: "./cjs.js" }, ["esm.js", "cjs.js"]);
  assert.equal(resolveEntrypoint(withModule, "."), path.join(withModule, "esm.js"));

  const bare = makePackage({ name: "legacy" }, ["index.js"]);
  assert.equal(resolveEntrypoint(bare, "."), path.join(bare, "index.js"));
});

test("reports unexported and missing paths", () => {
  const dir = makePackage({ exports: { ".": "./mod.js", "./cli": "./cli.js" } }, ["mod.js"]);
  assert.throws(() => resolveEntrypoint(dir, "./nope"), /does not export \.\/nope/);
  assert.throws(() => resolveEntrypoint(dir, "./nope"), /exported paths: \.,/);
  assert.throws(() => resolveEntrypoint(dir, "./cli"), /missing file/);
});

test("refuses an export escaping the package directory", () => {
  const dir = makePackage({ exports: { ".": "../outside.js" } }, []);
  fs.writeFileSync(path.join(root, "outside.js"), "");
  assert.throws(() => resolveEntrypoint(dir, "."), /outside the package/);
});
