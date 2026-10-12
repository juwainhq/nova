// Browsing panel checks with App doubles. Whether Google actually renders inside
// the iframe (igu=1) is not something these structural checks can see.
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import {
  BROWSE_FOUND_TEXT, BROWSE_SLIDE_MS, browseRequest, browseUrl, imageRequestQuery, isCloseCommand,
  videoRequestQuery, webSearchQuery,
} from '../src/web-browse.js';
import { createAppHarness, createStorageDouble } from './speech-test-fixtures.mjs';

const run = promisify(execFile);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function renderPanel(browse) {
  const { outputFiles } = await build({
    stdin: { contents: `
      import { createElement } from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import BrowsePanel from './src/BrowsePanel.jsx';
      process.stdout.write(renderToStaticMarkup(createElement(BrowsePanel, { browse: ${JSON.stringify(browse)}, onClose() {} })));
    `, resolveDir: process.cwd(), loader: 'jsx' },
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', logLevel: 'warning',
  });
  const dir = await mkdtemp(join(tmpdir(), 'nova-browse-'));
  try {
    const file = join(dir, 'browse.cjs');
    await writeFile(file, outputFiles[0].text);
    return (await run(process.execPath, [file])).stdout;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export async function verifyWebBrowse(check) {
  // ------------------------------------------------------------ intent detection
  const expected = {
    'show me a dog': ['images', 'dog'], 'find a picture of a red car': ['images', 'red car'], 'picture of a sunset': ['images', 'sunset'],
    'image of the Eiffel Tower': ['images', 'Eiffel Tower'], 'What does a platypus look like?': ['images', 'platypus'],
    'show me pictures of cats': ['images', 'cats'],
    'show me a video of cats': ['videos', 'cats'], 'video of a rocket launch': ['videos', 'rocket launch'],
    'find videos about volcanoes': ['videos', 'volcanoes'], 'play a video of ocean waves': ['videos', 'ocean waves'],
    'show me cooking videos': ['videos', 'cooking'],
    'search for best pizza in Dhaka': ['web', 'best pizza in Dhaka'], 'search React hooks': ['web', 'React hooks'],
    'look up the capital of Peru': ['web', 'the capital of Peru'], 'find information about black holes': ['web', 'black holes'],
    'Find info on Mars please.': ['web', 'Mars'], 'google Bangladesh cricket': ['web', 'Bangladesh cricket'],
  };
  for (const [request, [kind, query]] of Object.entries(expected)) {
    check(`browse intent: "${request}" → ${kind} "${query}"`, same(browseRequest(request), { kind, query }));
  }
  const chat = ['show me how to cook rice', 'show me the weather', 'show me my reminders', 'What does it look like?', 'show me a video',
    'show me a picture of', 'What is the capital of France?', 'tell me a joke', 'look up', 'remember my name is Photo', 'close'];
  check('browse intent: questions, app features and incomplete requests stay normal chat', chat.every((request) => browseRequest(request) === null));
  check('browse intent: videos win over the "show me …" picture rule', imageRequestQuery('show me videos') === null && videoRequestQuery('show me a video of cats') === 'cats');
  check('browse intent: "search for pictures of X" is an image search, not web', webSearchQuery('search for pictures of cats') === null
    && browseRequest('search for pictures of cats')?.kind === 'images');
  for (const command of ['close', 'Close.', 'hide', 'go back', 'close the panel', 'hide the results', 'close it please', 'okay close', 'Go back.']) {
    check(`browse close: "${command}" closes the panel`, isCloseCommand(command));
  }
  check('browse close: longer requests are not close commands', ['close the door', 'how do I go back to sleep', 'hide and seek rules', 'close friends'].every((text) => !isCloseCommand(text)));

  // ------------------------------------------------------------------- URLs
  const web = new URL(browseUrl('web', 'cats & dogs / ঢাকা #1'));
  check('browse URLs: web search is Google with igu=1 (allowed in an iframe) and an encoded query',
    web.origin === 'https://www.google.com' && web.pathname === '/search' && web.searchParams.get('igu') === '1'
    && web.searchParams.get('q') === 'cats & dogs / ঢাকা #1' && !web.searchParams.has('tbm'));
  check('browse URLs: images use tbm=isch and videos tbm=vid', new URL(browseUrl('images', 'x')).searchParams.get('tbm') === 'isch'
    && new URL(browseUrl('videos', 'x')).searchParams.get('tbm') === 'vid' && new URL(browseUrl('videos', 'x')).searchParams.get('igu') === '1');
  check('browse URLs: DuckDuckGo is not used (it refuses to be framed)', !(await readFile('src/web-browse.js', 'utf8')).includes('duckduckgo.com/?'));

  // ------------------------------------------------------------------ markup
  const html = await renderPanel({ kind: 'images', query: '<b>red car</b>', url: browseUrl('images', 'red car'), closing: false });
  check('browse panel: dark header shows the kind and the query, escaped', html.includes('class="browse-header"') && html.includes('>Images<')
    && html.includes('&lt;b&gt;red car&lt;/b&gt;') && !html.includes('<b>red car'));
  check('browse panel: an X button closes it', /<button[^>]*class="browse-close"[^>]*aria-label="Close search panel"[^>]*>×<\/button>/.test(html));
  const frame = html.match(/<iframe\b[^>]*>/)?.[0] || '';
  check('browse panel: the iframe shows the Google results URL', frame.includes(`src="${browseUrl('images', 'red car').replace(/&/g, '&amp;')}"`) && frame.includes('class="browse-frame"'));
  check('browse panel: the iframe is sandboxed so Google cannot navigate NOVA away', frame.includes('sandbox="') && !frame.includes('allow-top-navigation'));
  const css = await readFile('src/index.css', 'utf8');
  check('browse layout: left 40% / right 60%, sliding in over 300ms ease', /\.app-shell\.has-browse-panel \{[^}]*width: 40%/.test(css)
    && /\.browse-panel \{[^}]*width: 60%[^}]*animation: browse-in \.3s ease both/.test(css) && /\.browse-panel\.is-closing \{[^}]*browse-out \.3s ease/.test(css)
    && css.includes('@keyframes browse-in { from { transform: translateX(100%); }'));
  check('browse layout: the panel never scrolls; the iframe fills it with no border', /\.browse-panel \{[^}]*overflow: hidden/.test(css)
    && /\.browse-frame \{[^}]*flex: 1;[^}]*width: 100%;[^}]*border: 0/.test(css));
  check('browse layout: the closed app keeps its full width', /\.app-shell \{[^}]*width: 100%/.test(css) && /\.browse-closing \{ width: 100%; \}/.test(css));

  // ---------------------------------------------------------------------- App
  const ready = async (options) => {
    const ui = await createAppHarness({ storage: createStorageDouble(), ...options });
    ui.clock.tick();
    await ui.settle();
    return ui;
  };
  const ask = async (ui, question) => {
    ui.clock.tick(200); // A silent close restarts standby after the listener's usual 150ms.
    ui.flush();
    ui.recognition.instances[0].result(`hey nova ${question}`);
    ui.recognition.instances[0].end();
    await ui.settle();
  };
  const end = async (ui) => { ui.utterances.at(-1).onend(); await ui.settle(); };
  const panel = (ui) => ui.nodes().find((node) => node.props.browse && node.props.onClose);
  const shell = (ui) => ui.tree.props.className;
  const chats = (ui) => ui.requests.filter((request) => request.url.endsWith('/chat/completions')).length;
  const atStage = (ui, stage) => ui.find('status-word')?.props.className.split(' ').includes(`status-word-${stage}`);

  const app = await ready();
  check('browse App: the panel is hidden by default and NOVA has the full width', !panel(app) && !shell(app).includes('has-browse-panel'));
  const opens = [];
  app.window.open = (...args) => { opens.push(args); return {}; };
  await ask(app, 'search for best pizza in Dhaka');
  check('browse App: a web search opens the panel beside NOVA right away', panel(app)?.props.browse.kind === 'web'
    && panel(app)?.props.browse.url === browseUrl('web', 'best pizza in Dhaka') && shell(app).includes('has-browse-panel'));
  check('browse App: NOVA says "Here\'s what I found!" and no new tab is opened', app.utterances[0]?.text === BROWSE_FOUND_TEXT && opens.length === 0);
  check('browse App: searches are handled locally, not by the model', chats(app) === 0);
  check('browse App: the avatar and mic stay on screen', Boolean(app.find('avatar-container')) && Boolean(app.find('mic-button')));
  await end(app);
  check('browse App: the panel stays open after NOVA finishes speaking, with no extra cards', Boolean(panel(app)) && !app.find('rich-content-slot'));
  app.clock.tick(60_000);
  app.flush();
  check('browse App: the panel has no timeout', Boolean(panel(app)) && !panel(app)?.props.browse.closing);

  await ask(app, 'show me a video of cats');
  check('browse App: a new search replaces the results in the open panel', panel(app)?.props.browse.kind === 'videos'
    && panel(app)?.props.browse.url === browseUrl('videos', 'cats'));
  await end(app);
  await ask(app, 'what does a red panda look like');
  check('browse App: image requests use Google Images', panel(app)?.props.browse.kind === 'images' && panel(app)?.props.browse.query === 'red panda');
  await end(app);

  const spokenBefore = app.utterances.length;
  await ask(app, 'close');
  check('browse App: saying "close" slides the panel out (300ms)', panel(app)?.props.browse.closing === true && shell(app).includes('browse-closing'));
  check('browse App: closing is silent and goes back to standby, not to the model', app.utterances.length === spokenBefore && chats(app) === 0 && atStage(app, 'ready'));
  app.clock.tick(BROWSE_SLIDE_MS - 1);
  app.flush();
  check('browse App: the panel stays mounted while it slides out', Boolean(panel(app)));
  app.clock.tick(1);
  app.flush();
  check('browse App: then it is removed and NOVA has the full width again', !panel(app) && !shell(app).includes('has-browse-panel'));
  await ask(app, 'go back');
  check('browse App: "go back" with no panel open is a normal question', chats(app) === 1);
  app.unmount();

  const button = await ready();
  await ask(button, 'look up the capital of Peru');
  panel(button)?.props.onClose();
  button.flush();
  check('browse App: the X button closes it too', panel(button)?.props.browse.closing === true);
  await ask(button, 'show me a dog');
  check('browse App: a search while closing reopens the panel', panel(button)?.props.browse.closing === false && panel(button)?.props.browse.query === 'dog');
  button.clock.tick(BROWSE_SLIDE_MS);
  button.flush();
  check('browse App: …and the old close timer cannot remove it', Boolean(panel(button)));
  button.unmount();

  const offline = await ready({ modelsOffline: true });
  await ask(offline, 'search for tea');
  check('browse App: searches work with Ollama offline', Boolean(panel(offline)) && offline.utterances[0]?.text === BROWSE_FOUND_TEXT);
  offline.unmount();
}
