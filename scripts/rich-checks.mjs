// Structural/behavioral rich-response checks, not a browser layout/audio review.
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  MAX_RICH_ITEMS, MAX_RICH_LINKS, RICH_FADE_MS, RICH_VISIBLE_MS, googleImagesLink,
  hasRichResponse, imageSearchQuery, responseItems, responseLinks, richResponse,
} from '../src/rich-response.js';
import { createVoiceListener } from '../src/speech.js';
import { createAppHarness, createClock, createRecognitionDouble } from './speech-test-fixtures.mjs';

const run = promisify(execFile);
const props = (ui) => ui.find('rich-content-slot')?.props.children.props;
const content = (ui) => props(ui)?.content;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sample = 'Try https://www.example.com/guide.\n1. **Coffee**\n2. Tea\n- A quiet walk';
async function ready(options) {
  const ui = await createAppHarness(options);
  ui.clock.tick();
  await ui.settle();
  return ui;
}
async function ask(ui, question = 'What would you suggest?') {
  ui.clock.tick();
  ui.flush();
  ui.recognition.instances[0].result(`hey nova ${question}`);
  ui.recognition.instances[0].end();
  await ui.settle();
}
async function end(ui) { ui.utterances.at(-1).onend(); await ui.settle(); }
async function panelFor(options) {
  const ui = await ready(options);
  ui.chatAnswer = sample;
  await ask(ui);
  await end(ui);
  ui.clock.tick(); // Standby onstart must not count as the user speaking.
  ui.flush();
  return ui;
}
async function renderRich(data, closing = false) {
  const { outputFiles } = await build({
    stdin: { contents: `
      import { createElement } from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import RichResponsePanel from './src/RichResponsePanel.jsx';
      process.stdout.write(renderToStaticMarkup(createElement(RichResponsePanel, {
        content: ${JSON.stringify(data)}, closing: ${closing}, onClose() {},
      })));
    `, resolveDir: process.cwd(), loader: 'jsx' },
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', logLevel: 'warning',
  });
  const dir = await mkdtemp(join(tmpdir(), 'nova-rich-'));
  try {
    const file = join(dir, 'panel.cjs');
    await writeFile(file, outputFiles[0].text);
    return (await run(process.execPath, [file])).stdout;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export async function verifyRich(check) {
  check('rich timing: 30 seconds visible, then a 280ms fade', RICH_VISIBLE_MS === 30000 && RICH_FADE_MS === 280);
  const urls = responseLinks('See (https://www.example.com/a_(b)). Also http://docs.example.org/help?x=1&y=2!');
  check('rich URLs: HTTP/HTTPS links expose their real domain names', urls.length === 2 && urls[0].domain === 'example.com' && urls[1].domain === 'docs.example.org');
  check('rich URLs: prose punctuation is trimmed without breaking balanced parentheses', urls[0].href === 'https://www.example.com/a_(b)'
    && urls[1].href === 'http://docs.example.org/help?x=1&y=2');
  check('rich URLs: Markdown links and autolinks are detected', responseLinks('[Docs](https://example.com/docs) and <https://example.org/>').length === 2);
  check('rich URLs: bold/italic Markdown wrappers are not part of the destination', responseLinks('**https://example.com/a** _https://example.com/b_ **[Wiki](https://example.com/wiki_(a))**').map((link) => link.href).join(' ')
    === 'https://example.com/a https://example.com/b https://example.com/wiki_(a)');
  check('rich URLs: canonical duplicates are not repeated', responseLinks('https://EXAMPLE.com https://example.com/').length === 1);
  check('rich URLs: schemes are case-insensitive and different paths remain distinct', responseLinks('HTTPS://EXAMPLE.COM/a https://example.com/b').length === 2);
  check('rich URLs: unsafe/relative/credential-bearing URLs never become cards', responseLinks('javascript:alert(1) data:text/html,hi file:///etc/passwd /path www.example.com https://user:secret@example.com/ http://').length === 0);
  check('rich URLs: markup is not part of a clickable target', responseLinks('https://example.com/<img src=x>')[0].href === 'https://example.com/');
  check('rich URLs: IPv6 and fragments survive delimiter cleanup', responseLinks('(http://[::1]:8080/docs#read).')[0].href === 'http://[::1]:8080/docs#read');
  check('rich URLs: mixed closing delimiters are trimmed until stable', responseLinks('(see https://example.com.) [https://example.org/a!] https://example.net/b…').map((link) => link.href).join(' ')
    === 'https://example.com/ https://example.org/a https://example.net/b');
  check('rich URLs: trailing-dot hostnames cannot evade duplicate removal', responseLinks('https://example.com (or https://example.com.)').length === 1);
  check('rich URLs: rendering is bounded without mutating spoken text', responseLinks(Array.from({ length: 100 }, (_, i) => `https://example.com/${i}`).join('\n')).length === MAX_RICH_LINKS);
  const items = responseItems('A few ideas:\n1. **Coffee**\n2) __Tea__\n- A walk\n* `Music`\n• A book\n+ [A guide](https://example.com)');
  check('rich lists: numbered, parenthesized, and bullet markers become clean labels', same(items, ['Coffee', 'Tea', 'A walk', 'Music', 'A book', 'A guide']));
  check('rich lists: balanced Markdown link destinations leave a clean label', responseItems('- [Wiki](https://example.com/wiki_(a))')[0] === 'Wiki');
  check('rich lists: fenced code and ordinary prose are not mistaken for lists', same(responseItems('There are 3.5 cups.\n```text\n1. example code\n```\n- A real item'), ['A real item']));
  check('rich lists: task boxes and CRLF work while intentional repeats remain', same(responseItems('- [x] Done\r\n- [ ] Next\r\n- Next'), ['Done', 'Next', 'Next']));
  check('rich lists: single emphasis is cleaned without rewriting underscores in names', same(responseItems('- *Coffee*\n- _Tea_\n- file_name_here'), ['Coffee', 'Tea', 'file_name_here']));
  check('rich lists: empty bullets/rules are ignored and large lists are bounded', responseItems('-\n---\n1.').length === 0
    && responseItems(Array.from({ length: 100 }, (_, i) => `${i + 1}. Item ${i}`).join('\n')).length === MAX_RICH_ITEMS);
  check('rich lists: spaced Markdown rules and marker-only lines never become cards', same(responseItems('* * *\n- - -\n- …\n- Real item'), ['Real item']));
  for (const request of ['show me a picture of cats', 'Can you please show me an image of cats?', 'find photos of cats', 'Please search Google Images for cats.', 'I’d like to see a photo of cats']) {
    check(`rich images: intent extracts the query (${request})`, imageSearchQuery(request) === 'cats');
  }
  check('rich images: unrelated questions and incomplete requests stay normal chat', imageSearchQuery('What does show me a picture mean?') === null
    && imageSearchQuery('show me a picture of') === null && imageSearchQuery('remember my name is Photo') === null);
  const query = 'cats & dogs / ঢাকা #sunrise';
  const search = new URL(googleImagesLink(query));
  check('rich images: Google Images queries are encoded safely and accurately', search.origin === 'https://www.google.com'
    && search.pathname === '/search' && search.searchParams.get('tbm') === 'isch' && search.searchParams.get('q') === query);
  const google = richResponse('https://www.google.com/search?q=cats&udm=2');
  check('rich images: response Google Images URLs also become visual search cards', google.images[0]?.query === 'cats' && google.links.length === 0);
  check('rich images: lookalike domains remain ordinary links, not Google placeholders', richResponse('https://www.google.com.evil.test/search?tbm=isch&q=cats').images.length === 0);
  check('rich data: empty prose produces no panel', !hasRichResponse(richResponse('A kind, short reply.')) && !hasRichResponse(null));
  check('rich data: image intent plus an existing search URL is not duplicated', richResponse(googleImagesLink('cats'), 'cats').images.length === 1);
  check('rich data: bounded previews honestly flag remaining content', richResponse(Array.from({ length: 61 }, (_, i) => `- Item ${i}`).join('\n')).truncated
    && !richResponse('- One item').truncated);

  const html = await renderRich(richResponse('https://example.com/docs?a=1&b=2\n- <img src=x onerror=alert(1)>', '<b>cats & dogs</b>'));
  check('rich markup: link cards show domain and a subtle open icon', /class="rich-link-card"/.test(html) && html.includes('<strong>example.com</strong>') && html.includes('rich-open-icon'));
  check('rich markup: every navigation link uses native new-tab and opener protection', [...html.matchAll(/<a\b[^>]*>/g)].every(([tag]) => tag.includes('target="_blank"') && tag.includes('rel="noopener noreferrer"')));
  check('rich markup: images have a local placeholder and View Images action', html.includes('rich-image-placeholder') && html.includes('View Images') && !/<img\b/.test(html));
  check('rich markup: model list text and image queries are escaped, never HTML', html.includes('&lt;img src=x onerror=alert(1)&gt;') && html.includes('&lt;b&gt;cats &amp; dogs&lt;/b&gt;') && !html.includes('<b>cats'));
  check('rich markup: labelled region/list and a non-submit close action remain accessible', html.includes('aria-labelledby="rich-content-title"')
    && html.includes('aria-label="Items from my reply"') && /type="button" aria-label="Close extra content"/.test(html));
  const fading = await renderRich(richResponse(sample, 'cats'), true);
  check('rich markup: fading cards cannot be clicked or tabbed into', fading.includes('inert=""') && fading.includes('aria-hidden="true"')
    && [...fading.matchAll(/<a\b[^>]*>/g)].every(([tag]) => tag.includes('tabindex="-1"')) && fading.includes('disabled=""'));

  const ui = await ready();
  ui.chatAnswer = sample;
  await ask(ui);
  check('rich lifecycle: spoken URL/list reply is unchanged and no cards appear in the queue', ui.utterances[0]?.text === sample && !props(ui));
  ui.utterances[0].onstart();
  ui.clock.tick(45000);
  ui.flush();
  check('rich lifecycle: a slow speaker does not start or consume the panel timeout', !props(ui));
  await end(ui);
  check('rich lifecycle: actual speech end publishes links and list cards', content(ui)?.links[0].domain === 'example.com' && same(content(ui)?.items, ['Coffee', 'Tea', 'A quiet walk']));
  check('rich lifecycle: visuals work without enabling the optional transcript', !ui.find('response-transcript') && Boolean(props(ui)));
  ui.clock.tick();
  ui.flush();
  check('rich lifecycle: standby restarting does not dismiss a fresh response panel', !props(ui)?.closing && Boolean(ui.find('wake-indicator')));
  const children = ui.tree.props.children;
  check('rich layout: sheet has its own row outside/below the avatar and before controls', children.indexOf(ui.find('rich-content-slot')) > children.indexOf(ui.find('main-stage'))
    && children.indexOf(ui.find('rich-content-slot')) < children.indexOf(ui.find('control-dock')) && ui.tree.props.className.includes('has-rich-content'));
  ui.clock.tick(RICH_VISIBLE_MS - 1);
  ui.flush();
  check('rich lifecycle: panel remains until 30 seconds after actual speech completion', props(ui) && !props(ui).closing);
  ui.clock.tick(1);
  ui.flush();
  check('rich lifecycle: timeout begins a fade at exactly 30 seconds', props(ui)?.closing === true);
  ui.clock.tick(RICH_FADE_MS - 1);
  ui.flush();
  check('rich lifecycle: closing row is retained for the full fade', Boolean(props(ui)));
  ui.clock.tick(1);
  ui.flush();
  check('rich lifecycle: expired content and its layout reservation are removed', !props(ui) && !ui.tree.props.className.includes('has-rich-content'));
  ui.unmount();

  const speech = await panelFor();
  let focused = 0;
  speech.find('rich-content-slot').props.ref.current = { contains: () => true };
  speech.find('mic-button').props.ref.current = { focus() { focused += 1; } };
  speech.window.dispatch('keydown', { code: 'Space', target: { closest: (selector) => selector.includes('.rich-content-panel') }, preventDefault() { throw new Error('Panel space should scroll, not toggle the mic'); } });
  check('rich keyboard: Space inside cards never starts voice input', !props(speech)?.closing && speech.find('status-word').props.className.includes('status-word-ready'));
  speech.recognition.instances[0].speechStart();
  speech.flush();
  check('rich dismissal: real speech detection fades cards and restores stranded focus', props(speech)?.closing && focused === 1);
  speech.clock.tick(200);
  speech.recognition.instances[0].result('background speech');
  speech.flush();
  speech.clock.tick(80);
  speech.flush();
  check('rich dismissal: subsequent transcript events never prolong or revive the fade', !props(speech));
  speech.unmount();

  const fallback = await panelFor();
  fallback.recognition.instances[0].result('hello again', false);
  fallback.flush();
  check('rich dismissal: transcript fallback works even without a speechstart event', props(fallback)?.closing);
  fallback.unmount();
  const manual = await panelFor();
  manual.find('mic-button').props.onClick();
  manual.flush();
  check('rich dismissal: manual mic input clears the old response too', props(manual)?.closing && manual.find('status-word').props.className.includes('status-word-listening'));
  manual.unmount();
  const close = await panelFor();
  props(close).onClose();
  close.flush();
  check('rich dismissal: explicit close uses the same safe fade', props(close)?.closing === true);
  close.unmount();
  const settings = await panelFor();
  settings.find('settings-trigger').props.onClick();
  settings.flush();
  check('rich dismissal: settings immediately clears cards and expiry callbacks', !props(settings) && !settings.tree.props.className.includes('has-rich-content'));
  settings.unmount();

  const images = await ready({ modelsOffline: true });
  await ask(images, 'show me a picture of cats & dogs');
  check('rich image requests: spoken answer is the requested found-pictures line, panel waits for speech', images.utterances[0]?.text === "Here's what I found!" && !props(images));
  // The App persists the display theme on its first paint, under its own key; that write is
  // not a memory and not a setting, so a picture search is still expected to leave none behind.
  const imageWrites = images.storage.writes.filter((write) => write.key !== 'nova_theme');
  check('rich image requests: local search does not call chat or write memories/preferences', !images.requests.some((request) => request.url.endsWith('/chat/completions')) && imageWrites.length === 0);
  await end(images);
  const browsing = images.nodes().find((node) => node.props.browse && node.props.onClose)?.props.browse;
  check('rich image requests: results open in the browsing panel (Google Images), not as a rich card', !props(images)
    && browsing?.kind === 'images' && new URL(browsing.url).searchParams.get('q') === 'cats & dogs');
  images.unmount();
  const silent = await ready({ speech: false });
  silent.chatAnswer = sample;
  await ask(silent);
  check('rich fallback: a browser without audio still gets usable visual replies', Boolean(content(silent)?.links.length) && silent.utterances.length === 0);
  silent.unmount();
  for (const startupError of [false, true]) {
    const failed = await ready();
    failed.chatAnswer = sample;
    failed.speechThrows = startupError;
    await ask(failed);
    if (!startupError) { failed.utterances[0].onerror(); await failed.settle(); }
    check(`rich failures: ${startupError ? 'startup exception' : 'utterance error'} never publishes unfinished speech`, !props(failed));
    failed.unmount();
  }
  const plain = await ready();
  await ask(plain);
  await end(plain);
  check('rich prose: ordinary replies do not open empty chrome or allocate a panel', !props(plain));
  plain.unmount();

  const overlap = await panelFor();
  overlap.chatAnswer = 'A new link: https://second.example.org/';
  await ask(overlap, 'What else can we try?');
  const previous = overlap.utterances[0];
  await end(overlap); // Completes the new reply while the previous fade is pending.
  previous.onend();
  await overlap.settle();
  overlap.clock.tick(RICH_FADE_MS);
  overlap.flush();
  check('rich races: old fade/speech callbacks cannot erase or replace a newer panel', content(overlap)?.links[0].domain === 'second.example.org' && !props(overlap)?.closing);
  overlap.unmount();
  check('rich cleanup: unmount cancels expiry, fade, recognition and word timers', overlap.clock.pending === 0);

  const interrupted = await ready();
  interrupted.chatAnswer = sample;
  await ask(interrupted);
  interrupted.find('settings-trigger').props.onClick();
  interrupted.flush();
  interrupted.nodes().find((node) => node.props.onClose).props.onClose();
  interrupted.flush();
  await end(interrupted);
  check('rich races: opening and closing settings invalidates a pending panel', !props(interrupted));
  interrupted.unmount();
  const dying = await ready();
  dying.chatAnswer = sample;
  await ask(dying);
  dying.unmount();
  dying.utterances[0].onend();
  await dying.settle();
  check('rich cleanup: speech finishing after unmount cannot publish cards or timers', !props(dying) && dying.clock.pending === 0);

  const pending = await ready();
  pending.deferChat = true;
  pending.chatAnswer = sample;
  await ask(pending);
  pending.find('settings-trigger').props.onClick();
  pending.flush();
  pending.nodes().find((node) => node.props.onClearMemory).props.onClearMemory();
  pending.pendingChats[0].resolve();
  await pending.settle();
  check('rich privacy: memory edits cancel late model responses before they can become cards', pending.utterances.length === 0 && !props(pending));
  pending.unmount();
  const canceled = await ready();
  canceled.chatAnswer = sample;
  await ask(canceled);
  canceled.find('settings-trigger').props.onClick();
  canceled.flush();
  canceled.nodes().find((node) => node.props.onClearMemory).props.onClearMemory();
  canceled.utterances[0].onend();
  await canceled.settle();
  check('rich privacy: canceled speech never resurrects visual facts after deletion', !props(canceled));
  canceled.unmount();

  const clock = createClock();
  const recognition = createRecognitionDouble(clock);
  let detections = 0;
  const listener = createVoiceListener({ Recognition: recognition.Recognition, timers: clock, now: clock.now, onSpeechDetected: () => detections += 1 });
  listener.setMode('standby');
  clock.tick();
  check('rich recognition: session start alone never signals actual user speech', detections === 0);
  recognition.instances[0].speechStart();
  recognition.instances[0].result('background words');
  check('rich recognition: speechstart and transcript fallback notify without creating a question', detections === 2);
  listener.setMode(null);
  recognition.instances[0].speechStart();
  recognition.instances[0].result('stale words');
  check('rich recognition: paused/late speech callbacks cannot affect an active answer', detections === 2);
  listener.dispose();
  check('rich recognition: the new event callback is cleared on dispose', recognition.instances[0].onspeechstart === null);

  const css = await readFile('src/index.css', 'utf8');
  const rule = (selector) => css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]+)\\}`))?.[1] || '';
  const layout = rule('.app-shell.has-rich-content');
  check('rich layout CSS: separate fourth grid row with intrinsic avatar clearance', layout.includes('minmax(min-content, 1fr) auto var(--dock-height)') && layout.includes('height: auto') && layout.includes('min-height: 100dvh'));
  check('rich layout CSS: no sheet overlay; long replies scroll inside a bounded row', !/position: (?:fixed|absolute)/.test(rule('.rich-content-slot') + rule('.rich-content-panel'))
    && rule('.rich-content-slot').includes('overflow: hidden') && rule('.rich-content-panel').includes('overflow-y: auto'));
  check('rich motion CSS: entrance slides up inside its row, dismissal only fades', css.includes('@keyframes rich-panel-in { from { opacity: 0; transform: translateY(24px); }')
    && css.includes('@keyframes rich-panel-out { from { opacity: 1; } to { opacity: 0; } }'));
  check('rich responsive CSS: header/dock metrics reserve space for the avatar picker at each breakpoint', css.includes('--topbar-height: 76px;') && css.includes('--dock-height: 278px;')
    && css.includes('--topbar-height: 68px; --dock-height: 252px;') && css.includes('--topbar-height: 72px; --dock-height: 252px;'));
  check('rich reduced motion: existing universal animation/transition override covers the sheet', /@media \(prefers-reduced-motion: reduce\)/.test(css) && css.includes('animation-duration: .01ms !important') && css.includes('transition-duration: .01ms !important'));
}
