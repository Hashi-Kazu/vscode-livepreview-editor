// Build script: bundles the extension host (Node/CJS) and the Webview
// (browser/IIFE, with CodeMirror) in one pass.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * Copy KaTeX's stylesheet and web fonts into media/katex/ so the Webview can
 * serve them as local resources (R-32). The KaTeX JS itself is bundled into
 * dist/webview.js by esbuild; only the CSS + fonts need copying. The
 * stylesheet's relative `fonts/…` url()s resolve against media/katex/fonts/.
 */
function copyKatexAssets() {
  const src = path.join(__dirname, 'node_modules', 'katex', 'dist');
  const dest = path.join(__dirname, 'media', 'katex');
  const fontsSrc = path.join(src, 'fonts');
  const fontsDest = path.join(dest, 'fonts');
  fs.mkdirSync(fontsDest, { recursive: true });
  fs.copyFileSync(path.join(src, 'katex.min.css'), path.join(dest, 'katex.min.css'));
  for (const file of fs.readdirSync(fontsSrc)) {
    fs.copyFileSync(path.join(fontsSrc, file), path.join(fontsDest, file));
  }
}

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  outfile: 'dist/webview.js',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

async function main() {
  copyKatexAssets();
  if (watch) {
    const ctxExt = await esbuild.context(extensionConfig);
    const ctxWeb = await esbuild.context(webviewConfig);
    await Promise.all([ctxExt.watch(), ctxWeb.watch()]);
    console.log('watching…');
  } else {
    await Promise.all([esbuild.build(extensionConfig), esbuild.build(webviewConfig)]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
