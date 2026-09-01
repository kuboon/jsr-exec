/** Version resolution against the JSR registry metadata API. */

import { isVersion, maxSatisfying } from "./semver.js";

export const DEFAULT_JSR_REGISTRY = "https://jsr.io";
export const DEFAULT_NPM_REGISTRY = "https://npm.jsr.io";

/** @param {string} base */
function normalizeBase(base) {
  return base.replace(/\/+$/, "");
}

export function jsrRegistry() {
  return normalizeBase(process.env.JSR_URL || DEFAULT_JSR_REGISTRY);
}

export function npmRegistry() {
  return normalizeBase(process.env.JSR_NPM_URL || DEFAULT_NPM_REGISTRY);
}

/**
 * @typedef {object} PackageMeta
 * @property {string} [latest]
 * @property {Record<string, { yanked?: boolean }>} versions
 */

/**
 * Fetch `/@scope/name/meta.json` from the JSR registry.
 * @param {import("./spec.js").Spec} spec
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<PackageMeta>}
 */
export async function fetchMeta(spec, options = {}) {
  const url = `${jsrRegistry()}/${spec.pkg}/meta.json`;
  const res = await fetch(url, {
    signal: options.signal,
    headers: { accept: "application/json" },
  });
  if (res.status === 404) {
    throw new Error(`package not found on JSR: ${spec.pkg}`);
  }
  if (!res.ok) {
    throw new Error(`failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  const meta = /** @type {PackageMeta} */ (await res.json());
  if (!meta || typeof meta !== "object" || typeof meta.versions !== "object") {
    throw new Error(`unexpected metadata from ${url}`);
  }
  return meta;
}

/**
 * Pick the version to install for a specifier.
 *
 * An exact version needs no network round trip; anything else (a range, or no
 * version at all) is resolved against the registry's published versions, with
 * yanked ones skipped.
 *
 * @param {import("./spec.js").Spec} spec
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<string>}
 */
export async function resolveVersion(spec, options = {}) {
  if (spec.range !== null && isVersion(spec.range)) return spec.range;

  const meta = await fetchMeta(spec, options);
  const available = Object.entries(meta.versions)
    .filter(([, info]) => !info?.yanked)
    .map(([version]) => version);

  if (spec.range === null) {
    if (meta.latest && available.includes(meta.latest)) return meta.latest;
    const newest = maxSatisfying(available, "*");
    if (newest) return newest;
    throw new Error(`no published versions for ${spec.pkg}`);
  }

  const match = maxSatisfying(available, spec.range);
  if (!match) {
    throw new Error(
      `no version of ${spec.pkg} matches ${spec.range}` +
        (available.length ? `\navailable: ${available.sort().join(", ")}` : ""),
    );
  }
  return match;
}
