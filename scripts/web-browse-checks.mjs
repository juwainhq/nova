// Structural checks for image and web search with fetch/window doubles. The
// real Wikimedia/Openverse/LoremFlickr hosts and pop-up blockers are not exercised.
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { richResponse } from '../src/rich-response.js';
import {
  IMAGE_FOUND_TEXT, WEB_SEARCH_BLOCKED_TEXT, WEB_SEARCH_TEXT, fallbackPictures, findImages, galleryAfterError,
  galleryStart, googleSearchLink, imageRequestQuery, openSearchTab, openverseSearchUrl, openversePictures,
  searchCard, webSearchQuery, wikimediaPictures, wikimediaSearchUrl,
} from '../src/web-browse.js';
import { createAppHarness } from './speech-test-fixtures.mjs';

const run = promisify(execFile);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const json = (data) => ({ ok: true, json: async () => data });
const wikimediaData = {
  query: {
    pages: {
      12: { title: 'File:Second_dog.jpg', index: 2, imageinfo: [{ thumburl: 'https://upload.wikimedia.org/thumb/w2.jpg', url: 'https://upload.wikimedia.org/w2.jpg', mime: 'image/jpeg' }] },
      11: { title: 'File:First dog.png', index: 1, imageinfo: [{ thumburl: 'https://upload.wikimedia.org/thumb/w1.png', url: 'https://upload.wikimedia.org/w1.png', mime: 'image/png' }] },
      13: { title: 'File:Dog bark.ogg', index: 3, imageinfo: [{ thumburl: 'https://upload.wikimedia.org/thumb/a.jpg', url: 'https://upload.wikimedia.org/a.ogg', mime: 'audio/ogg' }] },
      14: { title: 'File:Plain.jpg', index: 4, imageinfo: [{ thumburl: 'http://upload.wikimedia.org/thumb/p.jpg', url: 'http://upload.wikimedia.org/p.jpg', mime: 'image/jpeg' }] },
    },
  },
};
const openverseData = {
  results: [
    { title: 'Dog one', thumbnail: 'https://api.openverse.org/v1/images/o1/thumb/', url: 'https://live.staticflickr.com/o1.jpg' },
    { title: 'Mature', mature: true, thumbnail: 'https://api.openverse.org/v1/images/m/thumb/', url: 'https://live.staticflickr.com/m.jpg' },
    { title: 'Dog two', thumbnail: 'https://api.openverse.org/v1/images/o2/thumb/', url: 'javascript:alert(1)' },
  ],
};
const apiFetch = (calls = []) => async (url, options) => {
  calls.push({ url, options });
  if (url.startsWith('https://commons.wikimedia.org/')) return json(wikimediaData);
  if (url.startsWith('https://api.openverse.org/')) return json(openverseData);
  throw new Error('unexpected');
};
const manualTimers = () => {
  const pending = new Map();
  let id = 0;
  return {
    pending,
    setTimeout(fn, ms) { pending.set(++id, { fn, ms }); return id; },
    clearTimeout(timer) { pending.delete(timer); },
    fire() { for (const [timer, { fn }] of [...pending]) { pending.delete(timer); fn(); } },
  };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function renderGallery(data) {
  const { outputFiles } = await build({
    stdin: { contents: `
      import { createElement } from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import RichResponsePanel from './src/RichResponsePanel.jsx';
      process.stdout.write(renderToStaticMarkup(createElement(RichResponsePanel, { content: ${JSON.stringify(data)}, onClose() {} })));
    `, resolveDir: process.cwd(), loader: 'jsx' },
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', logLevel: 'warning',
  });
  const dir = await mkdtemp(join(tmpdir(), 'nova-gallery-'));
  try {
    const file = join(dir, 'gallery.cjs');
    await writeFile(file, outputFiles[0].text);
    return (await run(process.execPath, [file])).stdout;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export async function verifyWebBrowse(check) {
  // Intent detection.
  const images = {
    'show me a dog': 'dog', 'Show me a dog.': 'dog', 'find a picture of a red car': 'red car',
    'What does a platypus look like?': 'platypus', 'show me what the Eiffel Tower looks like': 'Eiffel Tower',
    'pictures of sunsets': 'sunsets', 'look up pictures of cats': 'cats', 'search for photos of Dhaka': 'Dhaka',
    'can you show me some puppies please': 'puppies', 'show me a picture of cats': 'cats',
  };
  for (const [request, query] of Object.entries(images)) {
    check(`web browse: image intent "${request}" → "${query}"`, imageRequestQuery(request) === query);
  }
  const searches = {
    'search for best pizza in Dhaka': 'best pizza in Dhaka', 'look up the capital of Peru': 'the capital of Peru',
    'find information about black holes': 'black holes', 'Find info on Mars please.': 'Mars',
    'Can you search the web for React hooks?': 'React hooks', 'google Bangladesh cricket': 'Bangladesh cricket',
    'look up “quantum computing” online': 'quantum computing',
  };
  for (const [request, query] of Object.entries(searches)) {
    check(`web browse: search intent "${request}" → "${query}"`, imageRequestQuery(request) === null && webSearchQuery(request) === query);
  }
  const neither = ['show me how to cook rice', 'show me the weather', 'show me my reminders', 'What does it look like?',
    'show me a picture of', 'Show me something funny', 'What is the capital of France?', 'tell me a joke', 'look up',
    'What does show me a picture mean?', 'remember my name is Photo', 'I want to search for meaning'];
  check('web browse: questions, app features and incomplete requests stay normal chat',
    neither.every((request) => imageRequestQuery(request) === null && webSearchQuery(request) === null));

  // Links and search tabs.
  const google = new URL(googleSearchLink('cats & dogs / ঢাকা #1'));
  check('web browse: Google search URL is https://www.google.com/search?q= with the query encoded',
    google.origin === 'https://www.google.com' && google.pathname === '/search' && google.searchParams.get('q') === 'cats & dogs / ঢাকা #1'
    && googleSearchLink('a b') === 'https://www.google.com/search?q=a%20b');
  const opened = [];
  const tab = { opener: 'nova' };
  check('web browse: an opened tab reports success and loses its opener',
    openSearchTab('rust', { open: (...args) => { opened.push(args); return tab; } }) === true
    && same(opened[0], ['https://www.google.com/search?q=rust', '_blank']) && tab.opener === null);
  check('web browse: blocked, throwing or missing window.open reports failure',
    openSearchTab('x', { open: () => null }) === false && openSearchTab('x', { open: () => { throw new Error('blocked'); } }) === false
    && openSearchTab('x', {}) === false && openSearchTab('x', undefined) === false);
  const card = searchCard('rust');
  check('web browse: blocked tabs get a Google link card', card.links[0].href === 'https://www.google.com/search?q=rust'
    && card.links[0].domain === 'google.com' && card.links[0].detail === 'Search: rust' && card.images.length === 0);

  // Image APIs.
  const wiki = new URL(wikimediaSearchUrl('red car'));
  check('web browse: Wikimedia query is a CORS-enabled bitmap file search with 400px thumbnails',
    wiki.origin === 'https://commons.wikimedia.org' && wiki.searchParams.get('origin') === '*' && wiki.searchParams.get('gsrsearch') === 'red car filetype:bitmap'
    && wiki.searchParams.get('gsrnamespace') === '6' && wiki.searchParams.get('iiurlwidth') === '400');
  const openverse = new URL(openverseSearchUrl('red car'));
  check('web browse: Openverse query excludes mature results', openverse.origin === 'https://api.openverse.org'
    && openverse.searchParams.get('q') === 'red car' && openverse.searchParams.get('mature') === 'false');
  check('web browse: Wikimedia results keep search order, images only, https only, readable titles',
    same(wikimediaPictures(wikimediaData).map((p) => [p.title, p.thumb]), [['First dog', 'https://upload.wikimedia.org/thumb/w1.png'], ['Second dog', 'https://upload.wikimedia.org/thumb/w2.jpg']])
    && wikimediaPictures(null).length === 0);
  const ov = openversePictures(openverseData);
  check('web browse: Openverse drops mature results and never links a non-https original',
    same(ov.map((p) => p.title), ['Dog one', 'Dog two']) && ov[1].full === ov[1].thumb && openversePictures({}).length === 0);
  const fallbacks = fallbackPictures('red car!');
  check('web browse: fallbacks are LoremFlickr tags then the requested source.unsplash.com URLs',
    fallbacks[0].thumb === 'https://loremflickr.com/400/300/red,car?lock=1' && fallbacks[2].thumb.endsWith('?lock=3')
    && fallbacks[3].thumb === 'https://source.unsplash.com/400x300/?red%20car!,1' && fallbacks[5].thumb.endsWith(',3') && fallbacks.length === 6);

  const calls = [];
  const found = await findImages('dog', { fetch: apiFetch(calls) });
  check('web browse: both APIs are searched and results interleave Wikimedia, Openverse, …',
    calls.length === 2 && same(found.slice(0, 4).map((p) => p.source), ['Wikimedia Commons', 'Openverse', 'Wikimedia Commons', 'Openverse'])
    && found[0].title === 'First dog' && found[1].title === 'Dog one');
  check('web browse: fallbacks follow the API results', found.length === 10 && found[4].source === 'LoremFlickr' && found[9].source === 'Unsplash');
  const failed = await findImages('dog', { fetch: async () => { throw new Error('offline'); } });
  check('web browse: offline APIs leave only the fallbacks, never a rejection', same(failed, fallbackPictures('dog')));
  const halfway = await findImages('dog', { fetch: async (url) => (url.includes('openverse') ? { ok: false, json: async () => ({}) } : json(wikimediaData)) });
  check('web browse: one failing API still uses the other', same(halfway.slice(0, 3).map((p) => p.source), ['Wikimedia Commons', 'Wikimedia Commons', 'LoremFlickr']));

  const timers = manualTimers();
  const signals = [];
  const slow = findImages('dog', { fetch: (url, { signal }) => { signals.push(signal); return new Promise(() => {}); }, timers });
  await tick();
  const timeouts = [...timers.pending.values()].map(({ ms }) => ms);
  timers.fire();
  const slowResult = await slow;
  check('web browse: a slow API times out after 5 seconds and its request is aborted',
    same(timeouts, [5000, 5000]) && signals.every((signal) => signal.aborted) && same(slowResult, fallbackPictures('dog')));
  const controller = new AbortController();
  const abortedSignals = [];
  const canceled = findImages('dog', { fetch: (url, { signal }) => { abortedSignals.push(signal); return new Promise(() => {}); }, signal: controller.signal, timers: manualTimers() });
  await tick();
  controller.abort();
  const canceledResult = await Promise.race([canceled, new Promise((resolve) => setTimeout(() => resolve('hung'), 200))]);
  check('web browse: a canceled reply aborts both API requests', canceledResult !== 'hung' && abortedSignals.length === 2 && abortedSignals.every((signal) => signal.aborted));

  // Gallery: three slots, failed images swap for the next candidate.
  let gallery = galleryStart(10);
  check('web browse: the gallery starts with the first three candidates', same(gallery.slots, [0, 1, 2]) && same(galleryStart(2).slots, [0, 1]));
  gallery = galleryAfterError(gallery, 1, 5);
  gallery = galleryAfterError(gallery, 1, 5);
  check('web browse: a broken image is replaced by the next unused candidate', same(gallery.slots, [0, 4, 2]));
  gallery = galleryAfterError(gallery, 0, 5);
  check('web browse: a slot with no candidates left is emptied', same(gallery.slots, [-1, 4, 2]) && same(galleryAfterError(gallery, 0, 5), gallery));
  const html = await renderGallery(richResponse("Here's what I found!", 'red <car>', [
    ...wikimediaPictures(wikimediaData),
    { thumb: 'https://x.test/t.jpg', full: 'https://x.test/f.jpg', title: '<b>tag</b>', source: 'Openverse' },
    ...fallbackPictures('red car'),
  ]));
  const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map(([tag]) => tag);
  check('web browse: the panel shows exactly three images', imgs.length === 3 && html.includes('rich-image-gallery') && !html.includes('rich-image-placeholder'));
  check('web browse: images lazy-load without sending a referrer', imgs.every((tag) => tag.includes('referrerPolicy="no-referrer"') || tag.includes('referrerpolicy="no-referrer"')) && imgs.every((tag) => tag.includes('loading="lazy"')));
  check('web browse: each image opens its full-size original in a protected new tab', html.includes('href="https://upload.wikimedia.org/w1.png"')
    && html.includes('href="https://x.test/f.jpg"') && [...html.matchAll(/<a\b[^>]*>/g)].every(([tag]) => tag.includes('target="_blank"') && tag.includes('rel="noopener noreferrer"')));
  check('web browse: Google Images stays one tap away and titles are escaped', html.includes('More on Google Images') && html.includes('tbm=isch')
    && html.includes('&lt;b&gt;tag&lt;/b&gt;') && html.includes('red &lt;car&gt;') && !html.includes('<b>tag'));

  // App flow with fetch/window doubles.
  const ready = async (options) => {
    const ui = await createAppHarness(options);
    ui.clock.tick();
    await ui.settle();
    return ui;
  };
  const ask = async (ui, question) => {
    ui.clock.tick();
    ui.flush();
    ui.recognition.instances[0].result(`hey nova ${question}`);
    ui.recognition.instances[0].end();
    await ui.settle();
  };
  const end = async (ui) => { ui.utterances.at(-1).onend(); await ui.settle(); };
  const panel = (ui) => ui.find('rich-content-slot')?.props.children.props.content;
  const chats = (ui) => ui.requests.filter((request) => request.url.endsWith('/chat/completions')).length;

  const pictures = await ready();
  const opens = [];
  pictures.window.open = (...args) => { opens.push(args); return {}; };
  const models = pictures.requests.length;
  pictures.fetchOverride = apiFetch();
  await ask(pictures, 'show me a dog');
  check('web browse app: image request says "Here\'s what I found!" without calling chat or opening tabs',
    pictures.utterances[0]?.text === IMAGE_FOUND_TEXT && chats(pictures) === 0 && opens.length === 0);
  check('web browse app: both image APIs are queried while NOVA speaks', pictures.requests.slice(models).filter((r) => /wikimedia|openverse/.test(r.url)).length === 2 && !panel(pictures));
  await end(pictures);
  const shown = panel(pictures)?.images[0];
  check('web browse app: after speaking, the panel gets the found pictures and a Google Images link',
    shown?.query === 'dog' && shown.pictures?.[0]?.title === 'First dog' && shown.pictures?.[1]?.title === 'Dog one'
    && new URL(shown.href).searchParams.get('tbm') === 'isch');
  check('web browse app: the found-pictures panel uses the usual 30 second lifetime', (() => {
    pictures.clock.tick(29_999); pictures.flush();
    const before = !panel(pictures) ? false : !pictures.find('rich-content-slot').props.children.props.closing;
    pictures.clock.tick(1); pictures.flush();
    return before && pictures.find('rich-content-slot')?.props.children.props.closing === true;
  })());
  pictures.unmount();

  const offline = await ready({ modelsOffline: true });
  await ask(offline, 'what does a red panda look like?');
  await end(offline);
  check('web browse app: unreachable image APIs fall back to LoremFlickr/Unsplash pictures',
    same(panel(offline)?.images[0]?.pictures?.map((p) => p.source), ['LoremFlickr', 'LoremFlickr', 'LoremFlickr', 'Unsplash', 'Unsplash', 'Unsplash']));
  offline.unmount();

  const search = await ready();
  const tabs = [];
  const newTab = { opener: 'nova' };
  search.window.open = (...args) => { tabs.push({ args, utterances: search.utterances.length }); return newTab; };
  await ask(search, 'search for best pizza in Dhaka');
  check('web browse app: web search opens Google in a new tab before speaking',
    tabs.length === 1 && same(tabs[0].args, ['https://www.google.com/search?q=best%20pizza%20in%20Dhaka', '_blank']) && tabs[0].utterances === 0 && newTab.opener === null);
  check('web browse app: NOVA says "Opening that search for you!" without calling chat', search.utterances[0]?.text === WEB_SEARCH_TEXT && chats(search) === 0);
  await end(search);
  check('web browse app: an opened search needs no extra panel', !panel(search));
  search.unmount();

  const blocked = await ready();
  blocked.window.open = () => null;
  await ask(blocked, 'look up the capital of Peru');
  check('web browse app: a blocked tab is explained honestly', blocked.utterances[0]?.text === WEB_SEARCH_BLOCKED_TEXT && chats(blocked) === 0);
  await end(blocked);
  check('web browse app: a blocked tab leaves a tappable Google search card',
    panel(blocked)?.links[0]?.href === 'https://www.google.com/search?q=the%20capital%20of%20Peru' && panel(blocked).links[0].domain === 'google.com');
  blocked.unmount();

  const chat = await ready();
  const chatTabs = [];
  chat.window.open = (...args) => { chatTabs.push(args); return {}; };
  await ask(chat, 'What would you suggest?');
  check('web browse app: ordinary questions still go to the model and never open tabs', chats(chat) === 1 && chatTabs.length === 0);
  chat.unmount();
}
