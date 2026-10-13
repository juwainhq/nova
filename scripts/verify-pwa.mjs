// Real production manifest/assets plus isolated service-worker and registration
// behavior. No network, live microphone, or Ollama is needed for these checks.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const root = process.cwd(), dist = resolve(root, 'dist');
const results = [];
function check(name, ok) { results.push({ name, ok: Boolean(ok) }); }
const html = await readFile(resolve(dist, 'index.html'), 'utf8');
const manifest = JSON.parse(await readFile(resolve(dist, 'manifest.json'), 'utf8'));
const worker = await readFile(resolve(dist, 'sw.js'), 'utf8');
const template = await readFile(resolve(root, 'src/sw.js'), 'utf8');
const sidebar = await readFile(resolve(root, 'src/pwa.css'), 'utf8');
const devHtml = await readFile(resolve(root, 'index.dev.html'), 'utf8');
const sourceManifest = JSON.parse(await readFile(resolve(root, 'public/manifest.json'), 'utf8'));
check('manifest: source and production copy match', JSON.stringify(manifest) === JSON.stringify(sourceManifest));
check('manifest: NOVA has a stable standalone identity', manifest.name === 'NOVA' && manifest.short_name === 'NOVA' && manifest.display === 'standalone' && manifest.id === './');
check('manifest: scope and launch URL stay relative for project hosting', manifest.start_url === './' && manifest.scope === './');
check('manifest: installed chrome uses the requested orange', manifest.theme_color === '#f97316' && manifest.background_color === '#050300');
check('manifest: no orientation lock prevents desktop resizing', !manifest.orientation);
check('HTML: links the manifest and icon relative to the app directory', /rel="manifest" href="\.\/manifest\.json"/.test(html)
  && /rel="icon"[^>]*href="\.\/icons\/nova-192\.svg"/.test(html));
check('HTML: source uses public URLs so repeat builds cannot inline the published manifest', devHtml.includes('href="/manifest.json"') && devHtml.includes('href="/icons/nova-192.svg"'));
check('HTML: orange browser/app theme agrees with the manifest', /name="theme-color" content="#f97316"/.test(html));
for (const size of [192, 512]) {
  const svgIcon = manifest.icons.find(icon => icon.sizes === `${size}x${size}` && icon.type === 'image/svg+xml');
  const pngIcon = manifest.icons.find(icon => icon.sizes === `${size}x${size}` && icon.type === 'image/png');
  check(`icons: ${size}px SVG is declared`, svgIcon?.src === `./icons/nova-${size}.svg` && svgIcon.purpose === 'any');
  const svg = await readFile(resolve(dist, svgIcon.src), 'utf8');
  check(`icons: ${size}px has an orange circle and a self-contained white N`, svg.includes(`width="${size}" height="${size}"`)
    && svg.includes('fill="#f97316"') && svg.includes('fill="#ffffff"') && svg.includes('<circle') && svg.includes('<path') && !/<text|<image|<script/.test(svg));
  const png = await readFile(resolve(dist, pngIcon.src));
  check(`icons: ${size}px PNG fallback has the correct signature and dimensions`, png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    && png.readUInt32BE(16) === size && png.readUInt32BE(20) === size && pngIcon.purpose === 'any');
}
check('worker: build placeholders are resolved', !worker.includes('__NOVA_PWA_VERSION__') && !worker.includes('__NOVA_PWA_FILES__'));
check('worker: source remains a versionable template', template.includes('__NOVA_PWA_VERSION__') && template.includes('__NOVA_PWA_FILES__'));

function mime(path) {
  if (path.endsWith('.html')) return 'text/html';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.js')) return 'text/javascript';
  if (path.endsWith('.css')) return 'text/css';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}
const content = new Map();
async function loadFiles(directory = '') {
  for (const file of await readdir(resolve(dist, directory), { withFileTypes: true })) {
    const name = directory ? `${directory}/${file.name}` : file.name;
    if (file.isDirectory()) await loadFiles(name);
    else content.set(name, await readFile(resolve(dist, name)));
  }
}
await loadFiles();

function harness(scope, source = worker, sharedStore = new Map()) {
  const handlers = {}, requests = [];
  let online = true, failPath = '', wrongType = '', writesFail = false, claims = 0, skips = 0;
  let streamLimit = 0, unconsumed = 0;
  const pendingHeaders = [];
  const cacheApi = {
    async keys() { return [...sharedStore.keys()]; },
    async delete(name) { return sharedStore.delete(name); },
    async open(name) {
      if (!sharedStore.has(name)) sharedStore.set(name, new Map());
      const entries = sharedStore.get(name);
      return {
        async match(key) { return entries.get(typeof key === 'string' ? key : key.url)?.clone(); },
        async put(key, response) {
          if (writesFail) throw new Error('Storage quota exceeded');
          entries.set(typeof key === 'string' ? key : key.url, response.clone());
          if (streamLimit) { unconsumed--; pendingHeaders.shift()?.(); }
        },
      };
    },
  };
  const sandbox = {
    URL, Request, Response, Set, Error, caches: cacheApi,
    self: {
      registration: { scope },
      addEventListener: (name, fn) => { handlers[name] = fn; },
      clients: { async claim() { claims++; } },
      async skipWaiting() { skips++; },
    },
    async fetch(request) {
      if (streamLimit) {
        if (unconsumed >= streamLimit) await new Promise(resolve => pendingHeaders.push(resolve));
        unconsumed++;
      }
      const url = typeof request === 'string' ? request : request.url;
      requests.push({ url, cache: request.cache });
      if (!online) throw new TypeError('Network offline');
      const pathname = new URL(url).pathname;
      if (pathname.endsWith(failPath) && failPath) return new Response('Missing', { status: 404 });
      const name = pathname.slice(new URL(scope).pathname.length);
      if (pathname.endsWith(wrongType) && wrongType) return new Response('<html>Bad SPA fallback</html>', { headers: { 'content-type': 'text/html' } });
      const body = content.get(name);
      return new Response(body || 'Network-only response', { headers: { 'content-type': mime(name) } });
    },
  };
  runInNewContext(source + '\nglobalThis.config = { VERSION, SHELL_FILES, PREFIX, CACHE, INDEX };', sandbox);
  return {
    scope, config: sandbox.config, store: sharedStore, requests,
    set streamLimit(value) { streamLimit = value; },
    set online(value) { online = value; }, set failPath(value) { failPath = value; },
    set wrongType(value) { wrongType = value; }, set writesFail(value) { writesFail = value; },
    get claims() { return claims; }, get skips() { return skips; },
    async install() { let work; handlers.install({ waitUntil: promise => { work = promise; } }); return work; },
    async activate() { let work; handlers.activate({ waitUntil: promise => { work = promise; } }); return work; },
    request(path, { method = 'GET', mode = 'cors' } = {}) {
      let response;
      handlers.fetch({ request: { url: new URL(path, scope).href, method, mode }, respondWith: promise => { response = promise; } });
      return response;
    },
  };
}

for (const scope of ['https://nova.test/', 'https://nova.test/voice-assistant/']) {
  const sw = harness(scope);
  const tag = new URL(scope).pathname;
  check(`shell ${tag}: includes index, manifest, icons and the real hashed bundles`, sw.config.SHELL_FILES.includes('./index.html') && sw.config.SHELL_FILES.includes('./manifest.json')
    && sw.config.SHELL_FILES.filter(p => p.startsWith('./icons/')).length === 4
    && [...content.keys()].filter(p => p.startsWith('assets/')).every(p => sw.config.SHELL_FILES.includes('./' + p)));
  check(`shell ${tag}: no API, source/HMR, external or standalone files are precached`, sw.config.SHELL_FILES.every(p => /^\.\/(?:index\.html|manifest\.json|assets\/[^?#]+|icons\/[^?#]+)$/.test(p)));
  await sw.install();
  check(`install ${tag}: creates one complete app snapshot`, sw.store.get(sw.config.CACHE).size === sw.config.SHELL_FILES.length);
  check(`install ${tag}: bypasses HTTP cache when fetching a new snapshot`, sw.requests.every(r => r.cache === 'reload'));
  check(`install ${tag}: every request remains inside the deployment scope`, sw.requests.every(r => r.url.startsWith(scope)));
  check(`install ${tag}: does not force-replace an active session`, sw.skips === 0);
  sw.online = false;
  const offlineRoot = await sw.request('./', { mode: 'navigate' });
  check(`offline ${tag}: launch URL serves the complete built HTML`, await offlineRoot.text() === html);
  check(`offline ${tag}: explicit index and query-bearing launch also work`, await (await sw.request('./index.html?source=installed', { mode: 'navigate' })).text() === html);
  const js = sw.config.SHELL_FILES.find(p => p.endsWith('.js'));
  const asset = await sw.request(js + '?v=ignored');
  check(`offline ${tag}: cached JS stays JavaScript, not an HTML fallback`, asset.headers.get('content-type') === 'text/javascript' && (await asset.text()).length > 100000);
  check(`privacy ${tag}: model lists and streamed completions are network-only`, sw.request('/api/ollama/models') === undefined
    && sw.request('./api/ollama/models') === undefined && sw.request('/api/ollama/chat/completions', { method: 'POST' }) === undefined);
  check(`privacy ${tag}: arbitrary configured APIs are not cached`, sw.request('./v1/models') === undefined && sw.request('./v1/chat/completions', { method: 'POST' }) === undefined);
  check(`privacy ${tag}: external frames, fonts and model files bypass the worker`, sw.request('https://example.com/') === undefined
    && sw.request('https://fonts.googleapis.com/css2') === undefined && sw.request('https://huggingface.co/model.onnx') === undefined);
  check(`routing ${tag}: unrelated documents never become the app shell`, sw.request('./nova.html', { mode: 'navigate' }) === undefined
    && sw.request('./other-page.html', { mode: 'navigate' }) === undefined && sw.request('./index.html', { method: 'POST' }) === undefined);
  const old = sw.config.PREFIX + 'old-version';
  const anotherScope = 'nova-shell-%2Fanother-app%2F-old';
  sw.store.set(old, new Map()); sw.store.set(anotherScope, new Map()); sw.store.set('unrelated-model-cache', new Map());
  await sw.activate();
  check(`activate ${tag}: deletes only older snapshots of this exact app scope`, !sw.store.has(old) && sw.store.has(anotherScope) && sw.store.has('unrelated-model-cache') && sw.store.has(sw.config.CACHE));
  check(`activate ${tag}: first installation claims the existing page`, sw.claims === 1);
  // A running build must remain coherent even if the server now has a newer index.
  const count = sw.requests.length;
  sw.online = true;
  check(`versioning ${tag}: navigation stays cache-first, avoiding mixed asset generations`, await (await sw.request('./', { mode: 'navigate' })).text() === html && sw.requests.length === count);
}
const scope = 'https://nova.test/voice-assistant/';
for (const failure of ['missing', 'html-fallback', 'quota']) {
  const sw = harness(scope);
  const old = sw.config.PREFIX + 'working-old-build'; sw.store.set(old, new Map());
  if (failure === 'missing') sw.failPath = '.js';
  if (failure === 'html-fallback') sw.wrongType = '.js';
  if (failure === 'quota') sw.writesFail = true;
  let failed = false;
  try { await sw.install(); } catch { failed = true; }
  check(`failed install (${failure}): rejects the update without replacing the working cache`, failed && sw.store.has(old) && !sw.store.has(sw.config.CACHE));
}
// A finite streaming connection pool catches an install deadlock: waiting for
// every response header before consuming any body can exhaust HTTP/1.1 slots.
const streaming = harness(scope);
streaming.streamLimit = 3;
let deadline;
try {
  await Promise.race([streaming.install(), new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Unconsumed response bodies stalled precaching')), 500); })]);
  check('streaming hosts: response bodies are consumed as they arrive without exhausting connections', streaming.store.get(streaming.config.CACHE).size === streaming.config.SHELL_FILES.length);
} catch (error) {
  check('streaming hosts: response bodies are consumed as they arrive without exhausting connections', false);
} finally { clearTimeout(deadline); }
const original = harness(scope);
await original.install();
const next = harness(scope, worker.replace(original.config.VERSION, 'next-build'), original.store);
await next.install();
check('updates: a waiting snapshot coexists with the active build', original.store.has(original.config.CACHE) && original.store.has(next.config.CACHE) && next.skips === 0);
original.online = false;
check('updates: existing clients can still boot their coherent old snapshot', await (await original.request('./', { mode: 'navigate' })).text() === html);
await next.activate();
check('updates: activation retains only the new snapshot for this scope', !next.store.has(original.config.CACHE) && next.store.has(next.config.CACHE));
const evicted = harness(scope);
evicted.online = false;
const unavailable = await evicted.request('./', { mode: 'navigate' });
check('storage eviction: offline HTML has an honest recovery message', unavailable.status === 503 && (await unavailable.text()).includes('Connect once'));
await assert.rejects(evicted.request(evicted.config.SHELL_FILES.find(p => p.endsWith('.js'))));
check('storage eviction: a missing script is never replaced with HTML', true);

// Registration itself has no dependency on React or the assistant state machine.
const compiled = await build({ entryPoints: [resolve(root, 'src/pwa.js')], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent' });
async function registration({ secure = true, protocol = 'https:', supported = true, reject = false, base = scope + 'index.html?mode=app' } = {}) {
  const calls = [], warnings = [];
  const api = { async register(url, options) { calls.push({ url, options }); if (reject) throw new Error('Denied'); return { scope: options.scope }; } };
  const sandbox = { module: { exports: {} }, URL, document: { baseURI: base }, navigator: supported ? { serviceWorker: api } : {}, location: { protocol }, isSecureContext: secure,
    console: { warn: (...args) => warnings.push(args) } };
  runInNewContext(compiled.outputFiles[0].text, sandbox);
  const result = await sandbox.module.exports.registerPwa();
  return { result, calls, warnings };
}
const registered = await registration();
check('registration: worker URL and explicit scope respect a project directory', registered.calls[0].url === scope + 'sw.js' && registered.calls[0].options.scope === scope);
check('registration: update checks bypass HTTP script caches', registered.calls[0].options.updateViaCache === 'none');
for (const [name, options] of [['insecure HTTP', { secure: false, protocol: 'http:' }], ['file download', { protocol: 'file:' }], ['unsupported browser', { supported: false }]]) {
  const attempt = await registration(options);
  check(`registration: ${name} is a safe no-op`, attempt.result === null && attempt.calls.length === 0 && attempt.warnings.length === 0);
}
const denied = await registration({ reject: true });
check('registration: a denied worker never breaks the online app', denied.result === null && denied.warnings.length === 1);
const local = await registration({ protocol: 'http:', base: 'http://localhost:4173/index.html' });
check('registration: trustworthy localhost supports installation testing', local.calls[0].url === 'http://localhost:4173/sw.js');
const main = await readFile(resolve(root, 'src/main.jsx'), 'utf8');
const config = await readFile(resolve(root, 'vite.config.js'), 'utf8');
const singleBuilder = await readFile(resolve(root, 'scripts/build-standalone.mjs'), 'utf8');
check('entry: worker registration is build-gated outside React', main.includes("typeof __NOVA_ENABLE_PWA__ !== 'undefined' && __NOVA_ENABLE_PWA__") && main.includes('void registerPwa();'));
check('entry: editable dev builds disable registration', config.includes("JSON.stringify(command === 'build')"));
check('entry: the file:// build explicitly disables registration', singleBuilder.includes("__NOVA_ENABLE_PWA__: 'false'"));
check('sidebar: portrait sizing is separate from short/browse layouts', sidebar.includes('@media (max-width: 440px) and (min-height: 580px)')
  && sidebar.includes('.app-shell:not(.has-browse-panel)') && sidebar.includes('--dock-height: 256px;'));
check('sidebar: reserves room for mic, avatar picker and permission text', sidebar.includes('.mic-control-wrap { width: 64px; height: 64px; flex-shrink: 0; }')
  && sidebar.includes('.control-dock { gap: 24px; padding-bottom: 32px; }') && sidebar.includes('.avatar-choice { width: 34px; height: 34px;'));
check('sidebar: narrow picker tooltips do not sit over the microphone', sidebar.includes('.avatar-choice-name { bottom: 50%; left: calc(100% + 10px); transform: translateY(50%); }'));
check('sidebar: standalone preserves a normal native resizable window', sidebar.includes('@media (display-mode: standalone)') && !sidebar.includes('app-region: drag'));

for (const { name, ok } of results) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
const failures = results.filter(result => !result.ok).length;
console.log(failures ? `\n${failures} check(s) failed.` : `\nAll ${results.length} checks passed.`);
if (failures) process.exitCode = 1;
