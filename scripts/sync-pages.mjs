import { access, copyFile, cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const builtAssets = resolve(root, 'dist/assets');
const publishedAssets = resolve(root, 'assets');
const standalone = resolve(root, 'aria.html');

await rm(publishedAssets, { recursive: true, force: true });
await mkdir(publishedAssets, { recursive: true });
await cp(builtAssets, publishedAssets, { recursive: true });
await copyFile(resolve(root, 'dist/index.html'), resolve(root, 'index.html'));

// The standalone download is produced by `npm run build:standalone`, which
// `build:pages` runs first. It is published as-is beside index.html.
try {
  await access(standalone);
} catch {
  throw new Error('aria.html is missing — run `npm run build:standalone` before syncing the Pages bundle.');
}

console.log('Synced the GitHub Pages bundle to the repository root (index.html, assets/, aria.html).');
