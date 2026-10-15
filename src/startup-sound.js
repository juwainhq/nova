// Startup sound: a short chime (or the user's own .mp3/.wav) that plays once, on the first
// click or tap of a session. Browsers only allow audio after a user gesture, so the sound
// waits for one. sessionStorage marks the session as started, so a refresh stays quiet.

export const STARTUP_SOUND_KEY = 'nova_startup_sound';
export const STARTUP_AUDIO_KEY = 'nova_startup_audio';
export const STARTUP_STARTED_KEY = 'nova_started';
// The custom sound is kept in localStorage as base64, which is about a third larger than the file.
export const STARTUP_AUDIO_LIMIT_BYTES = 1024 * 1024;
export const STARTUP_AUDIO_TYPES = Object.freeze(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave']);

export function startupSoundEnabled(value) {
  return value !== 'false';
}

// Generated chime: C5, E5, G5, a rising arpeggio.
function playChime() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const notes = [523.25, 659.25, 783.99];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;
    const start = ctx.currentTime + i * 0.18;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.25, start + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.8);
    osc.start(start);
    osc.stop(start + 0.9);
  });
  // Release the audio device once the last note has ended.
  window.setTimeout(() => ctx.close?.().catch?.(() => {}), 1500);
}

export function playStartupSound() {
  let enabled = true;
  let custom = '';
  try {
    enabled = startupSoundEnabled(window.localStorage.getItem(STARTUP_SOUND_KEY));
    custom = window.localStorage.getItem(STARTUP_AUDIO_KEY) || '';
  } catch { /* Blocked storage: play the default chime. */ }
  if (!enabled) return;
  try {
    if (custom) {
      const audio = new Audio(custom);
      void audio.play()?.catch?.(() => {});
    } else {
      playChime();
    }
  } catch {
    // Audio can be unavailable in some browsers. The app itself must still work.
  }
}

let armed = false;

// Called on every app mount, but arms only once per page load and only for the first load of
// the session. The gesture listener is never removed, so a React re-mount can't lose it.
export function armStartupSound() {
  if (armed) return;
  let started = false;
  try {
    started = window.sessionStorage.getItem(STARTUP_STARTED_KEY) === 'true';
    if (!started) window.sessionStorage.setItem(STARTUP_STARTED_KEY, 'true');
  } catch {
    started = true; // Without session storage, don't risk a sound on every refresh.
  }
  if (started) return;
  armed = true;
  window.addEventListener('pointerdown', () => playStartupSound(), { once: true });
}

// Reads a user-picked file as a data URL, or returns an error message.
export function readStartupAudio(file) {
  return new Promise((resolve) => {
    const name = String(file?.name || '').toLowerCase();
    const typeOk = STARTUP_AUDIO_TYPES.includes(file?.type) || name.endsWith('.mp3') || name.endsWith('.wav');
    if (!file || !typeOk) return resolve({ error: 'Choose an .mp3 or .wav file.' });
    if (file.size > STARTUP_AUDIO_LIMIT_BYTES) return resolve({ error: 'That file is larger than 1 MB. Choose a shorter or smaller sound.' });
    const reader = new FileReader();
    reader.onload = () => resolve({ dataUrl: String(reader.result || '') });
    reader.onerror = () => resolve({ error: 'I couldn’t read that file. Try another one.' });
    reader.readAsDataURL(file);
  });
}
