import assert from "node:assert/strict";
import { test } from "node:test";

import { parseArgs } from "../src/cli.js";

test("splits jsr-exec options from program arguments", () => {
  const parsed = parseArgs(["--quiet", "@kuboon/package", "--flag", "-q", "value"]);
  assert.equal(parsed.action, "run");
  assert.equal(parsed.quiet, true);
  assert.equal(parsed.spec, "@kuboon/package");
  assert.deepEqual(parsed.args, ["--flag", "-q", "value"]);
});

test("recognises the informational actions", () => {
  assert.equal(parseArgs(["--help"]).action, "help");
  assert.equal(parseArgs(["-h"]).action, "help");
  assert.equal(parseArgs(["--version"]).action, "version");
  assert.equal(parseArgs(["--cache-dir"]).action, "cache-dir");
});

test("stops option parsing at --", () => {
  const parsed = parseArgs(["--", "@kuboon/package", "--refresh"]);
  assert.equal(parsed.refresh, false);
  assert.equal(parsed.spec, "@kuboon/package");
  assert.deepEqual(parsed.args, ["--refresh"]);
});

test("ignores Deno permission flags", () => {
  const parsed = parseArgs(["-A", "--allow-net=example.com", "--unstable-kv", "@kuboon/package"]);
  assert.equal(parsed.spec, "@kuboon/package");
  assert.deepEqual(parsed.args, []);
});

test("rejects unknown options before the specifier", () => {
  assert.throws(() => parseArgs(["--nope", "@kuboon/package"]), /unknown option: --nope/);
});

test("reports no specifier when only options are given", () => {
  assert.equal(parseArgs([]).spec, undefined);
  assert.equal(parseArgs(["--quiet"]).spec, undefined);
});
