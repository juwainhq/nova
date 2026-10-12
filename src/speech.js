// Voice output runs entirely on the browser's built-in Web Speech API: no API key,
// no separate speech service to configure. Local voices work offline; network voices
// and recognition depend on the browser. Helpers are testable with browser API doubles.
import { APP_NAME } from './brand.js';

// Shared by replies and the settings preview: calm, slightly slower/lower.
export const TTS = { rate: 0.92, pitch: 0.88, volume: 1 };
export const TTS_TEST_TEXT = "Hey, I'm Nova. Ready when you are.";
export const TTS_VOICE_KEY = 'nova.tts.voice';

// These are stock voice names, not branding. Explicit priorities always outrank
// generic quality hints, locale preferences, offline capability and the default.
const VOICE_PRIORITY = [
  'Microsoft Aria Online',
  'Microsoft Guy Online',
  'Google UK English Female',
  'Google US English',
];
const PRIORITY_PATTERNS = VOICE_PRIORITY.map((name) => new RegExp(`\\b${name}\\b`, 'i'));

export function listVoices() {
  try {
    return window.speechSynthesis?.getVoices?.() ?? [];
  } catch {
    return [];
  }
}

// voiceURI is the closest thing to a stable id; names support older saved choices.
export function voiceKey(voice) {
  if (!voice) return '';
  return voice.voiceURI || voice.name || '';
}

export function isEnglish(voice) {
  return /^en(?:-|_|$)/i.test(voice?.lang || '');
}

export function englishRank(voice) {
  const lang = (voice?.lang || '').toLowerCase().replace('_', '-');
  if (lang.startsWith('en-us')) return 3;
  if (lang.startsWith('en-gb')) return 2;
  if (lang.startsWith('en')) return 1;
  return 0;
}

export function isNaturalVoice(voice) {
  return /natural|online/i.test(voice?.name || '');
}

export function voicePriority(voice) {
  const name = (voice?.name || '').trim().replace(/\s+/g, ' ');
  const named = PRIORITY_PATTERNS.findIndex((pattern) => pattern.test(name));
  return named >= 0 ? named : isNaturalVoice(voice) ? 4 : 5;
}

// Locale only breaks ties within a tier (e.g. English vs German Aria variants).
export function scoreVoice(voice) {
  return voice ? (5 - voicePriority(voice)) * 100 + englishRank(voice) : 0;
}

export function sortVoices(voices) {
  return [...(voices || [])].filter(Boolean).sort((a, b) => scoreVoice(b) - scoreVoice(a)
    || Number(Boolean(b.default)) - Number(Boolean(a.default))
    || (a.name || '').localeCompare(b.name || '')
    || voiceKey(a).localeCompare(voiceKey(b)));
}

export function defaultVoice(voices) {
  const list = (voices || []).filter(Boolean);
  const preferred = sortVoices(list).find((voice) => voicePriority(voice) < 5);
  // Never fall back to a basic voice while any named/Natural/Online option exists.
  // Some engines omit the default flag; their first exposed voice is the last resort.
  return preferred || list.find((voice) => voice.default) || list[0] || null;
}

export function groupVoices(voices) {
  const sorted = sortVoices(voices);
  return {
    natural: sorted.filter(isNaturalVoice),
    basic: sorted.filter((voice) => !isNaturalVoice(voice)),
  };
}

export function resolveVoice(voices, key) {
  if (!key) return null;
  const list = voices || [];
  return list.find((voice) => voiceKey(voice) === key) || list.find((voice) => voice.name === key) || null;
}

// "Samantha · en-US · offline" — offline matters, since that is when it still works.
export function describeVoice(voice) {
  if (!voice) return 'No voice here yet';
  const parts = [voice.name || 'Unnamed'];
  if (voice.lang) parts.push(voice.lang);
  parts.push(voice.localService ? 'offline' : 'needs network');
  return parts.join(' · ');
}

export function voiceOptionLabel(voice) {
  if (!voice) return '';
  return `${voice.name} (${voice.lang || 'unknown'})${voice.localService ? ' · offline' : ' · network'}`;
}

export const WAKE_WORD = `hey ${APP_NAME.toLowerCase()}`;
export const WAKE_UNSUPPORTED_MESSAGE = `I can’t listen for “${WAKE_WORD}” in this browser. Try the mic button instead.`;
const wakePattern = new RegExp(`\\bhey[\\s,]+${APP_NAME.toLowerCase()}\\b[\\s,.!?:;—-]*`, 'i');

// Keep the user's question, including its punctuation, but never send the wake
// phrase or unrelated standby transcripts to Ollama.
export function parseWakeWord(text) {
  const match = wakePattern.exec(text || '');
  return match ? { question: text.slice(match.index + match[0].length).trim() } : null;
}

// While NOVA speaks, only "stop", "wait" or "hey nova" interrupt. Her own voice can
// reach the mic, so a command word she is saying in this reply only counts once
// the recognizer finalizes it as the whole utterance. Returns the question said
// after "hey nova" (if any), or null.
const spokenWords = (text) => ` ${String(text || '').toLowerCase().replace(/[^\p{L}\p{N}']+/gu, ' ').trim()} `;
export function parseInterrupt(transcript, { final = false, spoken = '' } = {}) {
  const heard = spokenWords(transcript).trim();
  if (!heard) return null;
  const wake = parseWakeWord(transcript);
  const command = wake ? WAKE_WORD : /(?:^|\s)(stop|wait)(?:\s+(?:it|please|nova|now))*$/.exec(heard)?.[1];
  if (!command) return null;
  const alone = heard === WAKE_WORD || /^(?:(?:hey\s+)?nova\s+)?(?:(?:stop|wait)\s*)+(?:\s*(?:it|please|nova|now))*$/.test(heard);
  const echo = spokenWords(spoken).includes(` ${command} `);
  return (alone && final) || !echo ? { command, question: wake?.question || '' } : null;
}

// One recognizer, three modes (standby, question and interrupt). A mode change waits for onend before restarting:
// starting a second session while the first is stopping throws in real browsers.
// Both modes ask for interim results, so the wake phrase is caught while it is
// still being spoken rather than after the pause that ends a final result. That
// is not a promise of low-power or offline recognition — the browser decides how
// its speech engine runs.
export function createVoiceListener({
  Recognition,
  onWake = () => {},
  onQuestion = () => {},
  onStandbyChange = () => {},
  onInputStart = () => {},
  onInputEnd = () => {},
  onSpeechDetected = () => {},
  onInterrupt = () => {},
  spokenText = () => '',
  onUnsupported = () => {},
  onError = () => {},
  timers = globalThis,
  now = () => Date.now(),
}) {
  let recognition;
  let wakeSupported = false;
  try {
    if (Recognition) {
      recognition = new Recognition();
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;
      if ('continuous' in recognition) {
        recognition.continuous = true;
        wakeSupported = recognition.continuous === true;
      }
    }
  } catch {
    // A browser may expose the API but reject continuous mode. Keep manual input.
  }
  let standbyAllowed = wakeSupported;
  let mode = null;
  let activeMode = null;
  let phase = 'idle';
  let disposed = false;
  let standby = false;
  let tail = '';
  // After an interim wake: results from this index on still hold the wake phrase.
  let wakeIndex = null;
  let wakeText = '';
  let restartTimer;
  let questionTimer;
  let startedAt = 0;
  let shortEnds = 0;
  let failures = 0;
  // A question that follows an interrupt ends quietly if nothing is said.
  let quiet = false;

  const reportStandby = () => {
    const next = phase === 'running' && mode === 'standby' && activeMode === 'standby';
    if (next !== standby) {
      standby = next;
      onStandbyChange(next);
    }
  };
  const unsupported = () => {
    wakeSupported = false;
    standbyAllowed = false;
    onUnsupported();
  };
  if (!wakeSupported) unsupported();

  const armQuestionTimeout = () => {
    timers.clearTimeout(questionTimer);
    questionTimer = timers.setTimeout(() => {
      if (disposed || mode !== 'question') return;
      const reason = quiet ? 'quiet' : 'no-speech';
      setMode('standby');
      onInputEnd(reason);
    }, 15000);
  };

  const start = () => {
    restartTimer = undefined;
    if (disposed || !recognition || !mode || phase !== 'idle') return;
    activeMode = mode;
    phase = 'starting';
    try {
      if (wakeSupported) recognition.continuous = true;
      recognition.interimResults = true;
      recognition.start();
    } catch (error) {
      const failedMode = activeMode;
      phase = 'idle';
      mode = activeMode = null;
      standbyAllowed = false;
      reportStandby();
      if (error.name === 'NotSupportedError') unsupported();
      else onError(error.name === 'NotAllowedError' || error.name === 'SecurityError' ? 'not-allowed' : 'start-failed', failedMode);
      if (failedMode === 'question') onInputEnd('error');
    }
  };
  const scheduleStart = (delay = 0) => {
    timers.clearTimeout(restartTimer);
    if (!disposed && recognition && mode && phase === 'idle') {
      restartTimer = timers.setTimeout(start, delay);
    }
  };

  // `quiet`: after an interrupt, silence ends the question without a "didn't catch that".
  function setMode(next, { quiet: quietly = false } = {}) {
    if (disposed) return;
    const target = (next === 'standby' || next === 'interrupt') && !standbyAllowed ? null : next;
    if (target === mode) return;
    mode = target;
    quiet = quietly && target === 'question';
    tail = '';
    wakeIndex = null;
    wakeText = '';
    timers.clearTimeout(restartTimer);
    timers.clearTimeout(questionTimer);
    if (phase === 'running' && activeMode === 'interrupt' && target === 'standby') {
      // NOVA finished speaking: same settings, so keep the session (no gap in wake listening).
      activeMode = target;
      reportStandby();
      return;
    }
    if (phase === 'starting' || phase === 'running') {
      phase = 'stopping';
      reportStandby();
      try {
        recognition.abort();
      } catch {
        // Already ended: there is no active session to wait for.
        phase = 'idle';
        activeMode = null;
        scheduleStart(150);
      }
    } else if (phase === 'idle') scheduleStart();
  }

  const submit = (text) => {
    quiet = false;
    setMode(null); // Stop before the request / speaker can hear its own reply.
    onQuestion(text);
  };

  // An interim wake keeps the running session as the question: both modes use the
  // same settings, so a restart would only risk clipping words said right after
  // the wake phrase. The question itself still comes from final results.
  const continueAsQuestion = (index) => {
    mode = activeMode = 'question';
    wakeText = tail;
    wakeIndex = index;
    tail = '';
    timers.clearTimeout(restartTimer);
    armQuestionTimeout();
    reportStandby();
    onInputStart('question');
  };

  if (recognition) {
    recognition.onstart = () => {
      if (disposed || phase === 'stopping') return;
      phase = 'running';
      startedAt = now();
      if (activeMode === 'question') {
        // A successful button-initiated start can recover a permission denial.
        standbyAllowed = wakeSupported;
        failures = shortEnds = 0;
        armQuestionTimeout();
      }
      reportStandby();
      onInputStart(activeMode);
    };
    recognition.onspeechstart = () => {
      // In interrupt mode the sound is usually NOVA herself.
      if (!disposed && phase === 'running' && mode === activeMode && mode !== 'interrupt') onSpeechDetected();
    };
    recognition.onresult = (event) => {
      if (disposed || phase !== 'running' || mode !== activeMode) return;
      const finals = [];
      const interims = [];
      let heardSpeech = false;
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript || '';
        if (transcript.trim()) heardSpeech = true;
        (result.isFinal ? finals : interims).push({ index, transcript });
      }
      if (mode === 'interrupt') {
        // Nothing heard while NOVA speaks is ever sent, except a question after "hey nova".
        const heard = [...finals.map((entry) => ({ ...entry, final: true })), ...interims].sort((a, b) => a.index - b.index);
        for (const { index, transcript, final = false } of heard) {
          const command = parseInterrupt(transcript, { final, spoken: spokenText() });
          if (!command) continue;
          failures = shortEnds = 0;
          // The same session becomes the question, so words right after the command aren't clipped.
          continueAsQuestion(index);
          quiet = true;
          if (final) { wakeIndex = null; wakeText = ''; }
          onInterrupt(command.command);
          if (final && command.question && mode === 'question') submit(command.question);
          return;
        }
        return;
      }
      if (heardSpeech) onSpeechDetected(); // Fallback for engines without speechstart.
      const join = (parts) => parts.map(({ transcript }) => transcript).join(' ').trim();
      const text = join(finals);
      if (mode === 'standby') {
        if (text) {
          failures = shortEnds = 0;
          const wake = parseWakeWord(`${tail}${text}`);
          tail = /\bhey[,\s]*$/i.test(text) ? 'hey ' : '';
          if (wake) {
            setMode('question');
            onWake();
            if (wake.question) submit(wake.question);
            return;
          }
        }
        // The wake phrase in an interim result: wake now, mid-word, not after the pause.
        if (interims.length && parseWakeWord(`${tail}${join(interims)}`)) {
          failures = shortEnds = 0;
          continueAsQuestion(interims[0].index);
          onWake();
        }
      } else if (mode === 'question') {
        armQuestionTimeout();
        let said = text;
        if (wakeIndex !== null) {
          // The interim wake's own result: drop earlier chatter and the wake phrase.
          const fresh = join(finals.filter(({ index }) => index >= wakeIndex));
          if (!fresh) return;
          wakeText = wakeText ? `${wakeText} ${fresh}` : fresh;
          const wake = parseWakeWord(wakeText);
          if (!wake && /\bhey[,\s]*$/i.test(wakeText)) return; // "hey" | "nova …" split across results.
          // If the final lost the wake phrase, the interim was a mishearing: say nothing.
          said = wake ? wake.question : '';
          wakeIndex = null;
          wakeText = '';
        }
        // Also accept a repeated wake phrase at the start of a question.
        const question = /^hey[\s,]/i.test(said) ? parseWakeWord(said)?.question ?? said : said;
        if (question) submit(question);
      }
    };
    recognition.onerror = (event) => {
      if (disposed || phase === 'stopping' || !mode || event.error === 'aborted') return;
      if (event.error === 'no-speech' && mode === 'standby') return;
      // Listening for an interrupt never disables standby; onend simply retries.
      if (mode === 'interrupt' && !['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) return;
      if (event.error === 'no-speech' && mode === 'question' && quiet) {
        setMode('standby');
        onInputEnd('quiet');
        return;
      }
      const failedMode = activeMode;
      if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) {
        standbyAllowed = false; // Do not loop permission prompts or missing devices.
        setMode(null);
      } else if (event.error === 'network' && mode === 'standby') {
        failures += 1;
        if (failures < 3) return; // Bounded retry, with backoff in onend.
        standbyAllowed = false;
        setMode(null);
      } else if (failedMode === 'question') setMode('standby');
      else {
        standbyAllowed = false;
        setMode(null);
      }
      onError(event.error, failedMode);
      if (failedMode === 'question') onInputEnd('error');
    };
    recognition.onend = () => {
      if (disposed) return;
      const endedMode = activeMode;
      const switching = phase === 'stopping';
      phase = 'idle';
      activeMode = null;
      reportStandby();
      tail = ''; // Never combine words from different sessions.
      wakeIndex = null;
      wakeText = '';
      if (!switching && endedMode === 'standby' && mode === 'standby') {
        shortEnds = now() - startedAt < 1000 ? shortEnds + 1 : 0;
        if (shortEnds >= 3) {
          mode = null;
          unsupported(); // An exposed API that cannot sustain listening.
        }
      }
      if (!switching && endedMode === 'question' && !wakeSupported && mode === 'question') {
        setMode(null);
        onInputEnd('no-speech');
      }
      // Continuous engines still end after silence or a service time limit.
      scheduleStart(switching ? 150 : Math.min(800 * 2 ** failures, 6400));
    };
  }

  return {
    get available() { return Boolean(recognition); },
    get wakeSupported() { return wakeSupported; },
    setMode,
    dispose() {
      disposed = true;
      mode = null;
      timers.clearTimeout(restartTimer);
      timers.clearTimeout(questionTimer);
      phase = 'idle';
      reportStandby();
      if (!recognition) return;
      recognition.onstart = recognition.onspeechstart = recognition.onresult = recognition.onerror = recognition.onend = null;
      try { recognition.abort(); } catch { /* Already idle. */ }
    },
  };
}

// Synthesized locally; no audio asset, download, or dependency. Browsers may block
// AudioContext until a gesture, so unlock on the first pointer/key interaction and
// fail silently if autoplay is denied — the microphone must still wake normally.
export function createWakeChime(AudioContext) {
  let context;
  let disposed = false;
  const unlock = async () => {
    if (disposed || !AudioContext) return false;
    try {
      context ||= new AudioContext();
      if (context.state === 'suspended') await context.resume();
      return !disposed && context.state === 'running';
    } catch { return false; }
  };
  return {
    unlock,
    async play() {
      if (disposed || !AudioContext) return false;
      try {
        context ||= new AudioContext();
        // Do not queue a chime behind a blocked resume promise: it could play
        // much later, after a gesture, instead of when the wake word was heard.
        if (context.state !== 'running') return false;
        const at = context.currentTime;
        [659.25, 880].forEach((frequency, index) => {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          const start = at + index * .1;
          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(frequency, start);
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(.035, start + .02);
          gain.gain.exponentialRampToValueAtTime(.0001, start + .2);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
          oscillator.start(start);
          oscillator.stop(start + .22);
        });
        return true;
      } catch { return false; }
    },
    dispose() {
      disposed = true;
      try { context?.close()?.catch(() => {}); } catch { /* Audio is optional. */ }
    },
  };
}
