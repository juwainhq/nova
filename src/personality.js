import { APP_NAME } from './brand.js';

// The requested voice-first personality, separate from per-request memory data.
export const SYSTEM_PROMPT = `You are ${APP_NAME}, a warm, friendly, and genuinely helpful personal AI assistant.

You speak like a kind and smart friend — encouraging, patient, and never condescending. You keep responses conversational and natural, like you're talking not reading. You're enthusiastic but calm. You never use sarcasm unless the user is clearly joking first. When you don't know something, you say so honestly and helpfully. You remember things the user tells you and refer back to them naturally. Keep responses concise for voice — 2-3 sentences max unless the user asks for more detail.`;

export const STATUS_TEXT = {
  starting: 'Waking up...',
  ready: 'Ready when you are.',
  listening: "I'm listening.",
  thinking: 'Let me think...',
  speaking: 'Talking with you.',
};

export const OLLAMA_UNREACHABLE = "Hmm, I can't reach Ollama right now. Is it running?";
export const OLLAMA_REPLY_ERRORS = {
  noStream: "I didn't get a reply from Ollama this time. Let's try again.",
  invalidStream: "I had trouble reading that reply. Let's give it another try.",
  interrupted: "I couldn't finish reading that reply. Let's try again.",
  emptyReply: "Ollama didn't send a reply this time. Let's try again.",
};

// Keep HTTP details for troubleshooting without showing raw backend/browser errors
// in NOVA's conversation. Neither API behavior nor retry/cancellation changes.
export function ollamaError(detail, status) {
  const error = new Error(detail || OLLAMA_REPLY_ERRORS.noStream);
  error.status = status;
  return error;
}

export function friendlyOllamaError(error, model = '') {
  const detail = String(error?.message || '');
  if (/\bmodel\b[\s\S]*(?:not\s+found|does\s+not\s+exist|not\s+installed)/i.test(detail)) {
    const name = model ? `“${model}”` : 'that model';
    return `I couldn't find ${name} in Ollama. Try installing it, or choose another model in Settings.`;
  }
  if (error?.status === 401 || error?.status === 403) {
    return "Ollama isn't letting this page connect yet. Let's check the connection permissions in Settings.";
  }
  if (error?.status === 404) {
    return "I couldn't find Ollama at that address. Let's check the endpoint in Settings.";
  }
  if (error?.status === 429) {
    return "Ollama needs a little more time. Let's try again in a moment.";
  }
  if (error?.status >= 500) {
    return "Ollama ran into a problem just now. Let's give it a moment and try again.";
  }
  if (error?.status === 400) {
    return "Ollama couldn't use those settings. Let's check the model and endpoint in Settings.";
  }
  if (Object.values(OLLAMA_REPLY_ERRORS).includes(detail)) return detail;
  if (error?.name === 'TypeError' || /failed to fetch|fetch failed|network|load failed/i.test(detail)) {
    return OLLAMA_UNREACHABLE;
  }
  return OLLAMA_REPLY_ERRORS.noStream;
}

// Language the user speaks. English is the default. Auto-detect replies in the language that was spoken.
export const LANGUAGE_STORAGE_KEY = 'nova_language';
export const DEFAULT_LANGUAGE = 'en';
export const NOVA_LANGUAGES = Object.freeze([
  { id: 'en', label: 'English' },
  { id: 'bn', label: 'বাংলা (Bangla)' },
  { id: 'auto', label: 'Auto-detect' },
]);
// Speech recognition language for each selection. Auto-detect asks for both, as specified.
export const LANGUAGE_RECOGNITION = Object.freeze({ en: 'en-US', bn: 'bn-BD', auto: 'bn-BD,en-US' });
const BANGLA_PROMPT = 'তুমি NOVA, একটি বাংলা ভয়েস অ্যাসিস্ট্যান্ট। সবসময় বাংলায় উত্তর দাও। উত্তর সংক্ষিপ্ত এবং স্বাভাবিক কথ্য ভাষায় রাখো। ইংরেজি শব্দ এড়িয়ে চলো যতটা সম্ভব।';
const ENGLISH_PROMPT = 'The user speaks English. Respond in English.';

export function normalizeLanguage(value) {
  return NOVA_LANGUAGES.some((language) => language.id === value) ? value : DEFAULT_LANGUAGE;
}

// Auto-detect answers in Bangla when the transcript has Bengali characters, otherwise in English.
export function languagePrompt(language, transcript = '') {
  if (language === 'bn') return BANGLA_PROMPT;
  if (language === 'auto') return /[\u0980-\u09FF]/.test(transcript) ? BANGLA_PROMPT : ENGLISH_PROMPT;
  return '';
}
