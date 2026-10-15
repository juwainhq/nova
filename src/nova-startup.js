// NOVA's startup sound: two soft, quiet sine notes that play once per session, on the first click
// or tap. Preview plays the same sound at any time, without touching the session flag.

export const STARTUP_SOUND_KEY = 'nova_startup_sound';
export const INTRO_PLAYED_KEY = 'nova_played_intro';

export function startupSoundEnabled(value) {
  return value !== 'false';
}

// Two soft gentle notes — quiet notification chime, under 1.5s total.
function playGentleTone() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();

  function softTone(freq, start, duration, vol = 0.08) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, ctx.currentTime + start);
    gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + duration + 0.05);
  }

  softTone(528, 0.0, 1.0, 0.07);   // C5 — calm
  softTone(659, 0.3, 0.9, 0.06);   // E5 — resolves gently
}

export function playNovaStartup() {
  if (window.localStorage.getItem(STARTUP_SOUND_KEY) === 'false') return;
  if (window.sessionStorage.getItem(INTRO_PLAYED_KEY)) return;
  window.sessionStorage.setItem(INTRO_PLAYED_KEY, 'true');
  playGentleTone();
}

// Settings → Preview: plays the sound now, whatever the toggle says and whether or not it has played.
export function previewNovaStartup() {
  playGentleTone();
}

// Plays on the first click or tap anywhere on the page. The listener is removed after the first tap.
export function armNovaStartup() {
  window.addEventListener('pointerdown', () => playNovaStartup(), { once: true });
}
