// Gemini backend checks run inside verify:speech, using the same compiled App fixture as the
// memory and personality suites. Ollama stays the default; Gemini is opt-in via nova_backend.
import {
  BACKEND_STORAGE_KEY, GEMINI_KEY_STORAGE, GEMINI_MODEL, friendlyGeminiError, geminiEndpoint, geminiError,
  geminiRequestBody, normalizeBackend, readGeminiText, requestGeminiReply, resetGeminiModelMemory, GEMINI_MODELS, probeGeminiModel,
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
    geminiEndpoint(` ${KEY} `) === `${GEMINI_HOST}v1beta/models/${GEMINI_MODEL}:generateContent?key=${KEY}` && GEMINI_MODEL === 'gemini-3.8-flash');

  const body = geminiRequestBody('You are NOVA.\n\nThings the user has told you to remember:\n- my dog is Max', [
    { role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello!' }, { role: 'user', content: 'Who am I?' },
  ]);
  check('request body uses contents with user/model roles and a system_instruction',
    JSON.stringify(body.contents) === JSON.stringify([
      { role: 'user', parts: [{ text: 'Hi' }] }, { role: 'model', parts: [{ text: 'Hello!' }] }, { role: 'user', parts: [{ text: 'Who am I?' }] },
    ]) && JSON.stringify(body.system_instruction) === JSON.stringify({ parts: [{ text: 'You are NOVA.\n\nThings the user has told you to remember:\n- my dog is Max' }] }));
  check('a trimmed history that opens with NOVA starts the request at the user turn', JSON.stringify(geminiRequestBody('s', [
    { role: 'assistant', content: 'Old reply' }, { role: 'user', content: 'Now' },
  ]).contents) === JSON.stringify([{ role: 'user', parts: [{ text: 'Now' }] }]));
  check('request body uses temperature 0.7 and maxOutputTokens 300', JSON.stringify(body.generationConfig) === JSON.stringify({ temperature: 0.7, maxOutputTokens: 300 })
    && !('messages' in body) && !('systemInstruction' in body));
  check('the Gemini model list is tried in the agreed priority order', JSON.stringify(GEMINI_MODELS) === JSON.stringify([
    'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemma-4-31b-it', 'gemma-4-26b-a4b-it',
  ]));

  // Model selection with a stubbed fetch. Each case resets the session memory first.
  const realFetch = globalThis.fetch;
  const modelCalls = [];
  let listedNames = GEMINI_MODELS;
  const stubFetch = (respond) => {
    globalThis.fetch = async (url) => {
      if (!String(url).includes(':generateContent')) {
        return new Response(JSON.stringify({ models: listedNames.map((name) => ({ name: `models/${name}` })) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const model = String(url).match(/models\/([^:]+):/)[1];
      modelCalls.push(model);
      const { status, body: payload } = respond(model);
      return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
    };
  };
  const turns = [{ role: 'user', content: 'Hi' }];
  const notFound = { status: 404, body: { error: { message: 'model not found' } } };
  const reply200 = { status: 200, body: { candidates: [{ content: { parts: [{ text: 'Hello there' }] }, finishReason: 'STOP' }] } };
  try {
    resetGeminiModelMemory();
    stubFetch((model) => (model === 'gemini-2.5-flash' ? reply200 : notFound));
    const first = await requestGeminiReply(KEY, 'sys', turns);
    check('the first model that answers 200 is used, after trying the ones before it in order',
      first.answer === 'Hello there' && first.model === 'gemini-2.5-flash'
      && JSON.stringify(modelCalls) === JSON.stringify(GEMINI_MODELS.slice(0, 8)));
    modelCalls.length = 0;
    await requestGeminiReply(KEY, 'sys', turns);
    check('the working model is used for the rest of the session', JSON.stringify(modelCalls) === JSON.stringify(['gemini-2.5-flash']));

    resetGeminiModelMemory();
    modelCalls.length = 0;
    listedNames = ['gemini-2.5-flash'];
    stubFetch((model) => (model === 'gemini-2.5-flash' ? reply200 : notFound));
    await requestGeminiReply(KEY, 'sys', turns);
    listedNames = GEMINI_MODELS;
    check('the first message only asks models the key can list, so a single request is made', JSON.stringify(modelCalls) === JSON.stringify(['gemini-2.5-flash']));

    resetGeminiModelMemory();
    modelCalls.length = 0;
    stubFetch(() => notFound);
    let unavailable = null;
    try { await requestGeminiReply(KEY, 'sys', turns); } catch (error) { unavailable = error; }
    check('when no model answers 200 the request reports unavailable after trying the whole list',
      unavailable?.unavailable === true && unavailable.message === 'Gemini unavailable — check your API key in Settings'
      && JSON.stringify(modelCalls) === JSON.stringify(GEMINI_MODELS));

    resetGeminiModelMemory();
    modelCalls.length = 0;
    stubFetch(() => ({ status: 403, body: { error: { message: 'denied' } } }));
    let denied = null;
    try { await requestGeminiReply(KEY, 'sys', turns); } catch (error) { denied = error; }
    check('a rejected key stops at once and still reports unavailable', denied?.unavailable === true && modelCalls.length === 1);

    // The probe reads the model list and keeps the first flash model from the priority list.
    globalThis.fetch = async (url) => {
      const listed = String(url).includes('/v1beta/models?key=');
      return new Response(JSON.stringify(listed ? { models: [{ name: 'models/gemini-2.0-flash' }, { name: 'models/gemini-2.5-flash' }] } : {}),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const probed = await probeGeminiModel(KEY);
    check('the model probe picks the first available flash model from the priority list', probed === 'gemini-2.5-flash');
  } finally {
    globalThis.fetch = realFetch;
    resetGeminiModelMemory();
  }

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
    && geminiMarkup.includes('LOCAL') && geminiMarkup.includes('GEMINI') && /checked=""[^>]*value="gemini"/.test(geminiMarkup));
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
  const geminiPosts = () => ui.requests.filter((request) => request.url.startsWith(GEMINI_HOST) && request.url.includes(':generateContent'));
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
  check('the system instruction carries NOVA’s prompt and the saved memories', sent?.system_instruction?.parts?.[0]?.text.includes('You are NOVA')
    && sent.system_instruction.parts[0].text.endsWith('Things the user has told you to remember:\n- my dog is Max'));
  check('the status chip says GEMINI while Gemini is active', text(ui.find('backend-chip-row')) === 'GEMINI');
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
  check('the status chip turns OFFLINE after a failed Gemini request', text(ui.find('backend-chip-row')) === 'OFFLINE');
  check('an invalid key makes one Gemini request and never calls Ollama, showing the Gemini message', geminiPosts().length === countBefore + 1
    && !ui.requests.some((r) => r.url.endsWith('/chat/completions')) && toast(ui).includes('Gemini unavailable — check your API key in Settings'));

  // Switching backends at runtime: Ollama is still the default when nothing is chosen.
  const ollamaDefault = await createAppHarness({ storage: createStorageDouble({ 'nova.transcript.visible': 'true' }), modelsOffline: false });
  ollamaDefault.clock.tick();
  await ollamaDefault.settle();
  check('a new install still starts on Ollama, with no Gemini requests', !ollamaDefault.requests.some((r) => r.url.startsWith(GEMINI_HOST)));
  check('the status chip says LOCAL when Ollama is reachable', text(ollamaDefault.find('backend-chip')) === 'LOCAL');
  const ollamaDown = await createAppHarness({ storage: createStorageDouble({ 'nova.transcript.visible': 'true' }), modelsOffline: true });
  ollamaDown.clock.tick();
  await ollamaDown.settle();
  check('the status chip says OFFLINE when Ollama is unreachable', text(ollamaDown.find('backend-chip')) === 'OFFLINE');
  ollamaDown.unmount();
  ollamaDefault.unmount();
  ui.unmount();
}
