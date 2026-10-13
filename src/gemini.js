// Google Gemini as an alternative chat backend. Only the request/response shape and the
// error wording live here; App.jsx decides when to use it.
export const BACKEND_STORAGE_KEY = 'nova_backend';
export const GEMINI_KEY_STORAGE = 'nova_gemini_key';
export const DEFAULT_BACKEND = 'ollama';
// Tried in order when a model answers 404. The first one that works is remembered for the session.
export const GEMINI_MODELS = Object.freeze(['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-8b']);
export const GEMINI_MODEL = GEMINI_MODELS[0];

export const GEMINI_GENERATION = Object.freeze({ temperature: 0.7, maxOutputTokens: 300 });
let preferredModelIndex = 0;

export function resetGeminiModelMemory() {
  preferredModelIndex = 0;
}

export function normalizeBackend(value) {
  return value === 'gemini' ? 'gemini' : DEFAULT_BACKEND;
}

export function geminiEndpoint(apiKey, model = GEMINI_MODEL) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
}

// NOVA's conversation turns use "assistant"; Gemini calls that role "model".
export function geminiRequestBody(systemText, turns) {
  return {
    system_instruction: { parts: [{ text: systemText }] },
    contents: turns.map((turn) => ({
      role: turn.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: turn.content }],
    })),
    generationConfig: { ...GEMINI_GENERATION },
  };
}

// Sends one turn, trying each model in order on 404. Resolves with { answer, finishReason, model }.
// Throws { unavailable: true } when every model returns 404, so the caller can fall back to Local.
export async function requestGeminiReply(apiKey, systemText, turns, signal) {
  const body = JSON.stringify(geminiRequestBody(systemText, turns));
  for (let index = preferredModelIndex; index < GEMINI_MODELS.length; index += 1) {
    const model = GEMINI_MODELS[index];
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
    if (response.status === 404) {
      console.error('[Gemini] model not found, trying the next one', { model, message: payload?.error?.message });
      continue;
    }
    if (!response.ok) {
      console.error('[Gemini] request failed', { model, status: response.status, apiStatus: payload?.error?.status, message: payload?.error?.message });
      throw geminiError(payload, response.status);
    }
    const reply = readGeminiText(payload);
    preferredModelIndex = index;
    return { ...reply, model };
  }
  console.error('[Gemini] every model returned 404', { models: GEMINI_MODELS });
  const error = new Error(GEMINI_REPLY_ERRORS.unavailable);
  error.unavailable = true;
  throw error;
}

export const GEMINI_REPLY_ERRORS = {
  noKey: 'Add your Gemini API key in Settings → AI tab',
  unavailable: 'Gemini unavailable — switching to Local',
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
