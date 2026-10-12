// Exercise both real avatar components and its local hook, not a duplicate reaction
// implementation. The same deterministic clock catches cancellation/leak bugs.
import { AVATAR_EXPRESSIONS } from '../src/avatar-expressions.js';
import { createAppHarness } from './speech-test-fixtures.mjs';

const face = (ui) => ui.tree.props['data-expression'];
const step = (ui, ms) => { ui.clock.tick(ms); ui.flush(); };
const mode = (ui, expression) => ui.updateProps({ expression });
const touch = (ui) => { ui.tree.props.onPointerDown(); ui.flush(); };

export async function verifyAvatarExpressions(record) {
 for (const skin of ['Bot', 'Orb']) {
  const check = (label, ...rest) => record(label.replace(/^Bot/, skin), ...rest);
  const createAvatarHarness = (options) => createAppHarness(skin === 'Orb'
    ? { ...options, orbProps: options.botProps, botProps: null } : options);
  const requested = ['neutral', 'happy', 'wink', 'surprised', 'thinking', 'sleepy', 'speaking', 'listening', 'idle'];
  check('Bot vocabulary: every expression/state on the reference is supported', requested.every((name) => AVATAR_EXPRESSIONS.includes(name)));
  for (const expression of [...requested, 'waking']) {
    const ui = await createAvatarHarness({ botProps: { expression } });
    check(`Bot expression: ${expression} renders immediately with an accurate accessible label`, face(ui) === expression
      && ui.tree.props['aria-label'].endsWith(`— ${expression}`) && ui.tree.props['data-activity'] === expression);
    ui.unmount();
    check(`Bot expression: ${expression} leaves no visual timers on unmount`, ui.clock.pending === 0);
  }
  const invalid = await createAvatarHarness({ botProps: { expression: 'unknown' } });
  check('Bot expression: invalid input remains neutral with no timers', face(invalid) === 'neutral' && invalid.clock.pending === 0);
  invalid.unmount();

  const ui = await createAvatarHarness({ botProps: { expression: 'idle' } });
  check('Bot reactions: idle starts with only its three local deadlines', face(ui) === 'idle' && ui.clock.pending === 3);
  step(ui, 11999);
  check('Bot reactions: idle does not wink early', face(ui) === 'idle');
  step(ui, 1);
  check('Bot reactions: an unattended ready Bot winks after 12 seconds', face(ui) === 'wink' && ui.tree.props['data-activity'] === 'idle');
  step(ui, 799);
  check('Bot reactions: wink stays visible for its full 800ms', face(ui) === 'wink');
  step(ui, 1);
  check('Bot reactions: wink returns to idle, not a different assistant activity', face(ui) === 'idle');
  step(ui, 32199);
  check('Bot reactions: sleepy does not precede 45 seconds of rest', face(ui) === 'idle');
  step(ui, 1);
  check('Bot reactions: 45 seconds of rest shows sleepy without a recurring timer', face(ui) === 'sleepy' && ui.clock.pending === 0);
  check('Bot reactions: sleeping/winking never touches network, microphone, speech or storage', ui.requests.length === 0 && ui.utterances.length === 0
    && ui.cancellations === 0 && ui.storage.writes.length === 0 && ui.recognition.instances.every((mic) => mic.starts.length === 0));
  touch(ui);
  check('Bot reactions: touching sleepy wakes only the drawing and restarts its local clock', face(ui) === 'idle' && ui.clock.pending === 3);
  for (let i = 0; i < 12; i++) { ui.tree.props.onPointerEnter(); ui.flush(); }
  check('Bot reactions: repeated pointer entry cannot accumulate timers', face(ui) === 'idle' && ui.clock.pending === 3);
  mode(ui, 'listening');
  check('Bot reactions: listening immediately cancels all idle deadlines', face(ui) === 'listening' && ui.clock.pending === 0);
  step(ui, 60000);
  check('Bot reactions: an old sleepy timeout cannot replace listening', face(ui) === 'listening');
  touch(ui);
  check('Bot reactions: pointer events cannot override live listening', face(ui) === 'listening' && ui.clock.pending === 0);
  mode(ui, 'idle');
  check('Bot reactions: idle → busy → idle never restores the old sleepy/wink frame', face(ui) === 'idle' && ui.clock.pending === 3);
  step(ui, 12000);
  mode(ui, 'speaking');
  check('Bot reactions: speech immediately replaces a wink and clears its remaining timers', face(ui) === 'speaking' && ui.clock.pending === 0);
  step(ui, 45000);
  check('Bot reactions: a long reply never becomes sleepy', face(ui) === 'speaking');
  mode(ui, 'happy');
  step(ui, 899);
  check('Bot reactions: the happy face lasts through its 800ms body bounce', face(ui) === 'happy');
  step(ui, 1);
  check('Bot reactions: happiness finishes with a wink while the original happy activity stays intact', face(ui) === 'wink'
    && ui.tree.props['data-activity'] === 'happy' && ui.tree.props.className.includes('activity-happy'));
  mode(ui, 'thinking');
  check('Bot reactions: new thinking preempts the happy wink immediately', face(ui) === 'thinking' && ui.clock.pending === 0);
  ui.unmount();
  check('Bot reactions: an active instance cleans up every deadline', ui.clock.pending === 0);

  const listeners = new Set();
  const media = {
    matches: true,
    addEventListener(type, fn) { if (type === 'change') listeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'change') listeners.delete(fn); },
  };
  const reduced = await createAvatarHarness({ botProps: { expression: 'idle' }, windowOverrides: { matchMedia: () => media } });
  check('Bot reduced motion: decorative wink timers are omitted', reduced.clock.pending === 1);
  step(reduced, 13000);
  check('Bot reduced motion: idle remains steady instead of winking', face(reduced) === 'idle');
  step(reduced, 32000);
  check('Bot reduced motion: rest is still communicated with a static sleepy face', face(reduced) === 'sleepy');
  mode(reduced, 'happy');
  step(reduced, 1000);
  check('Bot reduced motion: happy does not automatically wink', face(reduced) === 'happy' && reduced.clock.pending === 0);
  mode(reduced, 'idle');
  media.matches = false;
  for (const listener of listeners) listener();
  reduced.flush();
  step(reduced, 12000);
  check('Bot reduced motion: changing the system preference re-enables appropriate reactions', face(reduced) === 'wink');
  media.matches = true;
  for (const listener of listeners) listener();
  reduced.flush();
  check('Bot reduced motion: enabling the preference ends a decorative wink immediately', face(reduced) === 'idle' && reduced.clock.pending === 1);
  step(reduced, 33000);
  check('Bot reduced motion: preference changes do not extend the idle deadline', face(reduced) === 'sleepy');
  reduced.unmount();
  check('Bot reduced motion: unmount removes its media listener and timers', listeners.size === 0 && reduced.clock.pending === 0);
}
}
