// Voice output runs entirely on the browser's built-in Web Speech API: no API key,
// no network, nothing to configure. This module holds the pure parts — choosing and
// describing voices — so they can be exercised without a browser.

// "Slightly slower, slightly lower": calm and even rather than the shrill default.
export const TTS = { rate: 0.95, pitch: 0.9, volume: 1 };

export const TTS_VOICE_KEY = 'aria.tts.voice';

// Voices whose names mark them out as the good ones. Tiered so a neural voice
// always outranks a merely pleasant-sounding older one.
const QUALITY_TIERS = [
  { pattern: /\(natural\)|\bnatural\b|\bneural\b/i, score: 70 },
  { pattern: /\bpremium\b|\benhanced\b|\bsiri\b/i, score: 55 },
  { pattern: /^google\b/i, score: 40 },
];

// Pleasant local voices, by the names the major platforms use. "aria" is first
// class on purpose: Microsoft ships a voice by that name, and it suits the
// assistant better than any other default.
const PREFERRED_NAMES = ['aria', 'samantha', 'ava', 'allison', 'serena', 'zoe', 'jenny', 'evan', 'nathan', 'karen', 'moira', 'tessa', 'daniel'];
const ASSISTANT_NAME_BONUS = 30;
const PREFERRED_NAME_BONUS = 16;

// A local voice keeps working with no connection; a network voice does not.
const LOCAL_BONUS = 14;

export function listVoices() {
  try {
    return window.speechSynthesis?.getVoices?.() ?? [];
  } catch {
    return [];
  }
}

// voiceURI is the closest thing to a stable id; fall back to the name, since some
// platforms leave it blank.
export function voiceKey(voice) {
  if (!voice) return '';
  return voice.voiceURI || voice.name || '';
}

export function isEnglish(voice) {
  return /^en\b/i.test(voice?.lang || '');
}

export function englishRank(voice) {
  const lang = (voice?.lang || '').toLowerCase().replace('_', '-');
  if (lang.startsWith('en-us')) return 3;
  if (lang.startsWith('en-gb')) return 2;
  if (lang.startsWith('en')) return 1;
  return 0;
}

export function scoreVoice(voice) {
  if (!voice) return 0;
  const name = (voice.name || '').toLowerCase();
  let score = 0;

  for (const tier of QUALITY_TIERS) {
    if (tier.pattern.test(name)) {
      score += tier.score;
      break;
    }
  }

  if (name.includes('aria')) score += ASSISTANT_NAME_BONUS;
  else if (PREFERRED_NAMES.some((preferred) => name.includes(preferred))) score += PREFERRED_NAME_BONUS;

  score += englishRank(voice) * 4;
  if (voice.localService) score += LOCAL_BONUS;
  if (voice.default) score += 2;

  return score;
}

// The most natural English voice on the machine, judged by name and language.
export function defaultVoice(voices) {
  const english = (voices || []).filter(isEnglish);
  const candidates = english.length ? english : (voices || []);
  if (!candidates.length) return null;

  return [...candidates].sort((a, b) => scoreVoice(b) - scoreVoice(a)
    || englishRank(b) - englishRank(a)
    || (a.name || '').localeCompare(b.name || ''))[0];
}

// Best first, with locale as a tiebreak rather than the primary key, so a
// high-quality en-GB voice still outranks a plain en-US one.
export function sortVoices(voices) {
  return [...(voices || [])].sort((a, b) => {
    const score = scoreVoice(b) - scoreVoice(a);
    if (score) return score;
    const language = englishRank(b) - englishRank(a);
    if (language) return language;
    return (a.name || '').localeCompare(b.name || '');
  });
}

export function groupVoices(voices) {
  const sorted = sortVoices(voices);
  return {
    english: sorted.filter(isEnglish),
    others: sorted.filter((voice) => !isEnglish(voice)),
  };
}

export function resolveVoice(voices, key) {
  if (!key) return null;
  const list = voices || [];
  return list.find((voice) => voiceKey(voice) === key) || list.find((voice) => voice.name === key) || null;
}

// "Samantha · en-US · offline" — offline matters, since that is when it still works.
export function describeVoice(voice) {
  if (!voice) return 'No voice available';
  const parts = [voice.name || 'Unnamed'];
  if (voice.lang) parts.push(voice.lang);
  parts.push(voice.localService ? 'offline' : 'needs network');
  return parts.join(' · ');
}

export function voiceOptionLabel(voice) {
  if (!voice) return '';
  return `${voice.name} (${voice.lang || 'unknown'})${voice.localService ? ' · offline' : ' · network'}`;
}
