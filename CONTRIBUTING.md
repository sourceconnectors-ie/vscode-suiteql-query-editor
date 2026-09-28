# Contributing

## Prerequisites

Node.js 22 or newer — `@monty-nabil/netsuite-api-client-ts` requires it (releases are
validated on Node.js 24).

## Setting up

```bash
npm ci
```

`@monty-nabil/netsuite-api-client-ts` is an ordinary published devDependency — bundled
into `dist/extension.js` by esbuild, so it isn't needed at runtime in the `.vsix`. No
linking or sibling checkout required.

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

## Testing

Tests run through `@vscode/test-cli` and Mocha in a real, headless Extension Development
Host — see `.vscode-test.mjs` and `src/test/`. Prefer that over mocking the `vscode` API.
Pure logic with no `vscode` import (the schema cache, the completion provider's scope
heuristic, connection profile handling) can be tested directly.

Behaviour that belongs to the library rather than the extension is tested in the library's
own suite, where it runs without a VS Code host.

## Packaging

```bash
npx vsce package
```

Check the file list with `npx vsce ls` before publishing. Only `dist/`, the manifest, and
static assets should ship: everything is bundled by esbuild, so `node_modules/` and
`src/` are excluded via `.vscodeignore`.

Still outstanding before a real Marketplace publish: a chosen license and `LICENSE` file.
`vsce` warns about this but still succeeds.
