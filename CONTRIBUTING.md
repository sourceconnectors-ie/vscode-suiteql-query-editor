# Contributing

## Prerequisites

Node.js 20 or newer.

## Setting up

This extension depends on the `netsuite-api-client-ts` library, which is **not published
to npm yet**. Because of that, `npm install` on its own fails — and it fails before
installing anything at all, so you end up with no `node_modules` and nothing to build
with. `npm ci` fails the same way.

Until the library is published, link it first. Clone it as a sibling of this repo, then:

```bash
# in the netsuite-api-client-ts checkout
npm install
npm run build
npm link
```

```bash
# in this repo — this installs everything else too, so no separate npm install
npm link @monty-nabil/netsuite-api-client-ts
```

`npm run build` has to happen before `npm link`: the library's `dist/` is gitignored, and
both the types and the runtime come from it.

Use `npm link`, not `npm install <path>` — the latter writes an absolute, machine-specific
path into `package-lock.json`.

One consequence worth knowing: `package-lock.json` has no entry for the library, so it
will stay slightly out of step with `package.json`, and `npm ci` won't work, until the
package is published.

## Developing

```bash
npm run watch      # esbuild in watch mode
```

Then press F5 (or Run → Start Debugging) to launch an Extension Development Host with the
extension loaded. Reload that window (`Cmd+R` / `Ctrl+R`) after esbuild finishes a rebuild
to pick up changes.

Other scripts:

- `npm run compile` — one-shot build.
- `npm run package` — production build (minified, no sourcemaps).
- `npm run typecheck` — `tsc --noEmit` over the extension and the webviews.
- `npm run lint` — ESLint over `src/`.
- `npm test` — compiles the tests and runs them in a headless Extension Development Host.

If you change the library at the same time, rebuild it (`npm run build` there) before
re-running anything here — the link points at its `dist/`, not its sources.

## Testing

Tests run through `@vscode/test-cli` and Mocha in a real, headless Extension Development
Host — see `.vscode-test.mjs` and `src/test/`. Prefer that over mocking the `vscode` API.
Pure logic with no `vscode` import (the schema cache, the completion provider's scope
heuristic, connection profile handling) can be tested directly.

Behaviour that belongs to the library rather than the extension is tested in the library's
own suite, where it runs without a VS Code host.

## Packaging

```bash
npx vsce package --allow-missing-repository
```

Check the file list with `npx vsce ls` before publishing. Only `dist/`, the manifest, and
static assets should ship: everything is bundled by esbuild, so `node_modules/` and
`src/` are excluded via `.vscodeignore`.

Still outstanding before a real Marketplace publish: a `repository` field in
`package.json`, a chosen license and `LICENSE` file, and a 128x128 PNG icon. `vsce`
warns about all three but still succeeds.
