// Google Gemini as an alternative chat backend. Only the request/response shape and the
// error wording live here; App.jsx decides when to use it.
export const BACKEND_STORAGE_KEY = 'nova_backend';
export const GEMINI_KEY_STORAGE = 'nova_gemini_key';
export const DEFAULT_BACKEND = 'ollama';
// Free text models, tried in this order. The first one that answers HTTP 200 is used for the rest of
// the session. Pro, Live, TTS, and transcription models are not used for chat.
export const GEMINI_MODELS = Object.freeze([
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemma-4-31b-it',
  'gemma-4-26b-a4b-it',
]);
export const GEMINI_MODEL = GEMINI_MODELS[0];
// The probe's pick lives in localStorage; the working model for this session lives in sessionStorage.
export const GEMINI_MODEL_STORAGE = 'nova_gemini_model';

export const GEMINI_GENERATION = Object.freeze({ temperature: 0.7, maxOutputTokens: 300 });

// Used only when browser storage is blocked, so the session choice still sticks in memory.
let memoryModel = null;

function browserStorage(kind) {
  try {
    return globalThis[kind] || null;
  } catch {
    return null;
  }
}

export function readSessionGeminiModel() {
  try {
    return browserStorage('sessionStorage')?.getItem(GEMINI_MODEL_STORAGE) || memoryModel;
  } catch {
    return memoryModel;
  }
}

function writeSessionGeminiModel(model) {
  memoryModel = model;
  try {
    browserStorage('sessionStorage')?.setItem(GEMINI_MODEL_STORAGE, model);
  } catch {
    // Storage is blocked: the in-memory choice above still applies.
  }
}

export function readStoredGeminiModel() {
  try {
    return browserStorage('localStorage')?.getItem(GEMINI_MODEL_STORAGE) || null;
  } catch {
    return null;
  }
}

function writeStoredGeminiModel(model) {
  try {
    browserStorage('localStorage')?.setItem(GEMINI_MODEL_STORAGE, model);
  } catch {
    // Storage is blocked: the probe will run again next time the key is saved.
  }
}

// The model the badge shows: the one proven to work this session, else the probe's pick.
export function activeGeminiModel() {
  return readSessionGeminiModel() || readStoredGeminiModel();
}

// "gemini-2.0-flash" is shown as "2.0-flash" in the badge.
export function geminiModelLabel(model) {
  return String(model || '').replace(/^gemini-/, '');
}

export function resetGeminiModelMemory() {
  memoryModel = null;
  try {
    browserStorage('sessionStorage')?.removeItem(GEMINI_MODEL_STORAGE);
  } catch {
    // Nothing to clear when storage is blocked.
  }
}


// Lists the models this key can use and keeps the first flash model from GEMINI_MODELS that is
// available. Runs once when the key is saved. Returns null and logs when the list can't be read.
export async function probeGeminiModel(apiKey, signal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey.trim())}`;
  const response = await fetch(url, { signal });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    console.error('[Gemini] model list failed', { status: response.status, message: payload?.error?.message });
    return null;
  }
  const available = new Set((payload?.models || []).map((model) => String(model?.name || '').replace(/^models\//, '')));
  const best = GEMINI_MODELS.find((name) => name.includes('flash') && available.has(name)) || null;
  if (best) writeStoredGeminiModel(best);
  return best;
}

export function normalizeBackend(value) {
  return value === 'gemini' ? 'gemini' : DEFAULT_BACKEND;
}

export function geminiEndpoint(apiKey, model = GEMINI_MODEL) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
}

// NOVA's conversation turns use "assistant"; Gemini calls that role "model".
export function geminiRequestBody(systemText, turns) {
  // Gemini expects the conversation to open with a user turn; a trimmed history may start with NOVA.
  const firstUser = turns.findIndex((turn) => turn.role !== 'assistant');
  const kept = firstUser > 0 ? turns.slice(firstUser) : turns;
  return {
    system_instruction: { parts: [{ text: systemText }] },
    contents: kept.map((turn) => ({
      role: turn.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: turn.content }],
    })),
    generationConfig: { ...GEMINI_GENERATION },
  };
}

// Tries the session's model first, then the probe's pick, then the list in order. The first 200
// wins. Resolves with { answer, finishReason, model }. Throws { unavailable: true } when no model
// answers, so the caller can show the message and fall back to Local.
export async function requestGeminiReply(apiKey, systemText, turns, signal) {
  const body = JSON.stringify(geminiRequestBody(systemText, turns));
  const order = [...new Set([readSessionGeminiModel(), readStoredGeminiModel(), ...GEMINI_MODELS].filter(Boolean))];
  for (const model of order) {
    let response;
    try {
      response = await fetch(geminiEndpoint(apiKey, model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body,
      });
    } catch (error) {
      if (!signal?.aborted) console.error('[Gemini] network error', { model, error });
      throw error;
    }
    const payload = await response.json().catch(() => null);
    if (response.ok) {
      const reply = readGeminiText(payload);
      writeSessionGeminiModel(model);
      return { ...reply, model };
    }
    console.error('[Gemini] model did not answer with 200', {
      model, status: response.status, apiStatus: payload?.error?.status, message: payload?.error?.message,
    });
    // A rejected key fails for every model, so stop instead of trying the rest.
    const keyRejected = response.status === 401 || response.status === 403
      || (response.status === 400 && /api key/i.test(payload?.error?.message || ''));
    if (keyRejected) break;
  }
  console.error('[Gemini] no model answered with 200', { models: order });
  const error = new Error(GEMINI_REPLY_ERRORS.unavailable);
  error.unavailable = true;
  throw error;
}

export const GEMINI_REPLY_ERRORS = {
  noKey: 'Add your Gemini API key in Settings → AI tab',
  unavailable: 'Gemini unavailable — check your API key in Settings',
  noReply: "Gemini didn't send a reply this time. Let's try again.",
  blocked: "Gemini wasn't able to answer that one. Could we try a different question?",
};

// The API's error object carries a message and status; keep the detail out of the chat.
export function geminiError(payload, status) {
  const error = new Error(payload?.error?.message || GEMINI_REPLY_ERRORS.noReply);
  error.status = status;
  error.apiStatus = payload?.error?.status || '';
  return error;
}

export function readGeminiText(payload) {
  if (!payload) return { answer: '', finishReason: null };
  if (payload.promptFeedback?.blockReason && !payload.candidates?.length) {
    const error = new Error(GEMINI_REPLY_ERRORS.blocked);
    error.blocked = true;
    throw error;
  }
  const candidate = payload.candidates?.[0];
  const answer = (candidate?.content?.parts || []).map((part) => part?.text || '').join('').trim();
  return { answer, finishReason: candidate?.finishReason || null };
}

export function friendlyGeminiError(error) {
  const detail = String(error?.message || '');
  if (error?.unavailable) return GEMINI_REPLY_ERRORS.unavailable;
  if (error?.blocked || detail === GEMINI_REPLY_ERRORS.blocked) return GEMINI_REPLY_ERRORS.blocked;
  if (detail === GEMINI_REPLY_ERRORS.noKey) return GEMINI_REPLY_ERRORS.noKey;
  if (error?.status === 400 && /api key/i.test(detail)) return "Gemini doesn't accept that API key. Check it in Settings.";
  if (error?.status === 401 || error?.status === 403) return "Gemini isn't letting this key in. Check the key and its permissions in Settings.";
  if (error?.status === 404) return "I couldn't find the Gemini model right now. Try again later.";
  if (error?.status === 429) return 'Gemini has hit its usage limit for now. Let’s try again in a little while.';
  if (error?.status >= 500) return 'Gemini ran into a problem just now. Let’s give it a moment and try again.';
  if (error?.name === 'TypeError' || /failed to fetch|fetch failed|network|load failed/i.test(detail)) {
    return "I can't reach Gemini right now. Is your internet connection working?";
  }
  return GEMINI_REPLY_ERRORS.noReply;
}
