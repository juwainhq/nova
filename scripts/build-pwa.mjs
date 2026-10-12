// Bind the offline shell to the *actual* Vite output, never hardcoded asset
// hashes or dev/HMR URLs. Relative URLs support GitHub Pages project subpaths.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = process.cwd();
const dist = resolve(root, 'dist');
async function filesIn(directory) {
  const entries = await readdir(join(dist, directory), { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => entry.isDirectory()
    ? filesIn(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]));
  return files.flat();
}
const files = ['index.html', 'manifest.json', ...await filesIn('assets'), ...await filesIn('icons')].sort();
const html = await readFile(join(dist, 'index.html'), 'utf8');
if (!/rel="manifest"[^>]*href="\.\/manifest\.json"/.test(html)) throw new Error('Built index is missing its relative manifest link.');
if (html.includes('/@vite/client') || html.includes('/src/main.jsx')) throw new Error('Refusing to cache a development entry.');
const source = await readFile(resolve(root, 'src/sw.js'), 'utf8');
const hash = createHash('sha256').update(source);
for (const file of files) {
  hash.update(file).update('\0').update(await readFile(join(dist, file))).update('\0');
}
const version = hash.digest('hex').slice(0, 20);
const worker = source.replace('__NOVA_PWA_VERSION__', version)
  .replace('/* __NOVA_PWA_FILES__ */ []', JSON.stringify(files.map(file => `./${file}`), null, 2));
if (/__NOVA_PWA_(?:VERSION|FILES)__/.test(worker)) throw new Error('Unresolved service-worker build placeholders.');
await writeFile(join(dist, 'sw.js'), worker);
console.log(`Built PWA app shell ${version}: ${files.length} same-origin files.`);
