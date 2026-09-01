/**
 * Minimal semver comparison and range matching.
 *
 * Supports the subset of npm range syntax that JSR specifiers use in practice:
 * exact versions, `*`, `x`-wildcards, `^`, `~`, comparators (`>` `>=` `<` `<=`
 * `=`), hyphen ranges, whitespace-joined AND, and `||`-joined OR.
 */

const VERSION_RE =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?(?:\+([0-9A-Za-z-.]+))?$/;

/** @typedef {{ major: number, minor: number, patch: number, prerelease: (string|number)[] }} Version */

/**
 * Parse a semver string, returning `null` when it is not a valid version.
 * @param {string} raw
 * @returns {Version | null}
 */
export function parseVersion(raw) {
  const m = VERSION_RE.exec(String(raw).trim());
  if (!m) return null;
  const prerelease = m[4]
    ? m[4].split(".").map((id) => (/^\d+$/.test(id) ? Number(id) : id))
    : [];
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease,
  };
}

/** @param {string} raw */
export function isVersion(raw) {
  return parseVersion(raw) !== null;
}

/**
 * Compare two prerelease identifier lists per semver §11.
 * @param {(string|number)[]} a
 * @param {(string|number)[]} b
 */
function comparePrerelease(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  // A version without a prerelease outranks one with it.
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNum = typeof x === "number";
    const yNum = typeof y === "number";
    if (xNum && yNum) return x < y ? -1 : 1;
    if (xNum) return -1;
    if (yNum) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Compare two versions. Returns -1, 0 or 1.
 * @param {Version | string} a
 * @param {Version | string} b
 */
export function compare(a, b) {
  const va = typeof a === "string" ? parseVersion(a) : a;
  const vb = typeof b === "string" ? parseVersion(b) : b;
  if (!va || !vb) throw new TypeError("cannot compare invalid versions");
  for (const key of /** @type {const} */ (["major", "minor", "patch"])) {
    if (va[key] !== vb[key]) return va[key] < vb[key] ? -1 : 1;
  }
  return comparePrerelease(va.prerelease, vb.prerelease);
}

/**
 * Expand a possibly partial version (`1`, `1.2`, `1.x`) into its bounds.
 * @param {string} raw
 * @returns {{ major: number|null, minor: number|null, patch: number|null, prerelease: (string|number)[] }}
 */
function parsePartial(raw) {
  const trimmed = raw.trim().replace(/^v/, "");
  if (trimmed === "" || trimmed === "*" || /^[xX*]$/.test(trimmed)) {
    return { major: null, minor: null, patch: null, prerelease: [] };
  }
  const m = /^(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z-.]+))?(?:\+[0-9A-Za-z-.]+)?$/
    .exec(trimmed);
  if (!m) throw new SyntaxError(`invalid version or range: ${raw}`);
  const num = (/** @type {string|undefined} */ s) =>
    s === undefined || /^[xX*]$/.test(s) ? null : Number(s);
  const prerelease = m[4]
    ? m[4].split(".").map((id) => (/^\d+$/.test(id) ? Number(id) : id))
    : [];
  return { major: num(m[1]), minor: num(m[2]), patch: num(m[3]), prerelease };
}

/** @param {ReturnType<typeof parsePartial>} p */
function toVersion(p) {
  return {
    major: p.major ?? 0,
    minor: p.minor ?? 0,
    patch: p.patch ?? 0,
    prerelease: p.prerelease,
  };
}

/**
 * A single comparator: an operator plus a concrete version.
 * @typedef {{ op: "<"|"<="|">"|">="|"=", version: Version }} Comparator
 */

/**
 * Expand one range atom (`^1.2`, `~0.3.1`, `>=1.0.0`, `1.x`) into comparators.
 * @param {string} atom
 * @returns {Comparator[]}
 */
function expandAtom(atom) {
  const opMatch = /^(<=|>=|<|>|=)?\s*(.*)$/.exec(atom.trim());
  if (!opMatch) throw new SyntaxError(`invalid range: ${atom}`);
  const [, rawOp, rest] = opMatch;

  if (rest.startsWith("^") || rest.startsWith("~")) {
    const caret = rest[0] === "^";
    const p = parsePartial(rest.slice(1));
    if (p.major === null) return [];
    const lower = toVersion(p);
    /** @type {Version} */
    let upper;
    if (caret) {
      // ^0.2.x is bounded at 0.3.0; ^0.0.3 at 0.0.4; ^1.2.3 at 2.0.0.
      if (p.major !== 0) upper = { major: p.major + 1, minor: 0, patch: 0, prerelease: [] };
      else if (p.minor === null) upper = { major: 1, minor: 0, patch: 0, prerelease: [] };
      else if (p.minor !== 0 || p.patch === null) {
        upper = { major: 0, minor: p.minor + 1, patch: 0, prerelease: [] };
      } else upper = { major: 0, minor: 0, patch: p.patch + 1, prerelease: [] };
    } else if (p.minor === null) {
      upper = { major: p.major + 1, minor: 0, patch: 0, prerelease: [] };
    } else {
      upper = { major: p.major, minor: p.minor + 1, patch: 0, prerelease: [] };
    }
    return [{ op: ">=", version: lower }, { op: "<", version: upper }];
  }

  const p = parsePartial(rest);
  const op = rawOp ?? "=";

  if (p.major === null) return op === "=" ? [] : [];
  const complete = p.minor !== null && p.patch !== null;

  if (op === ">" || op === ">=" || op === "<" || op === "<=") {
    // Partial bounds round toward the side that keeps the comparator inclusive
    // of the whole partial range: `>1.2` means `>=1.3.0`, `<=1.2` means `<1.3.0`.
    if (complete) return [{ op, version: toVersion(p) }];
    const lower = toVersion(p);
    const upper = p.minor === null
      ? { major: p.major + 1, minor: 0, patch: 0, prerelease: [] }
      : { major: p.major, minor: p.minor + 1, patch: 0, prerelease: [] };
    if (op === ">=") return [{ op: ">=", version: lower }];
    if (op === ">") return [{ op: ">=", version: upper }];
    if (op === "<") return [{ op: "<", version: lower }];
    return [{ op: "<", version: upper }];
  }

  if (complete) return [{ op: "=", version: toVersion(p) }];
  const lower = toVersion(p);
  const upper = p.minor === null
    ? { major: p.major + 1, minor: 0, patch: 0, prerelease: [] }
    : { major: p.major, minor: p.minor + 1, patch: 0, prerelease: [] };
  return [{ op: ">=", version: lower }, { op: "<", version: upper }];
}

/**
 * Parse a range into a disjunction of comparator sets.
 * @param {string} range
 * @returns {Comparator[][]}
 */
function parseRange(range) {
  return range.split("||").map((clause) => {
    const trimmed = clause.trim();
    if (trimmed === "" || trimmed === "*") return [];
    const hyphen = /^([^\s]+)\s+-\s+([^\s]+)$/.exec(trimmed);
    if (hyphen) {
      return [...expandAtom(`>=${hyphen[1]}`), ...expandAtom(`<=${hyphen[2]}`)];
    }
    return trimmed
      .split(/\s+/)
      .flatMap((atom) => expandAtom(atom));
  });
}

/**
 * @param {Version} version
 * @param {Comparator} comparator
 */
function testComparator(version, comparator) {
  const c = compare(version, comparator.version);
  switch (comparator.op) {
    case "<":
      return c < 0;
    case "<=":
      return c <= 0;
    case ">":
      return c > 0;
    case ">=":
      return c >= 0;
    default:
      return c === 0;
  }
}

/**
 * Does `version` satisfy `range`?
 *
 * Follows npm's prerelease rule: a prerelease version only matches when the
 * range itself names a prerelease on the same `major.minor.patch` tuple.
 *
 * @param {string} version
 * @param {string} range
 */
export function satisfies(version, range) {
  const v = parseVersion(version);
  if (!v) return false;
  const clauses = parseRange(range);
  return clauses.some((comparators) => {
    if (!comparators.every((c) => testComparator(v, c))) return false;
    if (v.prerelease.length === 0) return true;
    return comparators.some((c) =>
      c.version.prerelease.length > 0 &&
      c.version.major === v.major &&
      c.version.minor === v.minor &&
      c.version.patch === v.patch
    );
  });
}

/**
 * Highest version in `versions` satisfying `range`, or `null`.
 * @param {Iterable<string>} versions
 * @param {string} range
 */
export function maxSatisfying(versions, range) {
  /** @type {string | null} */
  let best = null;
  for (const candidate of versions) {
    if (!isVersion(candidate)) continue;
    if (!satisfies(candidate, range)) continue;
    if (best === null || compare(candidate, best) > 0) best = candidate;
  }
  return best;
}
