// Gemini backend checks run inside verify:speech, using the same compiled App fixture as the
// memory and personality suites. Ollama stays the default; Gemini is opt-in via nova_backend.
import {
  BACKEND_STORAGE_KEY, GEMINI_KEY_STORAGE, GEMINI_MODEL, friendlyGeminiError, geminiEndpoint, geminiError,
  geminiRequestBody, normalizeBackend, readGeminiText,
} from '../src/gemini.js';
import { MEMORY_KEY } from '../src/memory.js';
import { createAppHarness, createStorageDouble } from './speech-test-fixtures.mjs';

const KEY = 'test-key-abc123';
const text = (node) => Array.isArray(node) ? node.map(text).join(' ').trim()
  : typeof node === 'string' || typeof node === 'number' ? String(node) : text(node?.props?.children || '');
const toast = (ui) => text(ui.find('toast'));
const GEMINI_HOST = 'https://generativelanguage.googleapis.com/';

export async function verifyGemini(check, renderPanel) {
  check('backend storage keys match the spec', BACKEND_STORAGE_KEY === 'nova_backend' && GEMINI_KEY_STORAGE === 'nova_gemini_key');
  check('the default backend is Ollama and unknown values fall back to it',
    normalizeBackend(null) === 'ollama' && normalizeBackend('') === 'ollama' && normalizeBackend('nope') === 'ollama' && normalizeBackend('gemini') === 'gemini');
  check('the Gemini endpoint is the v1beta generateContent REST URL with the key',
    geminiEndpoint(` ${KEY} `) === `${GEMINI_HOST}v1beta/models/${GEMINI_MODEL}:generateContent?key=${KEY}` && GEMINI_MODEL === 'gemini-2.0-flash');

  const body = geminiRequestBody('You are NOVA.\n\nThings the user has told you to remember:\n- my dog is Max', [
    { role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello!' }, { role: 'user', content: 'Who am I?' },
  ]);
  check('request body uses contents with user/model roles and a systemInstruction',
    JSON.stringify(body.contents) === JSON.stringify([
      { role: 'user', parts: [{ text: 'Hi' }] }, { role: 'model', parts: [{ text: 'Hello!' }] }, { role: 'user', parts: [{ text: 'Who am I?' }] },
    ]) && JSON.stringify(body.systemInstruction) === JSON.stringify({ parts: [{ text: 'You are NOVA.\n\nThings the user has told you to remember:\n- my dog is Max' }] }));
  check('request body caps reply length like the Ollama path', body.generationConfig.maxOutputTokens === 80 && !('messages' in body));

  check('a Gemini reply is read from candidates and keeps its finish reason', JSON.stringify(readGeminiText({
    candidates: [{ content: { parts: [{ text: 'Hello ' }, { text: 'there.' }] }, finishReason: 'STOP' }],
  })) === JSON.stringify({ answer: 'Hello there.', finishReason: 'STOP' }));
  let blocked = null;
  try { readGeminiText({ promptFeedback: { blockReason: 'SAFETY' } }); } catch (error) { blocked = error; }
  check('a blocked prompt reports a friendly message, not the raw block reason', blocked?.blocked === true && !blocked.message.includes('SAFETY'));
  check('an empty Gemini payload has no answer', readGeminiText({}).answer === '' && readGeminiText(null).answer === '');

  check('an invalid key gets a settings hint without the raw API text',
    friendlyGeminiError(geminiError({ error: { message: 'API key not valid. Please pass a valid API key.' } }, 400)) === "Gemini doesn't accept that API key. Check it in Settings.");
  check('quota, server and network failures get calm copy',
    friendlyGeminiError(geminiError({ error: { message: 'Quota exceeded' } }, 429)).includes('usage limit')
    && friendlyGeminiError(geminiError({}, 503)).includes('ran into a problem')
    && friendlyGeminiError(new TypeError('Failed to fetch')).includes("can't reach Gemini"));

  // Settings: the backend choice and the key field render from real component markup.
  const geminiMarkup = await renderPanel([], '', [], '', { backend: 'gemini', geminiKey: KEY });
  check('settings show an AI Backend section with both options', geminiMarkup.includes('AI Backend')
    && geminiMarkup.includes('Ollama (Local)') && geminiMarkup.includes('Gemini (Cloud)') && /checked=""[^>]*value="gemini"/.test(geminiMarkup));
  check('Gemini selected shows the API key field and hides the Ollama fields', geminiMarkup.includes('id="gemini-key"')
    && !geminiMarkup.includes('id="ollama-model"') && !geminiMarkup.includes('Test Ollama'));
  const ollamaMarkup = await renderPanel([], '', [], '', { backend: 'ollama' });
  check('Ollama selected keeps the existing fields and hides the Gemini key', /checked=""[^>]*value="ollama"/.test(ollamaMarkup)
    && ollamaMarkup.includes('id="ollama-model"') && !ollamaMarkup.includes('id="gemini-key"'));

  // Real App: a voice question goes to Gemini, with the memories in the system instruction.
  const storage = createStorageDouble({
    'nova.transcript.visible': 'true', [BACKEND_STORAGE_KEY]: 'gemini', [GEMINI_KEY_STORAGE]: KEY,
    [MEMORY_KEY]: JSON.stringify(['my dog is Max']),
  });
  const ui = await createAppHarness({ storage, modelsOffline: true });
  ui.clock.tick();
  await ui.settle();
  const geminiPosts = () => ui.requests.filter((request) => request.url.startsWith(GEMINI_HOST));
  let geminiAnswer = 'Your dog is Max.';
  ui.fetchOverride = async (url) => {
    if (!url.startsWith(GEMINI_HOST)) throw new Error(`unexpected request to ${url}`);
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: geminiAnswer }] }, finishReason: 'STOP' }] }) };
  };
  const ask = async (text) => {
    const mic = ui.recognition.instances[0];
    const before = ui.utterances.length;
    mic.result(`hey nova ${text}`);
    mic.end();
    await ui.settle();
    const reply = ui.utterances[before];
    if (reply) { reply.onend(); await ui.settle(); ui.clock.tick(); ui.flush(); }
    return reply;
  };

  const first = await ask('what is my dog called');
  const request = geminiPosts()[0];
  const sent = request ? JSON.parse(request.options.body) : null;
  check('a Gemini chat sends the key-bearing REST request to generateContent', request?.url === geminiEndpoint(KEY)
    && request.options.method === 'POST');
  check('the system instruction carries NOVA’s prompt and the saved memories', sent?.systemInstruction?.parts?.[0]?.text.includes('You are NOVA')
    && sent.systemInstruction.parts[0].text.endsWith('Things the user has told you to remember:\n- my dog is Max'));
  check('the status badge says ⚡ Gemini while Gemini is active', text(ui.find('backend-pill')) === '⚡ Gemini');
  check('the question is the last user turn', sent?.contents?.at(-1)?.role === 'user' && sent.contents.at(-1).parts[0].text === 'what is my dog called');
  check('the Gemini reply is spoken and shown', first?.text === 'Your dog is Max.' && ui.utterances.length > 0);
  check('no Ollama chat or model-list request is made in Gemini mode', !ui.requests.some((r) => r.url.endsWith('/chat/completions') || r.url.endsWith('/models')));

  geminiAnswer = 'You have a dog named Max.';
  await ask('and what kind of dog was that again');
  const followUp = JSON.parse(geminiPosts().at(-1).options.body);
  check('later turns resend the conversation with the assistant turn as role model', followUp.contents.some((turn) => turn.role === 'model' && turn.parts[0].text === 'Your dog is Max.')
    && followUp.contents.at(-1).parts[0].text === 'and what kind of dog was that again');

  const countBefore = geminiPosts().length;
  ui.fetchOverride = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid. Please pass a valid API key.' } }) });
  await ask('can you hear me');
  check('an invalid key shows a friendly Settings hint without raw API text', geminiPosts().length === countBefore + 1
    && toast(ui).includes("Gemini doesn't accept that API key") && !toast(ui).includes('pass a valid'));

  // Switching backends at runtime: Ollama is still the default when nothing is chosen.
  const ollamaDefault = await createAppHarness({ storage: createStorageDouble({ 'nova.transcript.visible': 'true' }), modelsOffline: true });
  ollamaDefault.clock.tick();
  await ollamaDefault.settle();
  check('a new install still starts on Ollama, with no Gemini requests', !ollamaDefault.requests.some((r) => r.url.startsWith(GEMINI_HOST)));
  check('the badge says 🖥️ Local by default', text(ollamaDefault.find('backend-pill')) === '🖥️ Local');
  ollamaDefault.unmount();
  ui.unmount();
}
