# jsr-x

Run a [JSR](https://jsr.io) package with Node.js, the way `deno run jsr:@scope/name`
runs one with Deno.

```sh
npx jsr-x @kuboon/package
```

is the Node equivalent of

```sh
deno run jsr:@kuboon/package
```

No install step, no `package.json`, no `node_modules` in your project: the package
is fetched into a shared cache and executed.

## Usage

```sh
npx jsr-x [options] <@scope/name[@version][/entrypoint]> [args...]
```

```sh
# Latest version, default export
npx jsr-x @kuboon/package

# A pinned version, with arguments for the program
npx jsr-x @kuboon/package@1.2.3 --flag value

# A range and a named export, with the jsr: scheme spelled out
npx jsr-x jsr:@std/http@^1/file-server ./public
```

Arguments after the specifier belong to the program and are passed through
untouched, so `--help` after the specifier is the program's help, not `jsr-x`'s.
The program's exit code becomes `jsr-x`'s exit code.

Installing it globally drops the `npx`:

```sh
npm install -g jsr-x
jsr-x @kuboon/package
```

### Options

Options are recognised only *before* the specifier. An unknown option is an
error — use `--` if the program's own first argument looks like one.

| Option | Effect |
| --- | --- |
| `-h`, `--help` | Show usage. |
| `-V`, `--version` | Show the `jsr-x` version. |
| `-q`, `--quiet` | Silence installation output. |
| `--refresh` | Re-install even when the version is already cached. |
| `--offline` | Never reach the network; resolve against the cache only. |
| `--print-entry` | Print the resolved entry file instead of running it. |
| `--cache-dir` | Print the cache directory and exit. |
| `--` | End option parsing. |

### Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `JSR_X_CACHE` | OS cache dir + `/jsr-x` | Where packages are cached. |
| `JSR_URL` | `https://jsr.io` | JSR registry used for version resolution. |
| `JSR_NPM_URL` | `https://npm.jsr.io` | JSR npm-compatibility registry used for downloads. |

`jsr-x` sets `JSR_X=1` in the child process, so a program can tell it was
launched this way.

## How it works

1. The specifier is parsed into a package, a version range and an export subpath.
2. The version is resolved against `https://jsr.io/@scope/name/meta.json` — an
   exact version skips this, so pinned runs need no round trip. Yanked versions
   are ignored.
3. `@scope/name` is installed as `@jsr/scope__name` from
   [npm.jsr.io](https://npm.jsr.io), JSR's npm-compatibility registry, using
   `npm install` in a private cache directory. That registry serves JSR packages
   transpiled to JavaScript with their dependencies resolved, which is what makes
   them runnable on Node at all.
4. The export subpath is resolved through the installed package's `exports` map
   (honouring the `node`, `import`, `module`, `default` and `require` conditions),
   falling back to `module`/`main`.
5. The resolved file is run in a child `node` process with your arguments.

Each resolved version is installed once and reused, and installs are staged in a
temporary directory and moved into place, so concurrent runs never see a partial
tree. `npm` output goes to stderr — the program's stdout stays clean for piping.

## Limitations

The package runs on Node, not Deno, so **Deno APIs are not available**. A package
that reaches for `Deno.readTextFile`, `Deno.serve`, `Deno.env` or any other
`Deno.*` global will fail at runtime. Packages that stick to web standards
(`fetch`, `URL`, `crypto`, streams) and to `node:` built-ins work as they do
under Deno.

Two more consequences of running on Node:

- There is no permission sandbox. Deno's permission flags are not accepted —
  `jsr-x -A @scope/name` is an error rather than a lie — and the program has
  whatever access your Node process has.
- `npm` must be on `PATH`; it does the downloading and dependency resolution.

Requires Node.js 20.11 or newer.

## Development

```sh
npm test
```

The test suite covers specifier parsing, semver range matching, export
resolution, CLI argument handling, an end-to-end run against a seeded cache, and
a real `npm install` against a throwaway registry served from localhost. It needs
no network access.

## License

MIT
