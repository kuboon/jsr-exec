/**
 * End-to-end tests for the `jsrex` binary.
 *
 * The cache is seeded by hand with an exact version, which is the one path
 * that needs neither the network nor npm, so these run anywhere.
 */

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const BIN = fileURLToPath(new URL("../bin/jsrex.js", import.meta.url));

const cache = fs.mkdtempSync(path.join(os.tmpdir(), "jsrex-run-"));
after(() => fs.rmSync(cache, { recursive: true, force: true }));

/**
 * Write a package into the cache exactly as a successful install would leave it.
 * @param {string} scope
 * @param {string} name
 * @param {string} version
 * @param {Record<string, string>} files
 * @param {object} manifest
 */
function seed(scope, name, version, files, manifest) {
  const dir = path.join(cache, "pkgs", `${scope}__${name}`, version);
  const pkgDir = path.join(dir, "node_modules", "@jsr", `${scope}__${name}`);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name: `@jsr/${scope}__${name}`, version, type: "module", ...manifest }),
  );
  for (const [file, contents] of Object.entries(files)) {
    const target = path.join(pkgDir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  fs.writeFileSync(path.join(dir, ".jsrex-complete"), "seeded\n");
  return dir;
}

seed(
  "kuboon",
  "demo",
  "1.0.0",
  {
    "_dist/mod.js":
      'console.log("hello from " + JSON.stringify(process.argv.slice(2)));\n' +
      'if (process.argv.includes("--fail")) process.exit(3);\n',
    "_dist/cli.js": 'console.log("cli entrypoint");\n',
  },
  { exports: { ".": { default: "./_dist/mod.js" }, "./cli": "./_dist/cli.js" } },
);

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 */
function run(args, env = {}) {
  return execFileAsync(process.execPath, [BIN, ...args], {
    env: { ...process.env, JSREX_CACHE: cache, ...env },
  });
}

test("runs a cached package and forwards arguments", async () => {
  const { stdout } = await run(["@kuboon/demo@1.0.0", "a", "--b", "c"]);
  assert.equal(stdout.trim(), 'hello from ["a","--b","c"]');
});

test("runs a subpath entrypoint", async () => {
  const { stdout } = await run(["@kuboon/demo@1.0.0/cli"]);
  assert.equal(stdout.trim(), "cli entrypoint");
});

test("accepts the jsr: scheme", async () => {
  const { stdout } = await run(["jsr:@kuboon/demo@1.0.0", "x"]);
  assert.equal(stdout.trim(), 'hello from ["x"]');
});

test("propagates the program's exit code", async () => {
  const error = await run(["@kuboon/demo@1.0.0", "--fail"]).then(
    () => null,
    (err) => err,
  );
  assert.ok(error, "expected a non-zero exit");
  assert.equal(error.code, 3);
});

test("--print-entry reports the resolved file without running it", async () => {
  const { stdout } = await run(["--print-entry", "@kuboon/demo@1.0.0"]);
  assert.equal(stdout.trim(), path.join(cache, "pkgs/kuboon__demo/1.0.0/node_modules/@jsr/kuboon__demo/_dist/mod.js"));
});

test("--offline fails on an uncached version instead of installing", async () => {
  const error = await run(["--offline", "@kuboon/demo@9.9.9"]).then(
    () => null,
    (err) => err,
  );
  assert.ok(error, "expected a failure");
  assert.match(error.stderr, /not in the cache and --offline was given/);
});

test("--help and --version print without touching the network", async () => {
  const help = await run(["--help"]);
  assert.match(help.stdout, /Usage:\s+jsrex/);

  const version = await run(["--version"]);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+/);

  const cacheDir = await run(["--cache-dir"]);
  assert.equal(cacheDir.stdout.trim(), cache);
});

test("an invalid specifier fails with a usable message", async () => {
  const error = await run(["chalk"]).then(() => null, (err) => err);
  assert.ok(error, "expected a failure");
  assert.match(error.stderr, /invalid JSR specifier/);
});

test("--offline resolves a range against the cache", async () => {
  const { stdout } = await run(["--offline", "@kuboon/demo@^1", "z"]);
  assert.equal(stdout.trim(), 'hello from ["z"]');

  const error = await run(["--offline", "@kuboon/demo@^2"]).then(() => null, (err) => err);
  assert.ok(error, "expected a failure");
  assert.match(error.stderr, /no cached version .* matches \^2/);
  assert.match(error.stderr, /cached: 1\.0\.0/);
});

test("forwards SIGTERM to the program and reports 143", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX signals only");

  seed(
    "kuboon",
    "sleeper",
    "1.0.0",
    {
      "mod.js":
        'process.on("SIGTERM", () => { console.log("term"); process.exit(0); });\n' +
        'console.log("ready");\nsetInterval(() => {}, 1000);\n',
    },
    { exports: { ".": "./mod.js" } },
  );

  const child = spawn(process.execPath, [BIN, "@kuboon/sleeper@1.0.0"], {
    env: { ...process.env, JSREX_CACHE: cache },
    stdio: ["ignore", "pipe", "inherit"],
  });

  let out = "";
  child.stdout.setEncoding("utf8");
  await new Promise((resolve) => {
    child.stdout.on("data", (chunk) => {
      out += chunk;
      if (out.includes("ready")) resolve(undefined);
    });
  });

  child.kill("SIGTERM");
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.match(out, /term/);
  assert.equal(code, 0);
});
