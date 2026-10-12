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
  BROWSE_FOUND_TEXT, BROWSE_SLIDE_MS, browseGoto, browseInputStop, browseNavRequest,
  browseRequest, browseTargetUrl, browseUrl, imageRequestQuery, isCloseCommand, picturesOfQuery, pushBrowseHistory,
  shoppingRequestQuery,
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
  // Product and shopping asks. Before these rules the panel only knew "search for X"
  // and "look up X", so "find me a laptop" came back as a spoken guess.
  const products = {
    'find me a laptop': ['web', 'laptop'], 'show me wireless headphones': ['images', 'wireless headphones'],
    'look up Nike shoes': ['web', 'Nike shoes'], 'search for a gaming chair': ['web', 'a gaming chair'],
    'find pictures of cats': ['images', 'cats'], 'buy a keyboard': ['web', 'keyboard'],
    'shop for a monitor': ['web', 'monitor'], 'what is the price of AirPods': ['web', 'price of AirPods'],
    'where can I get a cheap SSD': ['web', 'cheap SSD'], 'photos of the moon': ['images', 'moon'],
    'images of lions': ['images', 'lions'], 'I want to buy a router': ['web', 'router'],
    'can you find a good hotel': ['web', 'good hotel'], 'find me some running shoes': ['web', 'running shoes'],
    'look for a gift under 50 dollars': ['web', 'gift under 50 dollars'], 'where can I buy a ps5': ['web', 'ps5'],
    'show me the latest gaming laptops': ['images', 'latest gaming laptops'],
  };
  for (const [request, [kind, query]] of Object.entries(products)) {
    check(`browse intent: "${request}" → ${kind} "${query}"`, same(browseRequest(request), { kind, query }));
  }
  for (const trigger of ['find', 'look for', 'look up', 'show me', 'search for', 'buy', 'shop for', 'price of', 'where can I get', 'images of', 'pictures of', 'photos of']) {
    const spoken = trigger === 'price of' ? 'what is the price of a drone' : trigger === 'where can I get' ? 'where can I get a drone' : `${trigger} a drone`;
    const found = browseRequest(spoken);
    check(`browse intent: "${spoken}" ("${trigger}") opens the panel`, Boolean(found)
      && (found.kind === 'images' ? found.query.includes('drone') : found.query.includes('drone')));
  }
  const shoppingUrl = (request) => { const found = browseRequest(request); return found ? browseUrl(found.kind, found.query) : null; };
  check('browse intent: shopping opens a plain search, pictures open the image search',
    shoppingUrl('find me a laptop') === 'https://www.google.com/search?igu=1&q=laptop'
    && shoppingUrl('buy a keyboard') === browseUrl('web', 'keyboard')
    && shoppingUrl('find photos of cats') === browseUrl('images', 'cats')
    && browseUrl('images', 'cats').includes('tbm=isch') && !shoppingUrl('find me a laptop').includes('tbm='));
  check('browse intent: the framed search keeps the one parameter Google allows framing with',
    browseUrl('web', 'laptop').includes('igu=1') && !browseUrl('web', 'laptop').includes('igu=0'));
  const notShopping = ['show me how to cook rice', 'how do I find a good dentist', 'look for my notes', 'find my settings',
    'I can\u2019t find my keys', 'can you find the microphone', 'show me my memories', 'buy me some time', 'tell me about Paris',
    'what should I cook tonight', 'images of', 'find', 'buy', 'search for a', 'show me', 'look for nothing', 'photos of'];
  check('browse intent: shopping rules do not swallow questions, app features or an empty object',
    notShopping.every((request) => browseRequest(request) === null));
  // The cost of "any message containing find": an abstract object is indistinguishable
  // from a product, so it is searched. The second line did this before these rules existed.
  check('browse intent: an abstract ask is searched too, which is what a broad rule costs',
    browseRequest('find me a reason to keep going')?.kind === 'web' && browseRequest('search for a gift for my wife')?.kind === 'web');
  check('browse intent: a picture of a thing is still images, not a product search',
    browseRequest('find me pictures of a laptop')?.kind === 'images' && browseRequest('pictures of laptops')?.kind === 'images');
  check('browse intent: an image ask with no verb is caught by the broad rule', picturesOfQuery('I love photos of old trains') === 'old trains'
    && picturesOfQuery('what is a photo') === null && shoppingRequestQuery('look up') === null && shoppingRequestQuery('buy') === null);
  // "of" is what makes a media word an image request: "photos from the museum" is not.
  check('browse intent: a media word without "of" is not a picture request',
    picturesOfQuery('photos from the museum') === null && picturesOfQuery('photosynthesis explained') === null
    && picturesOfQuery('image library setup') === null);

  for (const command of ['close', 'Close.', 'hide', 'close the panel', 'hide the results', 'close it please', 'okay close', 'close browser', 'close the browser', 'dismiss the search results']) {
    check(`browse close: "${command}" closes the panel`, isCloseCommand(command));
  }
  check('browse close: longer requests are not close commands', ['close the door', 'how do I go back to sleep', 'hide and seek rules', 'close friends'].every((text) => !isCloseCommand(text)));
  check('browse close: "go back" is a navigation command now, not a way to close', !isCloseCommand('go back') && browseNavRequest('go back')?.action === 'back');

  // ------------------------------------------------------- browser commands + address
  for (const phrase of ['go back', 'Go back.', 'back', 'please go back', 'go back one page', 'head back']) {
    check(`browse nav: "${phrase}" goes back`, browseNavRequest(phrase)?.action === 'back');
  }
  for (const phrase of ['go forward', 'forward', 'next page', 'Next.']) {
    check(`browse nav: "${phrase}" goes forward`, browseNavRequest(phrase)?.action === 'forward');
  }
  for (const phrase of ['refresh', 'Refresh.', 'reload the page', 'refresh the panel']) {
    check(`browse nav: "${phrase}" refreshes`, browseNavRequest(phrase)?.action === 'refresh');
  }
  for (const phrase of ['go to github.com', 'open example.com/docs', 'visit https://news.ycombinator.com/item?id=1', 'navigate to en.wikipedia.org']) {
    check(`browse nav: "${phrase}" goes to that site`, browseNavRequest(phrase)?.action === 'goto'
      && /^https:\/\//.test(browseNavRequest(phrase).url));
  }
  for (const phrase of ['go to bed', 'how do I go back to sleep', 'open the pod bay doors', 'refresh my memory', 'go to the store', 'what is github.com']) {
    check(`browse nav: "${phrase}" stays an ordinary request`, browseNavRequest(phrase) === null && browseGoto(phrase) === null);
  }
  check('browse nav: "go to the website of reddit.com" still finds the host', browseGoto('go to the website of reddit.com')?.url === 'https://reddit.com/');
  const first = pushBrowseHistory([], -1, { url: 'https://a.test/' });
  const second = pushBrowseHistory(first.entries, first.step, { url: 'https://b.test/' });
  const third = pushBrowseHistory(second.entries, second.step, { url: 'https://c.test/' });
  check('browse trail: each opened page becomes one stop, newest last', second.step === 1 && third.step === 2
    && third.entries.map((stop) => stop.url).join(' ') === 'https://a.test/ https://b.test/ https://c.test/');
  check('browse trail: opening from the middle drops the forward stops', pushBrowseHistory(third.entries, 0, { url: 'https://d.test/' }).entries.length === 2);
  check('browse trail: the same page twice does not stack a duplicate stop', pushBrowseHistory(third.entries, third.step, { url: 'https://c.test/' }).step === 2
    && pushBrowseHistory(third.entries, third.step, { url: 'https://c.test/' }).entries.length === 3);
  check('browse trail: the bar keeps at most 12 stops', pushBrowseHistory(Array.from({ length: 12 }, (_, i) => ({ url: `https://${i}.test/` })), 11, { url: 'https://x.test/' }).entries.length === 12);
  const typed = [
    ['example.com', 'https://example.com/'],
    ['http://localhost:8080/x', 'http://localhost:8080/x'],
    ['//example.com/a', 'https://example.com/a'],
    ['dogs', 'https://www.google.com/search?igu=1&q=dogs'],
    ['best pizza in Dhaka', 'https://www.google.com/search?igu=1&q=best+pizza+in+Dhaka'],
  ];
  for (const [input, url] of typed) {
    check(`browse address: "${input}" loads ${url}`, browseInputStop(input)?.url === url);
  }
  check('browse address: a bare word is searched, not treated as a host', browseTargetUrl('dogs') === null
    && browseTargetUrl('localhost:3000') === null && browseTargetUrl('localhost') === null);
  check('browse address: this app is never loaded inside its own frame',
    /url\.origin === here/.test(await readFile('src/web-browse.js', 'utf8')));
  for (const blocked of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'file:///etc/passwd', 'view-source:https://example.com', 'vbscript:msgbox']) {
    check(`browse address: "${blocked.split(':')[0]}:" is never loaded into the frame`, browseTargetUrl(blocked) === null
      && browseInputStop(blocked) === null);
  }
  check('browse address: a search keeps the words as the label, a host keeps its name', browseInputStop('red panda')?.query === 'red panda'
    && browseInputStop('wikipedia.org/wiki/Cat')?.query === 'wikipedia.org');
  check('browse address: DuckDuckGo is still not used for typed searches', !browseInputStop('dogs').url.includes('duckduckgo.com'));

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
  const SANDBOX_TOKENS = (frame.match(/sandbox="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean);
  const EXPECTED_SANDBOX = ['allow-scripts', 'allow-same-origin', 'allow-forms', 'allow-popups',
    'allow-popups-to-escape-sandbox', 'allow-top-navigation-by-user-activation'];
  check('browse panel: the frame is sandboxed, and only a click inside it may move the page behind NOVA',
    frame.includes('sandbox="') && SANDBOX_TOKENS.includes('allow-top-navigation-by-user-activation')
    && !SANDBOX_TOKENS.includes('allow-top-navigation') && !SANDBOX_TOKENS.includes('allow-top-navigation-to-custom-protocols'));
  const css = await readFile('src/index.css', 'utf8');
  const handle = await readFile('src/BrowsePanel.jsx', 'utf8');
  const panelSources = [handle, await readFile('src/App.jsx', 'utf8'), await readFile('src/web-browse.js', 'utf8')].join('\n');
  check('browse layout: left 45% / right 55% (max 600px), sliding in over 300ms ease', /\.app-shell\.has-browse-panel \{[^}]*width: max\(45%, calc\(100% - 600px\)\)/.test(css)
    && /\.browse-panel \{[^}]*width: 55%; max-width: 600px;[^}]*animation: browse-in \.3s ease both/.test(css) && /\.browse-panel\.is-closing \{[^}]*browse-out \.3s ease/.test(css)
    && css.includes('@keyframes browse-in { from { transform: translateX(100%); }'));
  check('browse layout: a white card with a rounded, hairline-bordered left edge', /\.browse-panel \{[^}]*border-left: 1px solid rgba\(26, 18, 8, \.16\);[^}]*border-radius: 12px 0 0 12px/.test(css)
    && /\.browse-panel \{[^}]*background: var\(--card\)/.test(css) && /\.browse-header \{[^}]*background: var\(--card-alt\)/.test(css));
  check('browse layout: the frame leaves 60px for the header and 20px at the bottom', /\.browse-header \{ flex: 0 0 60px;/.test(css) && /\.browse-panel \{[^}]*padding-bottom: 20px/.test(css));
  check('browse layout: the panel never scrolls; the iframe fills it with no border', /\.browse-panel \{[^}]*overflow: hidden/.test(css)
    && /\.browse-frame \{[^}]*flex: 1;[^}]*width: 100%;[^}]*border: 0/.test(css));
  check('browse panel: the sandbox is exactly the agreed allow-list', SANDBOX_TOKENS.join(' ') === EXPECTED_SANDBOX.join(' '));
  check('browse panel: a link that opens a window is allowed to, so the target page is not sandboxed',
    /sandbox=\{SANDBOX\}/.test(handle) && /'allow-scripts allow-same-origin allow-forms allow-popups '/.test(handle)
    && /'allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation'/.test(handle)
    && SANDBOX_TOKENS.includes('allow-popups')); // without it, escaping popups are ignored
  check('browse panel: the mobile sheet carries a grabber, decorative so the × stays the keyboard path', html.includes('class="browse-handle"')
    && /<div class="browse-handle" aria-hidden="true"/.test(html));
  check('browse layout: the grabber only exists on the bottom sheet', /\.browse-handle \{ display: none; \}/.test(css)
    && /@media \(max-width: 700px\)[\s\S]*\.browse-handle \{ display: block;/.test(css)
    && /\.browse-handle \{[^}]*touch-action: none/.test(css.replace(/\n\s*/g, ' ')));
  check('browse layout: a held sheet keeps its own transform instead of the entry fill', /\.browse-panel\.is-dragged \{ animation-fill-mode: none; \}/.test(css));
  check('browse drag: the grabber owns one pointer gesture, start to release', /onPointerDown=\{[^}]*\}[\s\S]*?onPointerMove=[\s\S]*?onPointerUp=[\s\S]*?onPointerCancel=/.test(handle.replace(/\n\s*/g, ' '))
    && /setPointerCapture\?\.\(event\.pointerId\)/.test(handle));
  check('browse drag: the sheet only follows the finger downward, and a release hands the close to the app',
    /Math\.max\(0, event\.clientY - drag\.from\)/.test(handle) && /onClose\(\)/.test(handle)
    && /close \? 'translateY\(100%\)' : 'translateY\(0\)'/.test(handle)
    && /height \* CLOSE_FRACTION \|\| speed >= FLICK_PX_PER_MS/.test(handle));
  const addressInput = html.match(/<input[^>]*class="browse-address-input"[^>]*>/)?.[0] ?? '';
  check('browse chrome: the address bar shows the page the frame last loaded', addressInput.includes('aria-label="Address or search"')
    && addressInput.includes(`value="${browseUrl('images', 'red car').replace(/&/g, '&amp;')}"`)
    && /<form class="browse-address" action="[^"]*"|<form class="browse-address"/.test(html));
  check('browse chrome: back, forward and refresh sit on the left of the bar', /class="browse-nav">\s*<button[^>]*class="browse-nav-button"[^>]*aria-label="Go back"[^>]*>←<\/button>[\s\S]*aria-label="Go forward"[^>]*>→<\/button>[\s\S]*aria-label="Refresh this page"[^>]*>↺<\/button>/.test(html.replace(/><\/button>/g, '></button>')));
  check('browse chrome: the arrows start disabled where the trail cannot go', (html.match(/aria-label="Go (?:back|forward)"[^>]*disabled/g) || []).length === 2
    && !/aria-label="Refresh this page"[^>]*disabled/.test(html));
  check('browse chrome: a light pill bar, still under the 60px header and above the frame', /\.browse-chrome \{[^}]*flex: 0 0 46px/.test(css)
    && /\.browse-address-input \{[^}]*border-radius: 999px; background: var\(--card-alt\)/.test(css)
    && /\.browse-address-input:focus \{ border-color: #f97316/.test(css)
    && /\.browse-header \{ flex: 0 0 60px;/.test(css));

  const appSource = await readFile('src/App.jsx', 'utf8');
  // The light theme is a contract of its own: white paper, charcoal ink, orange accent,
  // a ground that breathes on an 8s cycle, and nothing light-on-light inside a card.
  check('theme: the ground is four blurred blobs on one shared 12s cycle',
    /\.app-shell::before, \.app-shell::after, body::before, body::after \{[^}]*animation: blobMove 12s ease-in-out infinite alternate;/.test(css)
    && /@keyframes blobMove \{[^@]*translate3d\(var\(--blob-x/.test(css)
    && /will-change: transform, opacity;/.test(css) && /filter: blur\(120px\)/.test(css));
  const blobBodies = [...css.matchAll(/^(?:\.app-shell|body)::(?:before|after) \{([^}]*)\n\}/gm)].map(m => m[1]);
  check('theme: the blobs are 400-700px, out of sync, and use the amber palette',
    blobBodies.length === 4
    && blobBodies.every(b => { const w = +(b.match(/width: (\d+)px/) || [])[1]; return w >= 400 && w <= 700 && /animation-delay: -[\d.]+s/.test(b); })
    && new Set(blobBodies.map(b => (b.match(/animation-delay: (-[\d.]+)s/) || [,''])[1])).size === 4
    && ['#c2410c', '#f97316', '#7c2d00', '#fed7aa'].every(hexv => blobBodies.some(b => b.includes(hexv)))
    && /body \{[^}]*background: #050300/.test(css) && !/0f0d0b/.test(css) && !/--ember/.test(css));
  const grainLayer = (css.match(/#root::after \{([^}]*)\n\}/) || [])[1] || '';
  check('theme: the grain is fixed SVG noise at 3% and cannot be interacted with',
    grainLayer.includes('feTurbulence') && grainLayer.includes('position: fixed')
    && grainLayer.includes('pointer-events: none') && grainLayer.includes('opacity: .03'));
  check('theme: the sheets keep white paper and charcoal ink', /--card: #ffffff;/.test(css)
    && /--card-alt: #faf7f5;/.test(css) && /--on-card: #1a1208;/.test(css)
    && /--on-card-strong: #c2410c;/.test(css) && /\.settings-panel \{[^}]*background: var\(--card\)/.test(css));
  check('theme: the reply, the toast and the offline notice are white cards with an orange left edge',
    /\.response-transcript \{[^}]*border-left: 3px solid #f97316;[^}]*border-radius: 14px; background: var\(--card\)/.test(css)
    && /\.toast \{[^}]*border-left: 3px solid #f97316/.test(css)
    && /\.avatar-offline-display \{[^}]*border-left: 3px solid #f97316/.test(css)
    && /\.response-transcript p \{[^}]*color: var\(--on-card\)/.test(css));
  check('theme: the settings gear is an always-visible 40px white circle with an orange glyph',
    /\.icon-button \{[^}]*width: 40px;[^}]*height: 40px;[^}]*border-radius: 50%;[^}]*background: var\(--card\);[^}]*color: #f97316;[^}]*box-shadow/.test(css)
    && !/\.dock-corner/.test(css) && !/\.icon-button \{[^}]*opacity: \./.test(css));
  const statusAt = appSource.indexOf('status-word status-word-');
  const avatarAt = appSource.indexOf('className={`avatar-container');
  check('theme: the status line is bold orange above the avatar',
    /\.status-word \{[^}]*color: #f97316;[^}]*font-weight: 700/.test(css)
    && /\.assistant-stage \{[^}]*flex-direction: column/.test(css)
    && statusAt > 0 && statusAt < avatarAt);
  const sheetRegion = css.slice(css.indexOf('.settings-panel-backdrop'), css.indexOf('@keyframes browse-out'));
  check('theme: no sheet keeps light-on-dark ink or cream hairlines', !/color: var\(--(ink|cream|muted)\)/.test(sheetRegion)
    && !/#f5c99a|rgba\(245, 201, 154/.test(sheetRegion));
  check('browse chrome: the frame still fills what is left, bottom gap included', /\.browse-frame \{ flex: 1;[^}]*min-height: 0/.test(css)
    && /\.browse-panel \{[^}]*padding-bottom: 20px/.test(css));
  const sandboxTokens = SANDBOX_TOKENS;
  const KNOWN_SANDBOX = new Set(['allow-downloads', 'allow-forms', 'allow-modals', 'allow-orientation-lock', 'allow-pointer-lock',
    'allow-popups', 'allow-popups-to-escape-sandbox', 'allow-presentation', 'allow-same-origin', 'allow-scripts',
    'allow-storage-access-by-user-activation', 'allow-top-navigation', 'allow-top-navigation-by-user-activation',
    'allow-top-navigation-to-custom-protocols']);
  check('browse iframe: every sandbox token is one browsers know (allow-navigation is not)',
    sandboxTokens.length > 0 && sandboxTokens.every((token) => KNOWN_SANDBOX.has(token)));
  check('browse iframe: pages the user clicked can run, submit and open',
    sandboxTokens.includes('allow-scripts') && sandboxTokens.includes('allow-forms') && sandboxTokens.includes('allow-same-origin')
    && sandboxTokens.includes('allow-popups') && sandboxTokens.includes('allow-popups-to-escape-sandbox'));
  // A _blank click inside a cross-origin page cannot be retargeted from here: no script
  // in this app may read or steer that document, so there is nothing to "catch".
  check('browse panel: nothing pretends to reach inside the framed page',
    !/\.content(Window|Document)/.test(panelSources));
  check('browse panel: refresh and the arrows are the in-panel controls, so a lost popup is not fatal',
    /aria-label="Refresh this page"/.test(handle) && /aria-label="Go back"/.test(handle));
  check('browse iframe: media may autoplay and take fullscreen inside the panel', /allow="autoplay; fullscreen[^"]*"/.test(frame));
  const blockedRules = [...css.matchAll(/^(\.browse[^{\n]*)\s*\{([^}\n]*)\}/gm)]
    .filter(([, , body]) => /pointer-events:\s*none/.test(body)).map(([, selector]) => selector);
  check('browse panel: no rule keeps the pointer away from the frame except while closing',
    blockedRules.every((selector) => selector.includes('is-closing')));
  check('browse panel: the frame is not covered by an absolutely placed layer', !/\.browse-(frame|chrome)[^{]*\{[^}]*position: absolute/.test(css)
    && /<iframe[\s\S]*class="browse-frame"/.test(html) && !/\.browse-panel > :last-child[^}]*\{[^}]*inset: 0/.test(css));
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
  const askedAboutProducts = chats(app);
  await ask(app, 'find me a laptop');
  check('browse App: a product ask opens the panel on a live Google search', panel(app)?.props.browse.kind === 'web'
    && panel(app)?.props.browse.query === 'laptop' && panel(app)?.props.browse.url === 'https://www.google.com/search?igu=1&q=laptop');
  await end(app);
  check('browse App: the product ask never reaches the model, and the panel is the answer',
    chats(app) === askedAboutProducts && (app.utterances.at(-1)?.text || '').includes(BROWSE_FOUND_TEXT));
  await ask(app, 'where can I get a cheap SSD');
  check('browse App: a shopping question loads a search, not a price read out loud', panel(app)?.props.browse.url === browseUrl('web', 'cheap SSD')
    && panel(app)?.props.browse.query === 'cheap SSD' && chats(app) === askedAboutProducts);

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

  // ------------------------------------------------- the trail, the bar and the arrows
  const trail = await ready();
  await ask(trail, 'show me a dog');
  await end(trail);
  await ask(trail, 'search for cats');
  await end(trail);
  const stops = (ui) => panel(ui)?.props.browse;
  check('browse App: the bar shows the page the frame last loaded', stops(trail).url === browseUrl('web', 'cats') && stops(trail).frame === 0);
  const chatsBeforeChrome = chats(trail);
  panel(trail).props.onBack();
  trail.flush();
  check('browse App: the back arrow steps to the earlier search', stops(trail).url === browseUrl('images', 'dog')
    && stops(trail).query === 'dog' && stops(trail).step === 0);
  panel(trail).props.onForward();
  trail.flush();
  check('browse App: the forward arrow steps to the newest page', stops(trail).url === browseUrl('web', 'cats') && stops(trail).step === 1);
  panel(trail).props.onRefresh();
  trail.flush();
  check('browse App: refresh remounts the same address instead of asking the frame', stops(trail).frame === 1
    && stops(trail).url === browseUrl('web', 'cats'));
  panel(trail).props.onNavigate('wikipedia.org/wiki/Cat');
  trail.flush();
  check('browse App: a typed address is loaded in place, host as its label', stops(trail).url === 'https://wikipedia.org/wiki/Cat'
    && stops(trail).query === 'wikipedia.org' && stops(trail).step === 2);
  panel(trail).props.onBack();
  trail.flush();
  check('browse App: a typed page lands on the trail, so back returns to the search', stops(trail).url === browseUrl('web', 'cats'));
  const refusedBefore = stops(trail).url;
  check('browse App: a non-web scheme is refused rather than opened', panel(trail).props.onNavigate('javascript:alert(1)') === false);
  trail.flush();
  check('browse App: a refused address leaves the frame where it was', stops(trail).url === refusedBefore);
  check('browse chrome: a refused address marks the bar instead of floating a layer over the frame',
    /className=\{`browse-address-input\$\{refused \? ' is-refused' : ''\}`\}/.test(handle)
    && /aria-invalid=\{refused \|\| undefined\}/.test(handle)
    && /\.browse-address-input\.is-refused \{[^}]*border-color/.test(css) && !/\.browse-note/.test(css));
  panel(trail).props.onNavigate('red pandas');
  trail.flush();
  check('browse App: a word without a dot becomes a search in the same panel', stops(trail).url === browseUrl('web', 'red pandas')
    && stops(trail).query === 'red pandas');
  check('browse App: none of the chrome touched the model or spoke', chats(trail) === chatsBeforeChrome && trail.utterances.length === 2);
  trail.unmount();

  const voiceNav = await ready();
  await ask(voiceNav, 'go to example.com');
  check('browse voice: "go to example.com" opens the panel on that page', panel(voiceNav)?.props.browse.url === 'https://example.com/'
    && panel(voiceNav)?.props.browse.query === 'example.com' && shell(voiceNav).includes('has-browse-panel'));
  check('browse voice: a goto is answered by the frame, not the model, and in silence', chats(voiceNav) === 0
    && voiceNav.utterances.length === 0 && atStage(voiceNav, 'ready'));
  await ask(voiceNav, 'go to news.ycombinator.com');
  check('browse voice: a second goto pushes onto the same open panel', panel(voiceNav)?.props.browse.url === 'https://news.ycombinator.com/'
    && panel(voiceNav)?.props.browse.step === 1);
  await ask(voiceNav, 'go back');
  check('browse voice: "go back" navigates the panel instead of closing it', panel(voiceNav)?.props.browse.url === 'https://example.com/'
    && panel(voiceNav)?.props.browse.closing === false);
  await ask(voiceNav, 'refresh');
  check('browse voice: "refresh" reloads the current page', panel(voiceNav)?.props.browse.frame === 1
    && panel(voiceNav)?.props.browse.url === 'https://example.com/');
  await ask(voiceNav, 'back');
  check('browse voice: at the start of the trail "back" leaves the panel', panel(voiceNav)?.props.browse.closing === true
    && shell(voiceNav).includes('browse-closing'));
  voiceNav.clock.tick(BROWSE_SLIDE_MS);
  voiceNav.flush();
  check('browse voice: and it is gone after the slide', !panel(voiceNav) && !shell(voiceNav).includes('has-browse-panel'));
  await ask(voiceNav, 'close browser');
  check('browse voice: "close browser" with nothing open is an ordinary request', chats(voiceNav) === 1);
  voiceNav.unmount();

  const offline = await ready({ modelsOffline: true });
  await ask(offline, 'search for tea');
  check('browse App: searches work with Ollama offline', Boolean(panel(offline)) && offline.utterances[0]?.text === BROWSE_FOUND_TEXT);
  offline.unmount();
}
