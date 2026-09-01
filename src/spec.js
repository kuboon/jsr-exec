/** Parsing of JSR package specifiers such as `jsr:@scope/name@^1/cli`. */

const SPEC_RE = /^@([^@/\s]+)\/([^@/\s]+)(?:@([^/\s]+))?(\/.*)?$/;

/**
 * @typedef {object} Spec
 * @property {string} scope      Scope without the leading `@`.
 * @property {string} name       Package name.
 * @property {string} pkg        `@scope/name`.
 * @property {string} npmName    npm-compat name on npm.jsr.io, `@jsr/scope__name`.
 * @property {string | null} range  Version or range as written, `null` when omitted.
 * @property {string} entrypoint Export subpath, `.` or `./sub/path`.
 */

/**
 * Parse a JSR specifier. The `jsr:` scheme prefix is optional, and both
 * `jsr:@scope/name` and `jsr:/@scope/name` are accepted.
 *
 * @param {string} input
 * @returns {Spec}
 */
export function parseSpec(input) {
  let rest = String(input).trim();
  if (rest.startsWith("jsr:")) rest = rest.slice(4);
  if (rest.startsWith("/")) rest = rest.slice(1);

  const m = SPEC_RE.exec(rest);
  if (!m) {
    throw new SyntaxError(
      `invalid JSR specifier: ${input}\nexpected @scope/name[@version][/entrypoint]`,
    );
  }
  const [, scope, name, range, subpath] = m;
  return {
    scope,
    name,
    pkg: `@${scope}/${name}`,
    npmName: `@jsr/${scope}__${name}`,
    range: range ?? null,
    entrypoint: subpath ? `.${subpath.replace(/\/+$/, "")}` : ".",
  };
}

/**
 * Does this argument look like a JSR specifier rather than a flag?
 * @param {string} arg
 */
export function looksLikeSpec(arg) {
  const candidate = arg.startsWith("jsr:") ? arg.slice(4).replace(/^\//, "") : arg;
  return candidate.startsWith("@") && candidate.includes("/");
}
