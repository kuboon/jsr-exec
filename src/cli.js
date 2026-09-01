/** Argument parsing and the top-level `jsr-exec` command. */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  cacheRoot,
  cachedVersions,
  install,
  installedPackagePath,
  isInstalled,
  packageDir,
} from "./cache.js";
import { resolveEntrypoint } from "./entrypoint.js";
import { resolveVersion } from "./registry.js";
import { isVersion, maxSatisfying } from "./semver.js";
import { looksLikeSpec, parseSpec } from "./spec.js";

/** Deno flags that have no meaning on Node; accepted so muscle memory works. */
const IGNORED_DENO_FLAGS =
  /^(-A|-[RWNESI]|--allow-[a-z-]+|--deny-[a-z-]+|--no-prompt|--no-check|--no-lock|--no-config|--cached-only|--unstable(-[a-z-]+)?)(=.*)?$/;

export const USAGE = `jsr-exec — run a JSR package with Node.js

Usage:
  jsr-exec [options] <@scope/name[@version][/entrypoint]> [args...]

Examples:
  npx @kuboon/jsr-exec @kuboon/package
  npx @kuboon/jsr-exec @kuboon/package@1.2.3 --flag value
  npx @kuboon/jsr-exec jsr:@std/http@^1/file-server ./public

Options:
  -h, --help            Show this help.
  -V, --version         Show the jsr-exec version.
  -q, --quiet           Silence installation output.
      --refresh         Re-install even if the version is already cached.
      --offline         Fail instead of reaching the network.
      --print-entry     Print the resolved entry file instead of running it.
      --cache-dir       Print the cache directory and exit.
  --                    End option parsing; everything after is the specifier.

Environment:
  JSR_EXEC_CACHE   Cache directory (default: the OS cache dir + /jsr-exec).
  JSR_URL          JSR registry base URL (default: https://jsr.io).
  JSR_NPM_URL      JSR npm-compat registry (default: https://npm.jsr.io).

Deno permission flags (-A, --allow-*, --unstable-*, ...) are accepted and
ignored: Node has no permission system, and Deno-only APIs are not available.
`;

/**
 * @typedef {object} ParsedArgs
 * @property {"run"|"help"|"version"|"cache-dir"} action
 * @property {string} [spec]
 * @property {string[]} args
 * @property {boolean} quiet
 * @property {boolean} refresh
 * @property {boolean} offline
 * @property {boolean} printEntry
 */

/**
 * Parse the command line. Options are only recognised before the specifier;
 * everything after it belongs to the program being run.
 *
 * @param {string[]} argv
 * @returns {ParsedArgs}
 */
export function parseArgs(argv) {
  /** @type {ParsedArgs} */
  const parsed = {
    action: "run",
    args: [],
    quiet: false,
    refresh: false,
    offline: false,
    printEntry: false,
  };

  let i = 0;
  for (; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      i++;
      break;
    }
    if (!arg.startsWith("-") || looksLikeSpec(arg)) break;

    switch (arg) {
      case "-h":
      case "--help":
        return { ...parsed, action: "help" };
      case "-V":
      case "--version":
        return { ...parsed, action: "version" };
      case "--cache-dir":
        return { ...parsed, action: "cache-dir" };
      case "-q":
      case "--quiet":
        parsed.quiet = true;
        break;
      case "--refresh":
      case "--reload":
        parsed.refresh = true;
        break;
      case "--offline":
        parsed.offline = true;
        break;
      case "--print-entry":
        parsed.printEntry = true;
        break;
      default:
        if (IGNORED_DENO_FLAGS.test(arg)) break;
        throw new Error(
          `unknown option: ${arg}\npass it to the program by putting it after the package specifier`,
        );
    }
  }

  if (i < argv.length) {
    parsed.spec = argv[i];
    parsed.args = argv.slice(i + 1);
  }
  return parsed;
}

function ownVersion() {
  const manifest = path.join(fileURLToPath(new URL("..", import.meta.url)), "package.json");
  try {
    return JSON.parse(fs.readFileSync(manifest, "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Run the resolved entry file in a child Node process and settle with its exit
 * status, so `jsr-exec` is transparent to shells and CI.
 *
 * @param {string} entry
 * @param {string[]} args
 * @returns {Promise<number>}
 */
function runEntry(entry, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      stdio: "inherit",
      env: { ...process.env, JSR_EXEC: "1" },
    });

    // Hold signals so the program gets a chance to shut down cleanly; without
    // this the wrapper would die first and orphan it.
    const forwarded = /** @type {const} */ (["SIGINT", "SIGTERM", "SIGHUP"]);
    /** @param {NodeJS.Signals} signal */
    const forward = (signal) => {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    };
    const handlers = forwarded.map((signal) => {
      const handler = () => forward(signal);
      process.on(signal, handler);
      return /** @type {const} */ ([signal, handler]);
    });
    const release = () => {
      for (const [signal, handler] of handlers) process.off(signal, handler);
    };

    child.on("error", (error) => {
      release();
      reject(error);
    });
    child.on("close", (code, signal) => {
      release();
      if (signal) {
        const number = os.constants.signals[signal];
        resolve(number === undefined ? 1 : 128 + number);
        return;
      }
      resolve(code ?? 0);
    });
  });
}

/**
 * @param {string[]} argv Arguments after the executable and script name.
 * @returns {Promise<number>} Process exit code.
 */
export async function main(argv) {
  const options = parseArgs(argv);

  if (options.action === "help") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (options.action === "version") {
    process.stdout.write(`${ownVersion()}\n`);
    return 0;
  }
  if (options.action === "cache-dir") {
    process.stdout.write(`${cacheRoot()}\n`);
    return 0;
  }
  if (!options.spec) {
    process.stderr.write(USAGE);
    return 1;
  }

  const spec = parseSpec(options.spec);
  const dir = await prepare(spec, options);
  const entry = resolveEntrypoint(installedPackagePath(dir, spec), spec.entrypoint);

  if (options.printEntry) {
    process.stdout.write(`${entry}\n`);
    return 0;
  }
  return runEntry(entry, options.args);
}

/**
 * Resolve the version and make sure it is present in the cache.
 * @param {import("./spec.js").Spec} spec
 * @param {ParsedArgs} options
 */
async function prepare(spec, options) {
  const exact = spec.range !== null && isVersion(spec.range);

  // An exact version that is already cached needs no registry round trip,
  // which keeps repeat runs fast and works with no network at all.
  if (exact && !options.refresh) {
    const dir = packageDir(spec, spec.range ?? "");
    if (isInstalled(dir, spec)) return dir;
  }

  const version = options.offline && !exact
    ? resolveFromCache(spec)
    : await resolveVersion(spec);

  const dir = packageDir(spec, version);
  if (options.refresh && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (!options.quiet && !isInstalled(dir, spec)) {
    process.stderr.write(`jsr-exec: installing ${spec.pkg}@${version}\n`);
  }
  return install(spec, version, { quiet: options.quiet, offline: options.offline });
}

/**
 * Pick the newest already-installed version matching the specifier, so
 * `--offline` never reaches the registry.
 * @param {import("./spec.js").Spec} spec
 */
function resolveFromCache(spec) {
  const installed = cachedVersions(spec).filter((version) =>
    isInstalled(packageDir(spec, version), spec)
  );
  const match = maxSatisfying(installed, spec.range ?? "*");
  if (!match) {
    throw new Error(
      `no cached version of ${spec.pkg} matches ${spec.range ?? "*"} and --offline was given` +
        (installed.length ? `\ncached: ${installed.join(", ")}` : ""),
    );
  }
  return match;
}
