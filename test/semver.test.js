import assert from "node:assert/strict";
import { test } from "node:test";

import { compare, isVersion, maxSatisfying, satisfies } from "../src/semver.js";

test("compare orders releases and prereleases", () => {
  assert.equal(compare("1.0.0", "1.0.1"), -1);
  assert.equal(compare("1.2.0", "1.10.0"), -1);
  assert.equal(compare("2.0.0", "10.0.0"), -1);
  assert.equal(compare("1.0.0", "1.0.0"), 0);
  assert.equal(compare("1.0.0-alpha", "1.0.0"), -1);
  assert.equal(compare("1.0.0-alpha.1", "1.0.0-alpha.2"), -1);
  assert.equal(compare("1.0.0-alpha.2", "1.0.0-alpha.10"), -1);
  assert.equal(compare("1.0.0-alpha", "1.0.0-beta"), -1);
  assert.equal(compare("1.0.0-1", "1.0.0-alpha"), -1);
  assert.equal(compare("1.0.0+build", "1.0.0"), 0);
});

test("isVersion accepts only complete versions", () => {
  assert.ok(isVersion("1.0.0"));
  assert.ok(isVersion("0.0.0-rc.1"));
  assert.ok(!isVersion("1.0"));
  assert.ok(!isVersion("^1.0.0"));
  assert.ok(!isVersion("latest"));
});

test("caret ranges", () => {
  assert.ok(satisfies("1.2.3", "^1.2.3"));
  assert.ok(satisfies("1.9.0", "^1.2.3"));
  assert.ok(!satisfies("2.0.0", "^1.2.3"));
  assert.ok(!satisfies("1.2.2", "^1.2.3"));
  assert.ok(satisfies("0.2.9", "^0.2.1"));
  assert.ok(!satisfies("0.3.0", "^0.2.1"));
  assert.ok(satisfies("0.0.3", "^0.0.3"));
  assert.ok(!satisfies("0.0.4", "^0.0.3"));
  assert.ok(satisfies("1.5.0", "^1"));
  assert.ok(!satisfies("2.0.0", "^1"));
});

test("tilde ranges", () => {
  assert.ok(satisfies("1.2.9", "~1.2.3"));
  assert.ok(!satisfies("1.3.0", "~1.2.3"));
  assert.ok(satisfies("1.2.0", "~1.2"));
  assert.ok(!satisfies("1.3.0", "~1.2"));
});

test("wildcards and partials", () => {
  assert.ok(satisfies("3.4.5", "*"));
  assert.ok(satisfies("1.4.0", "1.x"));
  assert.ok(!satisfies("2.0.0", "1.x"));
  assert.ok(satisfies("1.2.9", "1.2"));
  assert.ok(!satisfies("1.3.0", "1.2"));
});

test("comparators, conjunction and disjunction", () => {
  assert.ok(satisfies("1.5.0", ">=1.0.0 <2.0.0"));
  assert.ok(!satisfies("2.0.0", ">=1.0.0 <2.0.0"));
  assert.ok(satisfies("0.9.0", "<1.0.0 || >=2.0.0"));
  assert.ok(satisfies("2.1.0", "<1.0.0 || >=2.0.0"));
  assert.ok(!satisfies("1.5.0", "<1.0.0 || >=2.0.0"));
  assert.ok(satisfies("1.3.0", ">1.2"));
  assert.ok(!satisfies("1.2.9", ">1.2"));
  assert.ok(satisfies("1.2.3", "1.0.0 - 1.3.0"));
  assert.ok(!satisfies("1.4.0", "1.0.0 - 1.3.0"));
});

test("prereleases only match ranges that name one", () => {
  assert.ok(!satisfies("2.0.0-rc.1", "^1.0.0 || ^2.0.0"));
  assert.ok(satisfies("2.0.0-rc.2", ">=2.0.0-rc.1 <3"));
  assert.ok(!satisfies("2.1.0-rc.1", ">=2.0.0-rc.1 <3"));
});

test("maxSatisfying picks the highest match and skips junk", () => {
  const versions = ["1.0.0", "1.2.0", "1.10.0", "2.0.0", "not-a-version", "1.11.0-rc.1"];
  assert.equal(maxSatisfying(versions, "^1"), "1.10.0");
  assert.equal(maxSatisfying(versions, "*"), "2.0.0");
  assert.equal(maxSatisfying(versions, "^3"), null);
  assert.equal(maxSatisfying(versions, "1.0.0"), "1.0.0");
});
