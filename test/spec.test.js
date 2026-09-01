import assert from "node:assert/strict";
import { test } from "node:test";

import { looksLikeSpec, parseSpec } from "../src/spec.js";

test("parses a bare package name", () => {
  assert.deepEqual(parseSpec("@kuboon/package"), {
    scope: "kuboon",
    name: "package",
    pkg: "@kuboon/package",
    npmName: "@jsr/kuboon__package",
    range: null,
    entrypoint: ".",
  });
});

test("parses versions, ranges and entrypoints", () => {
  assert.equal(parseSpec("@kuboon/package@1.2.3").range, "1.2.3");
  assert.equal(parseSpec("@kuboon/package@^1.2").range, "^1.2");
  assert.equal(parseSpec("@kuboon/package/cli").entrypoint, "./cli");
  assert.equal(parseSpec("@kuboon/package@1.2.3/bin/run").entrypoint, "./bin/run");
  assert.equal(parseSpec("@kuboon/package@1.2.3/bin/run").range, "1.2.3");
  assert.equal(parseSpec("@kuboon/package/").entrypoint, ".");
});

test("accepts the jsr: scheme in both spellings", () => {
  assert.equal(parseSpec("jsr:@std/http").pkg, "@std/http");
  assert.equal(parseSpec("jsr:/@std/http@^1/file-server").entrypoint, "./file-server");
  assert.equal(parseSpec("jsr:/@std/http@^1/file-server").range, "^1");
});

test("maps to the npm-compat name", () => {
  assert.equal(parseSpec("@std/http").npmName, "@jsr/std__http");
});

test("rejects specifiers that are not JSR packages", () => {
  assert.throws(() => parseSpec("chalk"), SyntaxError);
  assert.throws(() => parseSpec("@kuboon"), SyntaxError);
  assert.throws(() => parseSpec("npm:@kuboon/package"), SyntaxError);
});

test("looksLikeSpec distinguishes specifiers from flags", () => {
  assert.ok(looksLikeSpec("@kuboon/package"));
  assert.ok(looksLikeSpec("jsr:@kuboon/package"));
  assert.ok(!looksLikeSpec("--quiet"));
  assert.ok(!looksLikeSpec("-A"));
});
