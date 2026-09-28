const esbuild = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",
  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location == null) return;
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log("[watch] build finished");
    });
  },
};

/** Copies each webview's plain CSS file alongside its bundled JS after every rebuild. */
function copyWebviewAssetsPlugin(assets) {
  return {
    name: "copy-webview-assets",
    setup(build) {
      build.onEnd(() => {
        for (const { from, to } of assets) {
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.copyFileSync(from, to);
        }
      });
    },
  };
}

async function buildExtension() {
  return esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.js",
    external: ["vscode"],
    logLevel: "warning",
    plugins: [esbuildProblemMatcherPlugin],
  });
}

async function buildWebviews() {
  return esbuild.context({
    entryPoints: {
      connectionDialog: "src/connectionDialog/webview/main.ts",
      resultsPane: "src/resultsPane/webview/main.ts",
    },
    bundle: true,
    format: "iife",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "browser",
    outdir: "dist/webviews",
    logLevel: "warning",
    plugins: [
      esbuildProblemMatcherPlugin,
      copyWebviewAssetsPlugin([
        {
          from: "src/connectionDialog/webview/main.css",
          to: "dist/webviews/connectionDialog.css",
        },
        {
          from: "src/resultsPane/webview/main.css",
          to: "dist/webviews/resultsPane.css",
        },
      ]),
    ],
  });
}

async function main() {
  const contexts = await Promise.all([buildExtension(), buildWebviews()]);

  if (watch) {
    await Promise.all(contexts.map((ctx) => ctx.watch()));
  } else {
    await Promise.all(contexts.map((ctx) => ctx.rebuild()));
    await Promise.all(contexts.map((ctx) => ctx.dispose()));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
