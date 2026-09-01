/**
 * Exercises the real install path — npm, a scoped registry and the cache —
 * against a throwaway registry served from localhost.
 *
 * Skipped when npm is not on PATH.
 */

import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const BIN = fileURLToPath(new URL("../bin/jsr-exec.js", import.meta.url));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const hasNpm = spawnSync(npmCommand, ["--version"], {
  stdio: "ignore",
  shell: process.platform === "win32",
}).status === 0;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "jsr-exec-install-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

/**
 * Pack a fixture package and serve it as a one-package npm registry.
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
async function startRegistry() {
  const source = path.join(root, "fixture");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(
    path.join(source, "package.json"),
    JSON.stringify({
      name: "@jsr/kuboon__fixture",
      version: "1.4.2",
      type: "module",
      exports: { ".": { default: "./mod.js" } },
    }),
  );
  fs.writeFileSync(
    path.join(source, "mod.js"),
    'console.log("fixture ran with " + JSON.stringify(process.argv.slice(2)));\n',
  );

  const packDir = path.join(root, "pack");
  fs.mkdirSync(packDir, { recursive: true });
  execFileSync(npmCommand, ["pack", source, "--pack-destination", packDir], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  const tarballName = fs.readdirSync(packDir).find((file) => file.endsWith(".tgz"));
  assert.ok(tarballName, "npm pack produced no tarball");
  const tarball = fs.readFileSync(path.join(packDir, tarballName));

  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url ?? "");
    if (url.startsWith("/-/tarball")) {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(tarball);
      return;
    }
    if (url === "/@jsr/kuboon__fixture") {
      const address = /** @type {import("node:net").AddressInfo} */ (server.address());
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        _id: "@jsr/kuboon__fixture",
        name: "@jsr/kuboon__fixture",
        "dist-tags": { latest: "1.4.2" },
        versions: {
          "1.4.2": {
            name: "@jsr/kuboon__fixture",
            version: "1.4.2",
            type: "module",
            exports: { ".": { default: "./mod.js" } },
            dist: {
              tarball: `http://127.0.0.1:${address.port}/-/tarball.tgz`,
              shasum: crypto.createHash("sha1").update(tarball).digest("hex"),
              integrity: `sha512-${crypto.createHash("sha512").update(tarball).digest("base64")}`,
            },
          },
        },
      }));
      return;
    }
    res.writeHead(404).end("{}");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  };
}

test("installs from the npm-compat registry and runs the package", { skip: !hasNpm }, async () => {
  const registry = await startRegistry();
  const cache = path.join(root, "cache");
  const env = {
    ...process.env,
    JSR_EXEC_CACHE: cache,
    JSR_NPM_URL: registry.url,
    // Version resolution must not reach jsr.io: the specifier is exact.
    JSR_URL: "http://127.0.0.1:1/unreachable",
    npm_config_registry: registry.url,
  };

  try {
    const first = await execFileAsync(
      process.execPath,
      [BIN, "@kuboon/fixture@1.4.2", "one", "two"],
      { env },
    );
    // npm's own output must not leak into the program's stdout.
    assert.equal(first.stdout.trim(), 'fixture ran with ["one","two"]');
    assert.match(first.stderr, /installing @kuboon\/fixture@1\.4\.2/);
    assert.match(first.stderr, /added 1 package/);

    const installed = path.join(
      cache,
      "pkgs/kuboon__fixture/1.4.2/node_modules/@jsr/kuboon__fixture/mod.js",
    );
    assert.ok(fs.existsSync(installed), "package should be cached on disk");

    // A second run is served entirely from the cache, so it must not install
    // again — and must still work with the registry gone.
    await registry.close();
    const second = await execFileAsync(process.execPath, [BIN, "@kuboon/fixture@1.4.2"], { env });
    assert.equal(second.stdout.trim(), 'fixture ran with []');
    assert.doesNotMatch(second.stderr, /installing/);
  } finally {
    await registry.close().catch(() => {});
  }
});
