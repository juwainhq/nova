// Appearance-only regressions against the real compiled App. Recognition, audio,
// network and storage are doubles; actual rendering is covered by verify-avatar.
import { readFile } from 'node:fs/promises';
import { AVATAR_STORAGE_KEY, AVATARS, avatarExpression, readAvatar } from '../src/avatar.js';
import { MEMORY_KEY } from '../src/memory.js';
import { createAppHarness, createStorageDouble } from './speech-test-fixtures.mjs';

const component = (ui, name) => ui.nodes().find((node) => node.type?.name === name);
const picker = (ui) => component(ui, 'AvatarSwitcher');
const drawing = (ui) => component(ui, 'BotAvatar');
const choice = (ui, id) => picker(ui).type(picker(ui).props).props.children.find((node) => node.props['data-avatar-choice'] === id);
const select = (ui, id) => { choice(ui, id).props.onClick(); ui.flush(); };
const atStage = (ui, stage) => ui.find('status-word')?.props.className.includes(`status-word-${stage}`);
const ready = async (options) => {
  const ui = await createAppHarness(options);
  ui.clock.tick();
  await ui.settle();
  return ui;
};
const ask = async (ui, text) => {
  const mic = ui.recognition.instances[0];
  mic.result(`hey nova ${text}`);
  mic.end();
  await ui.settle();
};

export async function verifyAvatarSwitch(check) {
  check('avatars: the choice is explicitly Orb / Bot, under nova_avatar', AVATAR_STORAGE_KEY === 'nova_avatar'
    && AVATARS.map(({ id, name }) => `${id}:${name}`).join(',') === 'orb:Orb,bot:Bot');
  check('avatars: a missing preference defaults to Orb', readAvatar(createStorageDouble()) === 'orb');
  check('avatars: a saved Bot is restored', readAvatar(createStorageDouble({ nova_avatar: 'bot' })) === 'bot');
  check('avatars: unknown/corrupt values cannot create arbitrary avatar classes', ['', 'Bot', 'invalid', '<script>', '__proto__'].every((value) =>
    readAvatar(createStorageDouble({ nova_avatar: value })) === 'orb'));
  const denied = createStorageDouble();
  denied.readError = true;
  check('avatars: denied storage falls back safely', readAvatar(denied) === 'orb');
  for (const [stage, mood, expected] of [
    ['ready', 'idle', 'idle'], ['ready', 'happy', 'happy'], ['listening', 'wake', 'waking'],
    ['listening', 'idle', 'listening'], ['thinking', 'wake', 'thinking'], ['speaking', 'happy', 'speaking'],
  ]) check(`Bot expression: ${stage}/${mood} draws ${expected}`, avatarExpression(stage, mood) === expected);

  const store = createStorageDouble({
    [MEMORY_KEY]: JSON.stringify({ facts: ['my favorite color is orange'] }),
    'nova.ollama.model': 'custom-model', 'nova.ollama.url': 'https://models.example/v1',
    'nova.tts.voice': 'samantha', 'nova.kokoro.voice': 'bf_emma', 'nova.transcript.visible': 'true',
  });
  const ui = await ready({ storage: store });
  const mic = ui.recognition.instances[0];
  check('avatars: first render keeps the existing Orb and no Bot', Boolean(component(ui, 'RobotAvatar')) && !drawing(ui)
    && ui.tree.props['data-avatar'] === 'orb' && ui.tree.props.className.includes('avatar-orb'));
  check('avatars: default Orb receives the same idle expression input as Bot', component(ui, 'RobotAvatar').props.expression === 'idle');
  check('avatars: merely loading the app never writes an avatar preference', !store.writes.some(({ key }) => key === AVATAR_STORAGE_KEY));
  check('avatars: the picker is a labelled group with native keyboard buttons', picker(ui).type(picker(ui).props).props.role === 'group'
    && ['orb', 'bot'].every((id) => choice(ui, id).type === 'button' && choice(ui, id).props.type === 'button'
      && choice(ui, id).props['aria-label'].includes('avatar')));
  check('avatars: only the default Orb is pressed and highlighted', choice(ui, 'orb').props['aria-pressed'] === true
    && choice(ui, 'orb').props.className.includes('is-selected') && choice(ui, 'bot').props['aria-pressed'] === false);

  const attributes = new Map();
  ui.document.documentElement = { setAttribute: (key, value) => attributes.set(key, value) };
  const before = { requests: ui.requests.length, starts: mic.starts.length, aborts: mic.aborts, cancels: ui.cancellations, writes: store.writes.length, timers: ui.clock.pending };
  select(ui, 'bot');
  check('avatars: one click replaces the drawing and full shell palette', Boolean(drawing(ui)) && !component(ui, 'RobotAvatar')
    && ui.tree.props.className.includes('avatar-bot') && ui.tree.props['data-avatar'] === 'bot');
  check('avatars: body-mounted background blobs receive the same palette', attributes.get('data-avatar') === 'bot');
  check('avatars: active circle and accessible pressed state move to Bot', choice(ui, 'bot').props['aria-pressed'] === true
    && choice(ui, 'bot').props.className.includes('is-selected') && choice(ui, 'orb').props['aria-pressed'] === false);
  check('avatars: selection writes exactly one preference, not memory/voice/model settings', store.getItem(AVATAR_STORAGE_KEY) === 'bot'
    && store.writes.length === before.writes + 1 && store.writes.at(-1).key === AVATAR_STORAGE_KEY
    && store.getItem(MEMORY_KEY).includes('orange') && store.getItem('nova.kokoro.voice') === 'bf_emma');
  check('avatars: selection cannot restart recognition, cancel speech, send a request or add a controller timer', ui.requests.length === before.requests
    && mic.starts.length === before.starts && mic.aborts === before.aborts && ui.cancellations === before.cancels
    && ui.clock.pending === before.timers);
  const reloaded = await ready({ storage: store });
  check('avatars: a fresh mount restores Bot and its palette', Boolean(drawing(reloaded)) && reloaded.tree.props.className.includes('avatar-bot'));
  reloaded.unmount();
  select(ui, 'orb');
  check('avatars: switching back restores Orb and persists it', !drawing(ui) && Boolean(component(ui, 'RobotAvatar'))
    && store.getItem(AVATAR_STORAGE_KEY) === 'orb' && attributes.get('data-avatar') === 'orb');
  const writeCount = store.writes.length;
  picker(ui).props.onChange('unknown');
  ui.flush();
  check('avatars: an invalid selection is ignored', store.writes.length === writeCount && ui.tree.props['data-avatar'] === 'orb');
  ui.unmount();
  check('avatars: switching adds no unmount cleanup debt', ui.clock.pending === 0);

  const lightStore = createStorageDouble({ nova_avatar: 'bot', nova_theme: 'light' });
  const light = await ready({ storage: lightStore });
  check('avatars: light/dark remains independent from the avatar palette', light.tree.props.className.includes('avatar-bot')
    && light.tree.props.className.includes('theme-light'));
  select(light, 'orb');
  check('avatars: returning to Orb preserves the saved light preference', light.tree.props.className.includes('theme-light')
    && lightStore.getItem('nova_theme') === 'light');
  light.unmount();

  const blockedStore = createStorageDouble();
  blockedStore.readError = blockedStore.writeError = true;
  const blocked = await ready({ storage: blockedStore });
  select(blocked, 'bot');
  check('avatars: blocked storage does not stop the immediate visual switch', Boolean(drawing(blocked)) && blockedStore.writes.length === 0);
  blocked.unmount();

  const waking = await ready({ storage: createStorageDouble({ nova_avatar: 'bot' }) });
  waking.recognition.instances[0].result('hey nova');
  waking.flush();
  check('avatars: the existing wake mood draws happy Bot eyes', drawing(waking)?.props.expression === 'waking' && atStage(waking, 'listening'));
  waking.recognition.instances[0].end();
  waking.clock.tick(800);
  waking.flush();
  check('avatars: the original 800ms wake expiry reveals the listening Bot', drawing(waking)?.props.expression === 'listening');
  const listeningAborts = waking.recognition.instances[0].aborts;
  select(waking, 'orb');
  select(waking, 'bot');
  check('avatars: switching while listening leaves question capture running', drawing(waking)?.props.expression === 'listening'
    && waking.recognition.instances[0].aborts === listeningAborts);
  waking.unmount();

  const active = await ready();
  active.deferChat = true;
  await ask(active, 'tell me something');
  const request = active.pendingChats[0];
  check('avatars: Orb receives the pending thinking state', component(active, 'RobotAvatar').props.expression === 'thinking');
  select(active, 'bot');
  check('avatars: a pending model request survives the switch with thinking eyes', drawing(active)?.props.expression === 'thinking'
    && atStage(active, 'thinking') && request.options.signal.aborted === false);
  request.resolve();
  await active.settle();
  const utterance = active.utterances.at(-1);
  const cancels = active.cancellations;
  const utteranceCount = active.utterances.length;
  const outerRef = active.find('avatar-container').props.ref;
  select(active, 'orb');
  check('avatars: Orb receives the ongoing speaking state without replaying audio', component(active, 'RobotAvatar').props.expression === 'speaking');
  utterance.onboundary({ name: 'word', charLength: 4 });
  select(active, 'bot');
  check('avatars: switching mid-reply never cancels or requeues audio', atStage(active, 'speaking') && active.cancellations === cancels
    && active.utterances.length === utteranceCount && active.utterances.at(-1) === utterance && !request.options.signal.aborted);
  check('avatars: the new Bot immediately draws the ongoing speaking state', drawing(active)?.props.expression === 'speaking');
  check('avatars: the live speech pulse keeps the same outer DOM ref', active.find('avatar-container').props.ref === outerRef
    && Number(active.avatarElement.style.getPropertyValue('--audio-pulse')) > 0);
  utterance.onend();
  await active.settle();
  check('avatars: real speech completion draws the existing happy mood', atStage(active, 'ready') && drawing(active)?.props.expression === 'happy');
  select(active, 'orb');
  check('avatars: Orb receives the same happy completion mood', component(active, 'RobotAvatar').props.expression === 'happy');
  select(active, 'bot');
  active.clock.tick(1500);
  active.flush();
  check('avatars: the original happy timeout restores the idle Bot', drawing(active)?.props.expression === 'idle');
  active.unmount();

  const browse = await ready();
  await ask(browse, 'search for blue robots');
  const panel = component(browse, 'BrowsePanel');
  const browseSnapshot = panel.props.browse;
  const requests = browse.requests.length;
  select(browse, 'bot');
  check('avatars: an open browser keeps its exact URL, history and frame state', component(browse, 'BrowsePanel').props.browse === browseSnapshot
    && browse.requests.length === requests);
  browse.unmount();

  const css = await readFile(new URL('../src/avatar.css', import.meta.url), 'utf8');
  const base = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
  const palette = css.slice(css.indexOf(":root[data-avatar='bot']"), css.indexOf('}', css.indexOf(":root[data-avatar='bot']")));
  check('Bot palette: specified navy base, blue blobs, glass and sky text', ['--canvas: #0a0a2e;', '--ink: #e0f2fe;', '--accent: #3b82f6;',
    '--card: rgba(10, 10, 46, .85);', '--glass: blur(20px);', '--blob-1: #1d4ed8;', '--blob-2: #3b82f6;', '--blob-3: #1e3a8a;', '--blob-4: #60a5fa;']
    .every((token) => palette.includes(token)));
  check('Bot palette: the existing light control gets a blue, not amber, variant', css.includes(":root[data-avatar='bot'][data-theme='light'], .app-shell.avatar-bot.theme-light")
    && css.includes('--canvas: #f4f8ff;'));
  check('Bot palette: browse border and address focus use the avatar accent', css.includes('.avatar-bot .browse-panel { border-color: var(--accent); }')
    && base.includes('.browse-address-input:focus { border-color: var(--accent);'));
  check('Bot palette: sheet accents no longer hardcode orange', !/#f97316|rgba\(249, 115, 22/.test(base.slice(base.indexOf('.settings-panel-backdrop')).replace(/\/\*[\s\S]*?\*\//g, '')));
  check('Bot palette: the cream mic is blue, but Stop keeps its red safety color', css.includes('.avatar-bot .mic-button:not(.mic-button-stop)')
    && css.includes('.avatar-bot .mic-button-active { animation-name: bot-mic-active; }') && base.includes('.mic-button-stop { background: linear-gradient(145deg, #ff7a66'));
  check('avatars: the selector is in document layout, not fixed over other controls', /\.control-dock \{ flex-direction: column;/.test(css)
    && !/\.avatar-switcher \{[^}]*position: (?:absolute|fixed)/.test(css));
}
