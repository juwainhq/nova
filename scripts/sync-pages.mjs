import { copyFile, cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const builtAssets = resolve(root, 'dist/assets');
const publishedAssets = resolve(root, 'assets');

await rm(publishedAssets, { recursive: true, force: true });
await mkdir(publishedAssets, { recursive: true });
await cp(builtAssets, publishedAssets, { recursive: true });
await copyFile(resolve(root, 'dist/index.html'), resolve(root, 'index.html'));

console.log('Synced the GitHub Pages bundle to the repository root.');
