/** Resolving an export subpath to a runnable file inside an installed package. */

import fs from "node:fs";
import path from "node:path";

/** Condition names we honour, in preference order. */
const CONDITIONS = ["node", "import", "module", "default", "require"];

/**
 * Walk a conditional-exports value down to a relative file path.
 * @param {unknown} value
 * @param {string} [wildcard] Substring to substitute for `*` in the target.
 * @returns {string | null}
 */
function resolveConditions(value, wildcard) {
  if (typeof value === "string") {
    return wildcard === undefined ? value : value.replaceAll("*", wildcard);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const resolved = resolveConditions(entry, wildcard);
      if (resolved) return resolved;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const record = /** @type {Record<string, unknown>} */ (value);
    for (const condition of CONDITIONS) {
      if (condition in record) {
        const resolved = resolveConditions(record[condition], wildcard);
        if (resolved) return resolved;
      }
    }
  }
  return null;
}

/**
 * Match `subpath` against an exports map, including `./*` patterns.
 * @param {Record<string, unknown>} exports
 * @param {string} subpath
 * @returns {string | null}
 */
function resolveFromExportsMap(exports, subpath) {
  if (subpath in exports) return resolveConditions(exports[subpath]);

  /** @type {{ key: string, wildcard: string } | null} */
  let best = null;
  for (const key of Object.keys(exports)) {
    const star = key.indexOf("*");
    if (star === -1) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    if (subpath.length < prefix.length + suffix.length) continue;
    // The longest static prefix wins, matching Node's own resolution.
    if (best === null || prefix.length > best.key.indexOf("*")) {
      best = { key, wildcard: subpath.slice(prefix.length, subpath.length - suffix.length) };
    }
  }
  return best ? resolveConditions(exports[best.key], best.wildcard) : null;
}

/**
 * Resolve the file `jsr-x` should hand to Node.
 *
 * Mirrors what `deno run jsr:@scope/name[/sub]` does: the specifier's export
 * subpath is looked up in the package's own export map, falling back to the
 * legacy `main`/`module` fields for packages that predate `exports`.
 *
 * @param {string} pkgPath Directory of the installed package.
 * @param {string} subpath `.` or `./sub/path`.
 * @returns {string} Absolute path of the entry file.
 */
export function resolveEntrypoint(pkgPath, subpath) {
  const manifestPath = path.join(pkgPath, "package.json");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (err) {
    throw new Error(`cannot read ${manifestPath}: ${/** @type {Error} */ (err).message}`);
  }

  /** @type {string | null} */
  let target = null;
  const exports = manifest.exports;

  if (typeof exports === "string") {
    if (subpath === ".") target = exports;
  } else if (exports && typeof exports === "object" && !Array.isArray(exports)) {
    const keys = Object.keys(exports);
    // An exports object with no "./" keys is a bare condition map for ".".
    const isSubpathMap = keys.some((key) => key === "." || key.startsWith("./"));
    if (isSubpathMap) target = resolveFromExportsMap(exports, subpath);
    else if (subpath === ".") target = resolveConditions(exports);
  }

  if (target === null && subpath === ".") {
    target = manifest.module ?? manifest.main ?? "./index.js";
  }

  if (target === null) {
    const known = exports && typeof exports === "object" && !Array.isArray(exports)
      ? Object.keys(exports).filter((key) => key === "." || key.startsWith("./"))
      : [];
    throw new Error(
      `the package does not export ${subpath}` +
        (known.length ? `\nexported paths: ${known.join(", ")}` : ""),
    );
  }

  const file = path.resolve(pkgPath, target);
  if (!path.resolve(file).startsWith(path.resolve(pkgPath) + path.sep)) {
    throw new Error(`export ${subpath} points outside the package: ${target}`);
  }
  if (!fs.existsSync(file)) {
    throw new Error(`export ${subpath} resolves to a missing file: ${target}`);
  }
  return file;
}
