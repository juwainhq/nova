// Google Gemini as an alternative chat backend. Only the request/response shape and the
// error wording live here; App.jsx decides when to use it.
export const BACKEND_STORAGE_KEY = 'nova_backend';
export const GEMINI_KEY_STORAGE = 'nova_gemini_key';
export const DEFAULT_BACKEND = 'ollama';
export const GEMINI_MODEL = 'gemini-2.0-flash';

// Same short, voice-friendly reply length and sampling as the Ollama path.
export const GEMINI_SAMPLING = Object.freeze({ maxOutputTokens: 80, temperature: 0.7, topP: 0.9 });

export function normalizeBackend(value) {
  return value === 'gemini' ? 'gemini' : DEFAULT_BACKEND;
}

export function geminiEndpoint(apiKey) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
}

// NOVA's conversation turns use "assistant"; Gemini calls that role "model".
export function geminiRequestBody(systemText, turns) {
  return {
    contents: turns.map((turn) => ({
      role: turn.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: turn.content }],
    })),
    systemInstruction: { parts: [{ text: systemText }] },
    generationConfig: { ...GEMINI_SAMPLING },
  };
}

export const GEMINI_REPLY_ERRORS = {
  noKey: 'Add your Gemini API key in Settings, or switch back to Ollama.',
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
