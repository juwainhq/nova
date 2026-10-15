// NOVA's startup sound: a warm rising chord that plays once per session, on the first click or
// tap. Preview plays it at any time, without touching the session flag.

export const STARTUP_SOUND_KEY = 'nova_startup_sound';
export const INTRO_PLAYED_KEY = 'nova_played_intro';

export function startupSoundEnabled(value) {
  return value !== 'false';
}

function playNovaTone() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();

  function playTone(freq, start, duration, vol = 0.18, type = 'sine') {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const reverb = ctx.createConvolver();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + start);

    gain.gain.setValueAtTime(0, ctx.currentTime + start);
    gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);

    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + duration + 0.1);
  }

  // Warm rising chord — feels like waking up
  playTone(220.00, 0.0, 1.8, 0.10);   // A2 — deep bass hum
  playTone(440.00, 0.2, 1.6, 0.12);   // A3
  playTone(523.25, 0.4, 1.4, 0.14);   // C5
  playTone(659.25, 0.6, 1.2, 0.16);   // E5
  playTone(880.00, 0.8, 1.0, 0.12);   // A5 — bright top note
  playTone(1046.5, 1.0, 0.8, 0.08);   // C6 — sparkle

  // Release the audio device after the chord has finished.
  window.setTimeout(() => ctx.close?.().catch?.(() => {}), 3000);
}

export function playNovaStartup() {
  try {
    if (window.localStorage.getItem(STARTUP_SOUND_KEY) === 'false') return;
    if (window.sessionStorage.getItem(INTRO_PLAYED_KEY)) return;
    window.sessionStorage.setItem(INTRO_PLAYED_KEY, 'true');
  } catch {
    return; // Blocked storage: stay silent rather than sound on every refresh.
  }
  playNovaTone();
}

// Settings → Preview: plays the sound now, whatever the toggle says and whether or not it has played.
export function previewNovaStartup() {
  playNovaTone();
}

// Plays on the first click or tap anywhere on the page. The listener is removed after the first tap.
export function armNovaStartup() {
  window.addEventListener('pointerdown', () => playNovaStartup(), { once: true });
}
