import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import fs from 'node:fs';
import path from 'node:path';

// The test site build (vite build --mode preview): no install manifest, no service worker, a different title and bar colour.
const testSite = () => {
  let out;
  return {
    name: 'test-site',
    configResolved(c) { out = path.resolve(c.root, c.build.outDir); },
    transformIndexHtml: (html) => html
      .replace('<title>Gym log</title>', '<title>Gym log (test)</title>')
      .replace(/\s*<link rel="manifest"[^>]*>/, '')
      .replace('<meta name="theme-color" content="#F3F5FA" />', '<meta name="theme-color" content="#FACC15" />'),
    closeBundle() { ['sw.js', 'manifest.webmanifest'].forEach((f) => fs.rmSync(path.join(out, f), { force: true })); },
  };
};

// Relative base so the same build works on GitHub Pages (/gymapp/ and /gymapp/preview/) or any other static host.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [preact(), mode === 'preview' && testSite()].filter(Boolean),
  define: { __TEST__: JSON.stringify(mode === 'preview') },
  build: { target: 'es2020' },
}));
