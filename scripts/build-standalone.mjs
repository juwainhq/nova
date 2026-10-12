// Produce `nova.html`: one self-contained file, opened straight from disk with no
// build step and no server. CSS and JS are inlined, and a build-time constant flips
// the app to call Ollama directly instead of through the Vite proxy.
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const run = promisify(execFile);
const root = process.cwd();

const OUTPUT_NAME = 'nova.html';
// Placeholder replaced by esbuild; keeps the bundle free of a bare global lookup.
const FLAG_TOKEN = '__NOVA_STANDALONE__';

const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#050300" />
    <meta name="description" content="NOVA is your warm, voice-first personal AI assistant. Keep this single-file copy on your computer with no build step." />
    <title>NOVA — Voice Intelligence</title>
    <style>
__styles__
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
__script__
    </script>
  </body>
</html>
`;

// esbuild is already a Vite dependency, so this needs no extra install.
async function resolveEsbuild() {
  try {
    return await import('esbuild');
  } catch {
    const { createRequire } = await import('node:module');
    const requireFromVite = createRequire(await import.meta.resolve('vite'));
    return requireFromVite('esbuild');
  }
}

// `</script>` inside a string literal would close the inline block early.
function inlineScript(script) {
  return script.replace(/<\/script/gi, '<\\/script');
}

async function main() {
  const esbuild = await resolveEsbuild();

  const result = await esbuild.build({
    entryPoints: [resolve(root, 'src/main.jsx')],
    bundle: true,
    // Only used to name the in-memory outputs; nothing is written to disk.
    outdir: resolve(root, 'dist-standalone'),
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['chrome100', 'firefox100', 'safari15', 'edge100'],
    minify: true,
    legalComments: 'none',
    loader: { '.jsx': 'jsx' },
    // Match what Vite uses. The classic transform emits bare `React.createElement`
    // calls, which only work here by accident because main.jsx happens to import
    // React — a coupling that would break silently if that import were removed.
    jsx: 'automatic',
    define: { [FLAG_TOKEN]: 'true', __NOVA_ENABLE_PWA__: 'false' },
    logLevel: 'warning',
  });

  const outputs = result.outputFiles ?? [];
  const scriptOutput = outputs.find((file) => file.path.endsWith('.js'));
  const styleOutput = outputs.find((file) => file.path.endsWith('.css'));
  if (!scriptOutput) throw new Error('The bundled script was not produced.');
  if (!styleOutput) throw new Error('The bundled stylesheet was not produced.');

  // Function replacers so `$&`-style sequences in the bundle are left alone.
  const html = TEMPLATE
    .replace('__styles__', () => styleOutput.text.trim())
    .replace('__script__', () => inlineScript(scriptOutput.text).trim());

  if (html.includes(FLAG_TOKEN)) {
    throw new Error('The standalone flag was not replaced; the file would fall back to proxy paths.');
  }
  if (!html.includes('<style>') || !html.includes('<script>') || html.length < 100000) {
    throw new Error(`The standalone build looks malformed or unexpectedly small (${html.length} bytes).`);
  }

  await writeFile(resolve(root, OUTPUT_NAME), html, 'utf8');
  const { stdout } = await run(process.execPath, [resolve(root, 'scripts/verify-standalone.mjs')], { cwd: root });
  process.stdout.write(stdout);

  console.log(
    `Wrote ${OUTPUT_NAME}: ${(html.length / 1024).toFixed(1)} kB, self-contained`
    + ` (style ${(styleOutput.text.length / 1024).toFixed(1)} kB, script ${(scriptOutput.text.length / 1024).toFixed(1)} kB).`,
  );
}

main().catch((error) => {
  console.error(`Standalone build failed: ${error.message}`);
  process.exitCode = 1;
});
