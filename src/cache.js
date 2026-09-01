/** Cache location and npm-backed installation of JSR packages. */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { npmRegistry } from "./registry.js";

/** Root directory holding one installation tree per resolved package version. */
export function cacheRoot() {
  const override = process.env.JSR_EXEC_CACHE;
  if (override) return path.resolve(override);

  const home = os.homedir();
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return path.join(base, "jsr-exec", "Cache");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Caches", "jsr-exec");
  }
  const xdg = process.env.XDG_CACHE_HOME;
  return path.join(xdg && path.isAbsolute(xdg) ? xdg : path.join(home, ".cache"), "jsr-exec");
}

/**
 * Directory for one resolved package version.
 * @param {import("./spec.js").Spec} spec
 * @param {string} version
 */
export function packageDir(spec, version) {
  return path.join(cacheRoot(), "pkgs", `${spec.scope}__${spec.name}`, version);
}

/**
 * Path of the installed package inside a cache entry.
 * @param {string} dir
 * @param {import("./spec.js").Spec} spec
 */
export function installedPackagePath(dir, spec) {
  return path.join(dir, "node_modules", spec.npmName);
}

/** Marker written last, so a half-finished install is never treated as usable. */
const STAMP = ".jsr-exec-complete";

/**
 * @param {string} dir
 * @param {import("./spec.js").Spec} spec
 */
export function isInstalled(dir, spec) {
  return (
    fs.existsSync(path.join(dir, STAMP)) &&
    fs.existsSync(path.join(installedPackagePath(dir, spec), "package.json"))
  );
}

/**
 * Install `@jsr/scope__name@version` from the JSR npm-compatibility registry
 * into a fresh directory, then move it into the cache.
 *
 * The install happens in a sibling temp directory and is renamed into place so
 * concurrent `jsr-exec` runs never observe a partial tree.
 *
 * @param {import("./spec.js").Spec} spec
 * @param {string} version
 * @param {{ quiet?: boolean, offline?: boolean }} [options]
 * @returns {string} The cache directory for this version.
 */
export function install(spec, version, options = {}) {
  const dest = packageDir(spec, version);
  if (isInstalled(dest, spec)) return dest;

  if (options.offline) {
    throw new Error(
      `${spec.pkg}@${version} is not in the cache and --offline was given`,
    );
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const staging = fs.mkdtempSync(`${dest}.tmp-`);

  try {
    fs.writeFileSync(
      path.join(staging, "package.json"),
      `${JSON.stringify(
        {
          name: `jsr-exec-${spec.scope}-${spec.name}`,
          version: "0.0.0",
          private: true,
          dependencies: { [spec.npmName]: version },
        },
        null,
        2,
      )}\n`,
    );
    // Scope the JSR registry to this install only, so a user's own npm config
    // (a private default registry, say) is left untouched.
    fs.writeFileSync(
      path.join(staging, ".npmrc"),
      `@jsr:registry=${npmRegistry()}\n`,
    );

    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = spawnSync(
      npm,
      [
        "install",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        "--loglevel",
        options.quiet ? "error" : "warn",
        "--progress=false",
      ],
      {
        cwd: staging,
        // npm's progress output is captured and relayed to stderr: stdout
        // belongs to the program being run, so it stays pipeable.
        stdio: ["ignore", "pipe", "inherit"],
        encoding: "utf8",
        shell: process.platform === "win32",
      },
    );

    if (!options.quiet && result.stdout) process.stderr.write(result.stdout);

    if (result.error) {
      const cause = /** @type {NodeJS.ErrnoException} */ (result.error);
      if (cause.code === "ENOENT") {
        throw new Error("npm was not found on PATH; jsr-exec needs npm to install packages");
      }
      throw cause;
    }
    if (result.status !== 0) {
      throw new Error(`npm install ${spec.npmName}@${version} failed (exit ${result.status})`);
    }
    if (!fs.existsSync(path.join(installedPackagePath(staging, spec), "package.json"))) {
      throw new Error(`npm did not install ${spec.npmName}@${version}`);
    }

    fs.writeFileSync(path.join(staging, STAMP), `${new Date().toISOString()}\n`);

    try {
      fs.renameSync(staging, dest);
    } catch (err) {
      // Another process may have finished the same install first; that is fine.
      if (!isInstalled(dest, spec)) throw err;
      fs.rmSync(staging, { recursive: true, force: true });
    }
    return dest;
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw err;
  }
}

/**
 * Versions of a package already present in the cache, in no particular order.
 * @param {import("./spec.js").Spec} spec
 * @returns {string[]}
 */
export function cachedVersions(spec) {
  const dir = path.join(cacheRoot(), "pkgs", `${spec.scope}__${spec.name}`);
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
