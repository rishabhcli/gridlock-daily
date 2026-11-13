// Pure JS/WASM build (esbuild-wasm). No native binaries.
//   node tools/build.mjs           one-off build
//   node tools/build.mjs --watch   rebuild when files under src/ change
import * as esbuild from 'esbuild-wasm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => path.join(root, 'src', p);
const dist = (p) => path.join(root, 'dist', p);
const watch = process.argv.includes('--watch');

await esbuild.initialize({});

async function build() {
  const t0 = Date.now();
  fs.rmSync(dist('client'), { recursive: true, force: true });
  fs.rmSync(dist('server'), { recursive: true, force: true });
  fs.mkdirSync(dist('client'), { recursive: true });
  fs.mkdirSync(dist('server'), { recursive: true });

  // Client: one bundle per entry point (splash is vanilla and tiny, game uses React).
  const client = await esbuild.build({
    absWorkingDir: root,
    entryPoints: { splash: src('client/splash.ts'), game: src('client/game.tsx') },
    outdir: dist('client'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022', 'safari15'],
    jsx: 'automatic',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.png': 'file', '.svg': 'file' },
    logLevel: 'warning',
    metafile: true,
  });

  for (const name of ['splash', 'game']) {
    let html = fs.readFileSync(src(`client/${name}.html`), 'utf8');
    html = html.replace(/<script type="module" src="[^"]+"><\/script>/, `<script type="module" src="${name}.js"></script>`);
    if (fs.existsSync(dist(`client/${name}.css`))) {
      html = html.replace('</head>', `    <link rel="stylesheet" href="${name}.css" />\n  </head>`);
    }
    fs.writeFileSync(dist(`client/${name}.html`), html);
  }
  if (fs.existsSync(path.join(root, 'public'))) fs.cpSync(path.join(root, 'public'), dist('client'), { recursive: true });

  // Server: a single CommonJS file, everything bundled.
  const server = await esbuild.build({
    absWorkingDir: root,
    entryPoints: [src('server/index.ts')],
    outfile: dist('server/index.cjs'),
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    minify: false,
    sourcemap: false,
    legalComments: 'none',
    mainFields: ['module', 'main'],
    logLevel: 'warning',
    metafile: true,
  });

  const size = (f) => (fs.statSync(f).size / 1024).toFixed(0) + ' KB';
  const files = fs.readdirSync(dist('client')).map((f) => `${f} ${size(dist('client/' + f))}`);
  console.log(`built in ${Date.now() - t0} ms | client: ${files.join(', ')} | server/index.cjs ${size(dist('server/index.cjs'))}`);
  return { client, server };
}

function latestMtime(dir) {
  let m = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    m = Math.max(m, e.isDirectory() ? latestMtime(p) : fs.statSync(p).mtimeMs);
  }
  return m;
}

try {
  await build();
  if (watch) {
    let last = latestMtime(path.join(root, 'src'));
    console.log('watching src/ ...');
    for (;;) {
      await new Promise((r) => setTimeout(r, 700));
      const m = latestMtime(path.join(root, 'src'));
      if (m > last) {
        last = m;
        try {
          await build();
        } catch (e) {
          console.error(String(e?.message ?? e));
        }
      }
    }
  }
} catch (e) {
  console.error(String(e?.message ?? e));
  process.exitCode = 1;
} finally {
  if (!watch) await esbuild.stop();
}
