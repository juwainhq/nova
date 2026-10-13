import { useCallback, useEffect, useRef, useState } from 'react';
import RobotAvatar from './RobotAvatar.jsx';
import BotAvatar from './BotAvatar.jsx';
import AvatarSwitcher from './AvatarSwitcher.jsx';
import { AVATAR_STORAGE_KEY, avatarExpression, readAvatar } from './avatar.js';
import RichResponsePanel from './RichResponsePanel.jsx';
import BrowsePanel from './BrowsePanel.jsx';
import {
  RICH_FADE_MS, RICH_VISIBLE_MS, hasRichResponse, richResponse,
} from './rich-response.js';
import {
  BROWSE_FOUND_TEXT, BROWSE_SLIDE_MS, browseGoto, browseInputStop, browseNavRequest, browseRequest,
  browseUrl, isCloseCommand, pushBrowseHistory,
} from './web-browse.js';
import { APP_NAME } from './brand.js';
import {
  OLLAMA_REPLY_ERRORS, OLLAMA_UNREACHABLE, STATUS_TEXT, SYSTEM_PROMPT,
  friendlyOllamaError, ollamaError,
} from './personality.js';
import {
  MEMORY_KEY, describeMemoryFact, forgetFact, memoryName, memoryPrompt, parseMemoryIntent,
  readMemoryStore, rememberFact, writeMemoryStore,
} from './memory.js';
import {
  TTS,
  TTS_TEST_TEXT,
  TTS_VOICE_KEY,
  WAKE_GREET_MS,
  WAKE_WORD,
  WAKE_UNSUPPORTED_MESSAGE,
  createVoiceListener,
  isSameSpeech,
  createWakeChime,
  defaultVoice,
  describeVoice,
  groupVoices,
  listVoices,
  resolveVoice,
  voiceKey,
  voiceOptionLabel,
} from './speech.js';
import {
  DEFAULT_KOKORO_VOICE, KOKORO_VOICES, KOKORO_VOICE_KEY, browserKokoroWorker, createKokoroAudio,
  createKokoroEngine, kokoroVoice, kokoroVoiceLabel, speakWithKokoro,
} from './kokoro.js';
import { createSpeechStream, textSpeechStream } from './speech-stream.js';
import {
  BACKEND_STORAGE_KEY, DEFAULT_BACKEND, GEMINI_KEY_STORAGE, GEMINI_REPLY_ERRORS, friendlyGeminiError,
  geminiEndpoint, geminiError, geminiRequestBody, normalizeBackend, readGeminiText,
} from './gemini.js';

const OLLAMA_MODEL = 'mistral:7b-instruct-q4_K_M';
// Short replies for a fast first word. NOVA calls Ollama's OpenAI-compatible
// endpoint, which has no `num_predict` field (it would be silently ignored).
// Ollama maps `max_tokens` onto its native `num_predict` option. Without explicit
// values that endpoint also defaults temperature and top_p to 1.0.
const OLLAMA_NUM_PREDICT = 80;
const OLLAMA_SAMPLING = Object.freeze({ max_tokens: OLLAMA_NUM_PREDICT, temperature: 0.7, top_p: 0.9 });

// Safety net for engines that lose an utterance's end event, never start a queued
// one, or wedge mid-reply (Chrome's long network-voice bug). Without it NOVA stays
// "speaking" with the mic disabled. Reads only the public speaking/pending flags,
// and only where they are real booleans. The ceiling is ~2x a slow speaking pace.
const SPEECH_CHECK_MS = 1000;
const speechCeilingMs = (text) => 15000 + Math.ceil((text.length / (14 * TTS.rate)) * 2000);

// Replaced at build time by scripts/build-standalone.mjs. The standalone file is
// opened from a file:// URL, where there is no origin server, so the Vite proxy
// paths cannot resolve and the only sensible default is a direct local endpoint.
const STANDALONE_BUILD = typeof __NOVA_STANDALONE__ !== 'undefined' && __NOVA_STANDALONE__ === true;

function defaultOllamaUrl() {
  return STANDALONE_BUILD ? 'http://localhost:11434' : '';
}

// What the operator must allow for this page's origin to reach their Ollama.
function ollamaOriginsCommand() {
  if (STANDALONE_BUILD) return 'OLLAMA_ORIGINS=* ollama serve';
  const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
  return origin ? `OLLAMA_ORIGINS=${origin} ollama serve` : 'OLLAMA_ORIGINS=* ollama serve';
}

// Settings written before the rename live under the previous prefix. Fall back to
// them so renaming the app never silently resets someone's configuration; the first
// save writes the new key and the old one is then ignored.
const STORAGE_PREFIX = 'nova.';
const LEGACY_STORAGE_PREFIX = 'aria.';

function readSetting(key, fallback = '') {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored !== null) return stored;
    if (key.startsWith(STORAGE_PREFIX)) {
      const legacy = window.localStorage.getItem(`${LEGACY_STORAGE_PREFIX}${key.slice(STORAGE_PREFIX.length)}`);
      if (legacy !== null) return legacy;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/* The theme lives under its own key, outside the nova. settings namespace: it is a display
   preference, not a connection, and it defaults to dark when nothing was ever stored. */
const THEME_STORAGE_KEY = 'nova_theme';
const readTheme = (fallback = 'dark') => {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : fallback;
  } catch {
    return fallback;
  }
};

function trimTrailingSlashes(url) {
  return url.trim().replace(/\/+$/, '');
}

// The standalone single-file build, published beside index.html at the site root.
const STANDALONE_PAGE = './nova.html';
const STANDALONE_FILENAME = 'nova.html';

// Same-origin Vite proxy path. It only resolves when the app is served by the local
// Vite dev/preview server; static hosts (GitHub Pages) have no backend.
const OLLAMA_PROXY_PATH = '/api/ollama';

// Ollama exposes an OpenAI-compatible API under `/v1`. Without a custom URL we
// keep using the Vite proxy so the browser stays same-origin in local dev.
function ollamaEndpoint(settings) {
  const custom = trimTrailingSlashes(settings.ollamaUrl || '');
  if (!custom) return OLLAMA_PROXY_PATH;
  return /\/v1$/i.test(custom) ? custom : `${custom}/v1`;
}

function endpointWarning(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  if (!/^https?:\/\/\S+$/i.test(trimmed)) {
    return "Try a full address starting with http:// or https://.";
  }
  return '';
}

// Fields that are blank with nothing behind them. The model falls back to the
// shipped default and a blank endpoint falls back to the dev proxy, so neither
// needs a value there; a single-file copy has no proxy, so only its endpoint is
// genuinely required. SettingsPanel flashes exactly these ids when it opens.
function settingsAttention(draft, standalone) {
  if (draft.backend === 'gemini') return [];
  return standalone && !String(draft.ollamaUrl || '').trim() ? ['ollama-url'] : [];
}

// A hint that tells the operator exactly how to let this page reach Ollama.
function ConnectionHelp() {
  const originsCommand = ollamaOriginsCommand();
  return (
    <details className="field-help">
      <summary>Need a hand connecting to Ollama?</summary>
      <div className="field-help-body">
        <p>
          If Ollama won’t connect, we may need to allow this page in its CORS settings.
          Plain <code>http</code> isn’t the problem: browsers treat <code>http://localhost</code>
          as a secure origin. A <code>file://</code> copy sends <code>Origin: null</code>,
          which Ollama doesn’t allow by default. The command below can help.
        </p>
        <ol>
          <li>
            <span>Try restarting Ollama with this command to allow this page:</span>
            <code className="field-help-command">{originsCommand}</code>
          </li>
          <li>
            <span>
              {STANDALONE_BUILD
                ? "For a single-file copy, use the wildcard above because the file has no fixed origin."
                : `For this hosted page, we can allow just ${originsCommand.split('=')[1]?.split(' ollama')[0] || 'this page’s origin'} instead of every origin.`}
            </span>
          </li>
          <li>
            <span>If you can’t restart Ollama, you’ll need a trusted relay that allows this page’s origin.</span>
          </li>
        </ol>
        <p className="field-help-note">
          Chrome may also ask for local network access; allow it if you’d like this page
          to connect to your Ollama. An HTTPS relay or tunnel can help too, but make sure
          it allows this page’s origin and has access controls before sharing its URL.
        </p>
      </div>
    </details>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4.1" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5l1.5 1.5M17 17l1.5 1.5M18.5 5.5L17 7M7 17l-1.5 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M19.6 13.4A8.2 8.2 0 1 1 10.6 4.4a6.5 6.5 0 0 0 9 9Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 8.9a3.1 3.1 0 1 0 0 6.2 3.1 3.1 0 0 0 0-6.2Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="m19.3 13.1 1.1.9-1.2 2.1-1.4-.5a7.8 7.8 0 0 1-1.4.8l-.2 1.5h-2.4l-.4-1.4a7.8 7.8 0 0 1-1.6 0l-.8 1.2-2.1-1.2.5-1.4a7.8 7.8 0 0 1-.8-1.4l-1.5-.2v-2.4l1.4-.4a7.8 7.8 0 0 1 0-1.6l-1.2-.8 1.2-2.1 1.4.5a7.8 7.8 0 0 1 1.4-.8l.2-1.5h2.4l.4 1.4a7.8 7.8 0 0 1 1.6 0l.8-1.2 2.1 1.2-.5 1.4a7.8 7.8 0 0 1 .8 1.4l1.5.2v2.4l-1.4.4c.1.5.1 1 0 1.5Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

function MicIcon({ stopped = false }) {
  return stopped ? (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="8" y="4" width="8" height="12" rx="4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5.4 11.3a6.6 6.6 0 0 0 13.2 0M12 18v3m-3.2 0h6.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="m5 5 14 14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="8" y="3" width="8" height="13" rx="4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5.4 11.2a6.6 6.6 0 0 0 13.2 0M12 18v3m-3.2 0h6.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2.2" fill="currentColor" />
    </svg>
  );
}

// Reads the SSE stream. `onDelta` gets each piece of text; `onChunk` runs after
// each network chunk, so speech can start while the rest is still generating.
async function readChatCompletionStream(response, { onDelta = () => {}, onChunk = () => {} } = {}) {
  if (!response.body) throw new Error(OLLAMA_REPLY_ERRORS.noStream);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  let readerDone = false;
  let streamDone = false;
  let finishReason = null;

  const consumeLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (!data) return;
    if (data === '[DONE]') {
      streamDone = true;
      return;
    }

    let chunk;
    try {
      chunk = JSON.parse(data);
    } catch {
      throw new Error(OLLAMA_REPLY_ERRORS.invalidStream);
    }
    if (chunk.error) throw ollamaError(chunk.error.message || OLLAMA_REPLY_ERRORS.interrupted);
    const delta = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content;
    if (typeof delta === 'string') { answer += delta; onDelta(delta); }
    finishReason = chunk.choices?.[0]?.finish_reason || finishReason;
  };

  while (!readerDone && !streamDone) {
    const { value, done } = await reader.read();
    readerDone = done;
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let newline = buffer.indexOf('\n');
    while (newline !== -1 && !streamDone) {
      consumeLine(buffer.slice(0, newline).replace(/\r$/, ''));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
    if (!streamDone) onChunk();
  }

  if (!streamDone && buffer.trim()) consumeLine(buffer);
  if (streamDone && !readerDone) await reader.cancel().catch(() => {});
  const completeAnswer = answer.trim();
  if (!completeAnswer) throw new Error(OLLAMA_REPLY_ERRORS.emptyReply);
  return { answer: completeAnswer, finishReason };
}

// Web Speech voices load asynchronously: Chrome returns an empty list on the first
// call and then fires `voiceschanged`. Re-read on that event, and once more on a
// short timer for engines that never fire it.
function useSpeechVoices() {
  const [voices, setVoices] = useState(listVoices);

  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return undefined;
    const refresh = () => setVoices(listVoices());
    refresh();
    synth.addEventListener?.('voiceschanged', refresh);
    const timer = window.setTimeout(refresh, 500);
    return () => {
      synth.removeEventListener?.('voiceschanged', refresh);
      window.clearTimeout(timer);
    };
  }, []);

  return voices;
}

async function fetchOllamaModels(endpoint, signal) {
  const response = await fetch(`${endpoint}/models`, { signal });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw ollamaError(payload.error?.message, response.status);
  }
  const payload = await response.json();
  return Array.isArray(payload.data) ? payload.data : [];
}

function hasOllamaModel(models, model) {
  const requestedModel = model.trim();
  return models.some((entry) => entry.id === requestedModel || entry.id?.startsWith(`${requestedModel}:`));
}

// Exported so scripts/verify-speech.mjs can render the panel and inspect the
// voice selector it produces.
export function SettingsPanel({ settings, voices, connection, modelAvailable, standalone, onClose, onSave, onConnectionChange, openerRef,
  memories = [], memoryError = '', onDeleteMemory = () => {}, onClearMemory = () => false,
  onTestVoice = null, onStopVoiceTest = null, voiceTestPlaying = false, voiceTestDisabled = true, speechAvailable = false,
  kokoroStatus = { state: 'failed', progress: null } }) {
  const kokoroActive = kokoroStatus.state !== 'failed';
  const [draft, setDraft] = useState(settings);
  const [testStatus, setTestStatus] = useState('idle');
  const [testMessage, setTestMessage] = useState('');
  const [downloadStatus, setDownloadStatus] = useState('idle');
  const [downloadMessage, setDownloadMessage] = useState('');
  const [confirmClearMemory, setConfirmClearMemory] = useState(false);
  const modelInputRef = useRef(null);
  const panelRef = useRef(null);
  const testControllerRef = useRef(null);
  const memoryHeadingRef = useRef(null);

  useEffect(() => {
    modelInputRef.current?.focus();
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = panelRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
      testControllerRef.current?.abort();
      onStopVoiceTest?.();
      openerRef.current?.focus();
    };
  }, [onClose, onStopVoiceTest, openerRef]);

  const handleSubmit = (event) => {
    event.preventDefault();
    onSave(draft);
  };

  const testOllama = async () => {
    testControllerRef.current?.abort();
    const controller = new AbortController();
    testControllerRef.current = controller;
    setTestStatus('checking');
    setTestMessage("Let's see if Ollama is ready...");
    try {
      const models = await fetchOllamaModels(ollamaEndpoint(draft), controller.signal);
      const requestedModel = draft.model.trim() || OLLAMA_MODEL;
      const installed = hasOllamaModel(models, requestedModel);
      const savedModel = settings.model.trim() || OLLAMA_MODEL;
      onConnectionChange('connected', hasOllamaModel(models, savedModel));
      setTestStatus(installed ? 'success' : 'warning');
      setTestMessage(installed
        ? "All set! Ollama's ready and your model is available."
        : `We’re connected! I can’t find “${requestedModel}” yet — try installing it in Ollama.`);
    } catch (error) {
      if (error.name === 'AbortError') return;
      onConnectionChange('offline', false);
      setTestStatus('error');
      setTestMessage(friendlyOllamaError(error, draft.model.trim() || OLLAMA_MODEL));
    }
  };

  // Fetch the standalone build and download it byte-for-byte. A dev server that
  // rewrites HTML (Vite HMR injection) would corrupt the file, so the response is
  // verified against the parsed document before it is offered as a download.
  const downloadStandalone = async () => {
    setDownloadStatus('working');
    setDownloadMessage("Getting your copy ready...");
    try {
      const response = await fetch(STANDALONE_PAGE, { cache: 'no-store' });
      if (!response.ok) throw new Error("I couldn’t find that download right now.");
      const markup = await response.text();
      const parsed = new DOMParser().parseFromString(markup, 'text/html');
      if (parsed.querySelectorAll('script').length !== 1) {
        throw new Error("I couldn’t find the offline copy here. Try downloading nova.html from the GitHub Pages site.");
      }
      const url = URL.createObjectURL(new Blob([markup], { type: 'text/html' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = STANDALONE_FILENAME;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      setDownloadStatus('success');
      setDownloadMessage(`Your ${STANDALONE_FILENAME} download is ready. Open it in Chrome and allow local network access if asked.`);
    } catch {
      setDownloadStatus('error');
      setDownloadMessage("I couldn’t download your offline copy just now. Try again, or get nova.html from the GitHub Pages site.");
    }
  };

  const { natural: naturalVoices, basic: basicVoices } = groupVoices(voices);
  // An empty key follows the priority list, including voices arriving after load.
  const autoVoice = defaultVoice(voices);
  const selectedKey = voiceKey(resolveVoice(voices, draft.voiceKey));
  const selectedVoice = resolveVoice(voices, selectedKey) || autoVoice;
  // A saved voice can vanish if the user uninstalls it; say so rather than silently
  // switching under them.
  const voiceCount = voices.length;
  const savedVoiceMissing = Boolean(draft.voiceKey) && voiceCount > 0 && !resolveVoice(voices, draft.voiceKey);
  const draftModel = draft.model.trim() || OLLAMA_MODEL;
  // Opening Settings should make an unusable blank field obvious at a glance.
  const attention = settingsAttention(draft, standalone);
  const connectionLabel = connection === 'checking'
    ? "Let's see if Ollama is ready..."
    : connection === 'offline'
      ? "Ollama isn't connected yet"
      : modelAvailable === false && draftModel === settings.model
        ? "We're connected — let's find your model."
        : "Ollama's ready!";

  return (
    <div className="settings-panel-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={panelRef} id="nova-settings-panel" className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="settings-panel-header">
          <div>
            <p className="settings-eyebrow">{APP_NAME} / PREFERENCES</p>
            <h2 id="settings-title">Settings</h2>
          </div>
          <button className="icon-button settings-close" type="button" aria-label="Close settings" onClick={onClose}>
            <span /><span />
          </button>
        </header>

        <form className="settings-form" onSubmit={handleSubmit}>
          <div className="settings-panel-content">
            <fieldset className="settings-field backend-field">
              <legend className="field-label">AI Backend</legend>
              <div className="backend-options">
                <label className={`backend-option${draft.backend !== 'gemini' ? ' is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="ai-backend"
                    value="ollama"
                    checked={draft.backend !== 'gemini'}
                    onChange={() => { setDraft((current) => ({ ...current, backend: 'ollama' })); setTestStatus('idle'); setTestMessage(''); }}
                  />
                  <span>
                    <strong>Ollama (Local)</strong>
                    <small>Your current setup. Chats run on your own Ollama server, http://localhost:11434 by default.</small>
                  </span>
                </label>
                <label className={`backend-option${draft.backend === 'gemini' ? ' is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="ai-backend"
                    value="gemini"
                    checked={draft.backend === 'gemini'}
                    onChange={() => setDraft((current) => ({ ...current, backend: 'gemini' }))}
                  />
                  <span>
                    <strong>Gemini (Cloud)</strong>
                    <small>Google’s Gemini API. Your messages and saved memories are sent to Google.</small>
                  </span>
                </label>
              </div>
            </fieldset>

            {draft.backend === 'gemini' && (
              <div className="settings-field">
                <label className="field-label" htmlFor="gemini-key">Gemini API key</label>
                <input
                  id="gemini-key"
                  className="settings-input"
                  type="password"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  placeholder="Paste your key"
                  value={draft.geminiKey}
                  onChange={(event) => setDraft((current) => ({ ...current, geminiKey: event.target.value }))}
                />
                <p className="field-hint">
                  Saved only in this browser. Create a key in Google AI Studio. It is sent to Google as part of each request.
                </p>
              </div>
            )}

            {draft.backend !== 'gemini' && (<>
            <div className="settings-field">
              <label className="field-label" htmlFor="ollama-model">Ollama model</label>
              <input
                ref={modelInputRef}
                id="ollama-model"
                className="settings-input"
                type="text"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck="false"
                placeholder={OLLAMA_MODEL}
                value={draft.model}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, model: event.target.value }));
                  setTestStatus('idle');
                  setTestMessage('');
                }}
              />
              <p className="field-hint">This is the Ollama model I’ll chat with. The default is {OLLAMA_MODEL}.</p>
            </div>

            <div className="settings-field">
              <label className="field-label" htmlFor="ollama-url">Ollama endpoint <span>{attention.length ? 'REQUIRED' : 'OPTIONAL'}</span></label>
              <input
                id="ollama-url"
                className={`settings-input${attention.includes('ollama-url') ? ' needs-attention' : ''}`}
                type="url"
                inputMode="url"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck="false"
                placeholder="http://localhost:11434"
                value={draft.ollamaUrl}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, ollamaUrl: event.target.value }));
                  setTestStatus('idle');
                  setTestMessage('');
                }}
              />
              <p className={`field-hint ${endpointWarning(draft.ollamaUrl) || attention.length ? 'field-hint-error' : ''}`} aria-live="polite">
                {attention.length
                  ? "A saved copy has no local server to lean on, so I need an address here — http://localhost:11434 if Ollama runs on this computer."
                  : endpointWarning(draft.ollamaUrl)
                    || (standalone
                      ? "Keep the default if Ollama is running on this computer, or enter the address you’d like me to use."
                      : "Leave this blank when using the local Vite server. On a hosted page, use an Ollama address your browser can reach.")}
              </p>
              <ConnectionHelp />
            </div>
            </>)}

            <div className="settings-divider" />

            <div className="settings-field">
              <label className="field-label" htmlFor="nova-voice">{APP_NAME} Voice (Kokoro AI)</label>
              <select
                id="nova-voice"
                className="settings-select kokoro-voice-select"
                value={kokoroVoice(draft.kokoroVoice).id}
                disabled={!kokoroActive}
                onChange={(event) => {
                  onStopVoiceTest?.();
                  setDraft((current) => ({ ...current, kokoroVoice: event.target.value }));
                }}
              >
                {KOKORO_VOICES.map((voice) => <option key={voice.id} value={voice.id}>{kokoroVoiceLabel(voice)}</option>)}
              </select>
              <p className={`field-hint kokoro-status ${kokoroActive ? '' : 'field-hint-error'}`}>
                {kokoroStatus.state === 'ready'
                  ? "Kokoro is ready. I make speech right here in your browser, so your replies aren’t sent to a speech service."
                  : kokoroStatus.state === 'loading'
                    ? `Loading the Kokoro voice model${kokoroStatus.progress == null ? '' : ` (${kokoroStatus.progress}%)`}. The first load downloads about 115 MB; after that your browser usually keeps a copy.`
                    : "I couldn’t load Kokoro here, so I’m using your browser’s voice instead."}
              </p>
              {!kokoroActive && <>
                <label className="field-label" htmlFor="nova-browser-voice">Browser voice (fallback)</label>
                <select
                  id="nova-browser-voice"
                  className="settings-select browser-voice-select"
                  value={selectedKey}
                  disabled={!voiceCount}
                  onChange={(event) => {
                    onStopVoiceTest?.();
                    setDraft((current) => ({ ...current, voiceKey: event.target.value }));
                  }}
                >
                  <option value="">{voiceCount ? `Automatic — ${autoVoice?.name || 'browser default'}`
                    : speechAvailable ? "Voices are still loading — browser default" : "No voices here yet"}</option>
                  {naturalVoices.length > 0 && (
                    <optgroup label="Natural / Online">
                      {naturalVoices.map((voice) => (
                        <option key={voiceKey(voice)} value={voiceKey(voice)}>{voiceOptionLabel(voice)}</option>
                      ))}
                    </optgroup>
                  )}
                  {basicVoices.length > 0 && (
                    <optgroup label="Basic system voices">
                      {basicVoices.map((voice) => (
                        <option key={voiceKey(voice)} value={voiceKey(voice)}>{voiceOptionLabel(voice)}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <p className="field-hint" aria-live="polite">
                  {voiceCount
                    ? `${voiceCount} voice${voiceCount === 1 ? '' : 's'} to choose from. Natural / Online voices are at the top; “network” voices need a connection.`
                    : speechAvailable ? "Your voices are still loading. We can use the browser default for now."
                      : "I can’t find a voice to use in this browser."}
                </p>
                <p className={`field-hint ${savedVoiceMissing ? 'field-hint-error' : ''}`}>
                  {savedVoiceMissing && selectedVoice
                    ? `I can’t find your saved voice here, so I’m using ${describeVoice(selectedVoice)} for now.`
                    : selectedVoice
                      ? `Your voice: ${describeVoice(selectedVoice)} · rate ${TTS.rate}, pitch ${TTS.pitch}, volume ${TTS.volume}.`
                      : `Browser default · rate ${TTS.rate}, pitch ${TTS.pitch}, volume ${TTS.volume}.`}
                </p>
              </>}
              <div className="voice-preview">
                <button className="test-ollama-button test-voice-button" type="button" disabled={voiceTestDisabled || voiceTestPlaying} onClick={() => onTestVoice?.(draft.voiceKey, kokoroVoice(draft.kokoroVoice).id)}>Test Voice</button>
                {voiceTestPlaying && <button className="text-button voice-test-stop" type="button" onClick={onStopVoiceTest}>Stop test</button>}
              </div>
              <p className="field-hint">
                {!kokoroActive && !speechAvailable ? "I can’t speak aloud in this browser. You can try Chrome or Edge instead."
                  : voiceTestDisabled && !voiceTestPlaying ? "Let me finish this reply, then we can try a voice."
                  : `Preview: “${TTS_TEST_TEXT}”`}
              </p>
            </div>

            <div className="settings-divider" />

            <label className="settings-toggle-row" htmlFor="show-transcript">
              <span className="settings-toggle-copy">
                <span className="config-title">Show last response</span>
                <span className="config-detail">Read my last reply below {APP_NAME}</span>
              </span>
              <input
                id="show-transcript"
                className="settings-toggle-input"
                type="checkbox"
                checked={draft.showTranscript}
                onChange={(event) => setDraft((current) => ({ ...current, showTranscript: event.target.checked }))}
              />
              <span className="settings-switch" aria-hidden="true"><i /></span>
            </label>

            <div className="settings-divider" />

            <section className="settings-memory" aria-labelledby="memory-title">
              <div className="settings-test-heading">
                <h3 ref={memoryHeadingRef} id="memory-title" className="field-label" tabIndex={-1}>Memory</h3>
                <span className="config-detail">{memoryError && !memories.length ? "Not ready yet" : `${memories.length} saved ${memories.length === 1 ? 'memory' : 'memories'}`}</span>
              </div>
              <p className="field-hint">
                I keep your memories in this browser and share them with your chosen Ollama endpoint when we chat.
                Memory changes are saved right away, even if you cancel other settings.
              </p>
              {memoryError && <p className="field-hint field-hint-error" role="status" aria-live="polite">{memoryError}</p>}
              {memories.length ? (
                <ul className="memory-list">
                  {memories.map((fact) => (
                    <li key={fact}>
                      <span>{fact}</span>
                      <button className="text-button memory-delete" type="button" aria-label={`Delete memory: ${fact}`} onClick={() => { if (onDeleteMemory(fact)) memoryHeadingRef.current?.focus(); }}>Delete</button>
                    </li>
                  ))}
                </ul>
              ) : !memoryError && (
                <p className="field-hint">We haven’t saved any memories yet. Tell me something you’d like me to remember.</p>
              )}
              {confirmClearMemory && <p className="field-hint" role="status">Would you like to clear all your saved memories? We can’t undo this.</p>}
              <div className="memory-actions">
                {confirmClearMemory ? (
                  <>
                    <button className="test-ollama-button" type="button" onClick={() => { if (onClearMemory()) { setConfirmClearMemory(false); memoryHeadingRef.current?.focus(); } }}>Yes, clear all</button>
                    <button className="text-button" type="button" onClick={() => { setConfirmClearMemory(false); memoryHeadingRef.current?.focus(); }}>Keep memories</button>
                  </>
                ) : (
                  <button className="test-ollama-button" type="button" disabled={!memories.length && !memoryError} onClick={() => setConfirmClearMemory(true)}>Clear all memory</button>
                )}
              </div>
            </section>

            <div className="settings-divider" />

            {draft.backend !== 'gemini' && (
            <div className="settings-test">
              <div className="settings-test-heading">
                <div>
                  <span className="config-title">Ollama connection</span>
                  <span className="config-detail">{connectionLabel}</span>
                </div>
                <button className="test-ollama-button" type="button" onClick={testOllama} disabled={testStatus === 'checking'}>
                  {testStatus === 'checking' ? "Checking..." : 'Test Ollama'}
                </button>
              </div>
              <p className={`test-result test-result-${testStatus}`} role="status" aria-live="polite">
                <i />
                {testMessage || "Let’s check that Ollama and your chosen model are ready."}
              </p>
            </div>
            )}

            <div className="settings-divider" />

            <div className="settings-field">
              <span className="field-label">Offline copy <span>OPTIONAL</span></span>
              {standalone ? (
                <p className="field-hint">
                  You’re already using the single-file copy, so there’s nothing else to download.
                  If Ollama won’t connect, the connection help above can walk you through its CORS settings.
                </p>
              ) : (
                <>
                  <button
                    className="standalone-button"
                    type="button"
                    onClick={downloadStandalone}
                    disabled={downloadStatus === 'working'}
                  >
                    {downloadStatus === 'working' ? "Getting it ready..." : `Download ${STANDALONE_FILENAME}`}
                  </button>
                  <p className={`field-hint ${downloadStatus === 'error' ? 'field-hint-error' : ''}`} role="status" aria-live="polite">
                    {downloadMessage
                      || "Keep a copy on your computer with no build step. Open it in Chrome to connect to Ollama directly."}
                  </p>
                </>
              )}
            </div>
          </div>

          <footer className="settings-panel-footer">
            <button className="text-button" type="button" onClick={onClose}>Cancel</button>
            <button className="save-button" type="submit">Save settings <span>↗</span></button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function App() {
  const [stage, setStage] = useState('ready');
  const [connection, setConnection] = useState('checking');
  const [modelAvailable, setModelAvailable] = useState(null);
  const [settings, setSettings] = useState(() => ({
    model: readSetting('nova.ollama.model', OLLAMA_MODEL) || OLLAMA_MODEL,
    ollamaUrl: readSetting('nova.ollama.url', defaultOllamaUrl()),
    backend: normalizeBackend(readSetting(BACKEND_STORAGE_KEY, DEFAULT_BACKEND)),
    geminiKey: readSetting(GEMINI_KEY_STORAGE),
    voiceKey: readSetting(TTS_VOICE_KEY),
    kokoroVoice: kokoroVoice(readSetting(KOKORO_VOICE_KEY, DEFAULT_KOKORO_VOICE)).id,
    showTranscript: readSetting('nova.transcript.visible', 'false') === 'true',
  }));
  const [avatar, setAvatar] = useState(readAvatar);
  // Switching appearance leaves the live recognizer, request and audio refs intact.
  // The shell paints immediately; the document attribute also themes the body blobs.
  useEffect(() => {
    try {
      document.documentElement.setAttribute('data-avatar', avatar);
    } catch { /* A document-less renderer still has the shell's palette. */ }
  }, [avatar]);
  const selectAvatar = useCallback((nextAvatar) => {
    if (nextAvatar !== 'orb' && nextAvatar !== 'bot') return;
    setAvatar(nextAvatar);
    try {
      window.localStorage.setItem(AVATAR_STORAGE_KEY, nextAvatar);
    } catch { /* A blocked store must not prevent switching appearances. */ }
  }, []);
  const [theme, setTheme] = useState(readTheme);
  // One class on the shell paints every surface; <html> is told as well, so the page canvas
  // and its lights flip with it. Both writes are guarded: a tree mounted without a document
  // element or storage still themes itself, it just cannot remember the choice.
  useEffect(() => {
    try {
      document.documentElement.setAttribute('data-theme', theme);
    } catch {
      /* no document to theme */
    }
    try {
      // A first visit seeds the default; reloading the choice nobody changed is a read.
      if (window.localStorage.getItem(THEME_STORAGE_KEY) !== theme) window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* a blocked store loses the preference, never the appearance */
    }
  }, [theme]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memoryState, setMemoryState] = useState(readMemoryStore);
  const [lastResponse, setLastResponse] = useState('');
  const [richContent, setRichContent] = useState(null);
  const richContentRef = useRef(null);
  const richVersionRef = useRef(0);
  const richTimersRef = useRef({ expiry: null, removal: null });
  const [browse, setBrowse] = useState(null);
  const browseRef = useRef(null);
  const browseTimerRef = useRef(null);
  const richSlotRef = useRef(null);
  const micButtonRef = useRef(null);
  const [notice, setNotice] = useState('');
  const [wakeStandby, setWakeStandby] = useState(false);
  const [wakeMessage, setWakeMessage] = useState('');
  // The standby earner lights up while the mic is hearing the wake phrase coming.
  const [wakeAlert, setWakeAlert] = useState(false);
  const wakeAlertTimerRef = useRef(null);
  // Brief wake and post-reply flourishes; busy stages always take visual priority.
  const [mood, setMood] = useState('idle');
  const voices = useSpeechVoices();
  const [speechVoiceName, setSpeechVoiceName] = useState('');
  const [voiceTestPlaying, setVoiceTestPlaying] = useState(false);
  const voiceTestRef = useRef(false);
  const speechAvailable = typeof window !== 'undefined' && typeof window.speechSynthesis?.speak === 'function'
    && typeof SpeechSynthesisUtterance === 'function';
  // Kokoro needs a module worker (inference) and Web Audio (playback); otherwise
  // the Web Speech fallback is used from the start.
  const [kokoroStatus, setKokoroStatus] = useState(() => ({
    state: typeof window !== 'undefined' && typeof window.Worker === 'function' && typeof window.Blob === 'function'
      && typeof window.URL?.createObjectURL === 'function' && (window.AudioContext || window.webkitAudioContext) ? 'loading' : 'failed',
    progress: null,
  }));
  const kokoroActive = kokoroStatus.state !== 'failed';
  const kokoroRef = useRef(null);
  const kokoroAudioRef = useRef(null);
  const preferredVoice = resolveVoice(voices, settings.voiceKey) || defaultVoice(voices);
  const kokoroVoiceName = `${kokoroVoice(settings.kokoroVoice).name} · Kokoro AI`;
  // Warm-up shows as its own tiny indicator; download progress lives in Settings.
  const activeVoiceName = speechVoiceName || (kokoroActive
    ? kokoroVoiceName
    : speechAvailable
      ? (preferredVoice ? preferredVoice.name || 'Unnamed voice' : 'Browser default')
      : "Voice isn’t available here");
  const moodTimerRef = useRef(null);
  const noticeTimerRef = useRef(null);
  const settingsTriggerRef = useRef(null);
  const voiceListenerRef = useRef(null);
  const wakeChimeRef = useRef(null);
  const speechFinishRef = useRef(null);
  const speakBrowserRef = useRef(null);
  // Chrome can garbage-collect a queued utterance and silently drop its events.
  const utteranceRef = useRef(null);
  const requestControllerRef = useRef(null);
  const promptRef = useRef(null);
  const speakRef = useRef(null);
  const interruptRef = useRef(null);
  const speakingSourceRef = useRef(null); // What NOVA is saying now, to tell her voice from an interrupt.
  const greetTimerRef = useRef(null);     // A name greeting waiting for a question that may not come.
  const greetingRef = useRef('');         // The greeting being spoken, so hearing it back is not a question.
  const avatarContainerRef = useRef(null);
  const conversationRef = useRef([]);
  const memoriesRef = useRef(memoryState.facts);
  // The last memory NOVA saved this session, so a bare "forget that" has something to point at.
  const lastSavedMemoryRef = useRef('');

  const SpeechRecognition = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;

  const notify = useCallback((message) => {
    setNotice(message);
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), 4600);
  }, []);

  // A short-lived highlight, so a word heard on the way to “hey nova” is visible
  // even when the wake phrase itself never lands.
  const flashWakeAlert = useCallback(() => {
    setWakeAlert(true);
    window.clearTimeout(wakeAlertTimerRef.current);
    wakeAlertTimerRef.current = window.setTimeout(() => setWakeAlert(false), 1600);
  }, []);

  const dismissRichResponse = useCallback((immediate = false) => {
    richVersionRef.current += 1; // Invalidates a pending answer's late publication.
    window.clearTimeout(richTimersRef.current.expiry);
    const current = richContentRef.current;
    if (!immediate && current?.closing) return; // Repeated words never extend the fade.
    window.clearTimeout(richTimersRef.current.removal);
    if (richSlotRef.current?.contains?.(document.activeElement)) micButtonRef.current?.focus?.();
    if (immediate || !current) {
      richContentRef.current = null;
      setRichContent(null);
      return;
    }
    const closing = { ...current, closing: true };
    richContentRef.current = closing;
    setRichContent(closing);
    richTimersRef.current.removal = window.setTimeout(() => {
      if (richContentRef.current !== closing) return;
      richContentRef.current = null;
      setRichContent(null);
    }, RICH_FADE_MS);
  }, []);

  // The browsing panel slides in beside NOVA, and out on "close" or its × button.
  // Every page it loads goes through one stop on the panel's own trail, so the
  // address bar, the arrows and NOVA's voice commands all move the same state.
  const pushBrowseStop = useCallback((stop) => {
    window.clearTimeout(browseTimerRef.current);
    const current = browseRef.current;
    const open = current && !current.closing;
    const trail = pushBrowseHistory(open ? current.entries : [], open ? current.step : -1, stop);
    const next = { ...stop, ...trail, frame: 0, closing: false };
    browseRef.current = next;
    setBrowse(next);
    return true;
  }, []);

  const openBrowse = useCallback((kind, query) => {
    pushBrowseStop({ kind, query, url: browseUrl(kind, query) });
  }, [pushBrowseStop]);

  // Typed or pasted into the address bar. Returns false for an address the frame
  // must not load, so the panel can say so instead of sitting still.
  const goBrowse = useCallback((text) => {
    const stop = browseInputStop(text);
    return stop ? pushBrowseStop(stop) : false;
  }, [pushBrowseStop]);

  // The frame is cross-origin, so its own history is unreadable and unsteerable:
  // "back" means the previous stop NOVA opened. At the start of the trail it means
  // leaving the panel, which is what "go back" did before the panel had a trail.
  const stepBrowse = useCallback((delta) => {
    const current = browseRef.current;
    if (!current || current.closing) return false;
    const step = current.step + delta;
    const stop = current.entries[step];
    if (!stop) return false;
    const next = { ...current, ...stop, step, frame: 0 };
    browseRef.current = next;
    setBrowse(next);
    return true;
  }, []);

  // contentWindow.location.reload() throws across origins, so a refresh remounts
  // the frame on the same address instead.
  const refreshBrowse = useCallback(() => {
    const current = browseRef.current;
    if (!current || current.closing) return false;
    const next = { ...current, frame: (current.frame || 0) + 1 };
    browseRef.current = next;
    setBrowse(next);
    return true;
  }, []);
  const closeBrowse = useCallback(() => {
    const current = browseRef.current;
    if (!current || current.closing) return;
    const closing = { ...current, closing: true };
    browseRef.current = closing;
    setBrowse(closing);
    browseTimerRef.current = window.setTimeout(() => {
      if (browseRef.current !== closing) return;
      browseRef.current = null;
      setBrowse(null);
    }, BROWSE_SLIDE_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(browseTimerRef.current), []);

  const showRichResponse = useCallback((content, version) => {
    if (version !== richVersionRef.current || !hasRichResponse(content)) return;
    window.clearTimeout(richTimersRef.current.expiry);
    window.clearTimeout(richTimersRef.current.removal);
    const panel = { content, closing: false };
    richContentRef.current = panel;
    setRichContent(panel);
    richTimersRef.current.expiry = window.setTimeout(() => {
      if (richContentRef.current === panel) dismissRichResponse();
    }, RICH_VISIBLE_MS);
  }, [dismissRichResponse]);

  useEffect(() => () => {
    richVersionRef.current += 1;
    richContentRef.current = null;
    window.clearTimeout(richTimersRef.current.expiry);
    window.clearTimeout(richTimersRef.current.removal);
  }, []);

  const stopVoiceTest = useCallback(() => {
    if (!voiceTestRef.current) return; // Closing settings must never stop a normal reply.
    speechFinishRef.current?.();
    window.speechSynthesis?.cancel();
  }, []);

  const celebrate = useCallback(() => {
    setMood('happy');
    window.clearTimeout(moodTimerRef.current);
    moodTimerRef.current = window.setTimeout(() => setMood('idle'), 1500);
  }, []);

  useEffect(() => () => {
    window.clearTimeout(moodTimerRef.current);
    window.clearTimeout(noticeTimerRef.current);
    window.clearTimeout(wakeAlertTimerRef.current);
  }, []);

  useEffect(() => {
    // Gemini is a cloud service: there is no local server to probe, so it never reads as offline.
    if (settings.backend === 'gemini') {
      setConnection('connected');
      setModelAvailable(true);
      return undefined;
    }
    const controller = new AbortController();
    setConnection('checking');
    setModelAvailable(null);
    const checkOllama = async () => {
      try {
        const models = await fetchOllamaModels(ollamaEndpoint(settings), controller.signal);
        setConnection('connected');
        setModelAvailable(hasOllamaModel(models, settings.model || OLLAMA_MODEL));
      } catch (error) {
        if (error.name !== 'AbortError') {
          setConnection('offline');
          setModelAvailable(false);
        }
      }
    };
    checkOllama();
    return () => controller.abort();
  }, [settings.model, settings.ollamaUrl, settings.backend]);

  // Memory is independent of the settings draft. Persist first, then publish it;
  // never claim a fact was saved/deleted when localStorage rejected the write.
  const applyMemoryState = useCallback((next, interrupt = true, forceReset = false) => {
    const changed = JSON.stringify(next.facts) !== JSON.stringify(memoriesRef.current);
    memoriesRef.current = next.facts;
    setMemoryState(next);
    if (!changed && !forceReset) return;
    conversationRef.current = []; // Removed/replaced facts must not survive in chat history.
    if (interrupt) {
      dismissRichResponse(true); // Forgotten facts must not survive in a visual card.
      requestControllerRef.current?.abort();
      speechFinishRef.current?.(false);
      window.speechSynthesis?.cancel();
      window.clearTimeout(moodTimerRef.current);
      setMood('idle');
      setLastResponse('');
      setStage('ready');
    }
  }, [dismissRichResponse]);

  const refreshMemories = useCallback((interrupt = true) => {
    const next = readMemoryStore();
    applyMemoryState(next, interrupt);
    return next;
  }, [applyMemoryState]);

  const commitMemories = useCallback((facts, interrupt = true) => {
    const result = writeMemoryStore(facts);
    applyMemoryState({ facts: result.ok ? facts : memoriesRef.current, error: result.error }, interrupt, result.ok && interrupt);
    return result;
  }, [applyMemoryState]);

  useEffect(() => {
    const sync = (event) => {
      if (event.key !== MEMORY_KEY && event.key !== null) return;
      try {
        if (event.storageArea && event.storageArea !== window.localStorage) return;
      } catch { /* The safe reader below reports blocked storage. */ }
      refreshMemories();
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [refreshMemories]);

  const deleteSavedMemory = useCallback((fact) => {
    const current = refreshMemories();
    if (current.error) { notify(current.error); return false; }
    if (!current.facts.includes(fact)) { notify("That memory is already gone, so there’s nothing more to remove."); return false; }
    const result = commitMemories(current.facts.filter((saved) => saved !== fact));
    notify(result.ok ? "All right, I’ve removed that memory." : result.error);
    return result.ok;
  }, [refreshMemories, commitMemories, notify]);

  const clearSavedMemories = useCallback(() => {
    // Explicit confirmation also lets a user reset an unreadable/corrupt store.
    const result = commitMemories([]);
    notify(result.ok ? "All right, your saved memories are cleared." : result.error);
    return result.ok;
  }, [commitMemories, notify]);

  const askAria = useCallback(async (text) => {
    const prompt = text.trim();
    if (!prompt) return;
    dismissRichResponse();
    const richVersion = richVersionRef.current;
    voiceListenerRef.current?.setMode(null);
    setStage('thinking');
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;

    const currentMemory = refreshMemories(false);
    const intent = parseMemoryIntent(prompt);
    // With the panel open these are browser commands, not questions: "close"/"hide"
    // leave it, "go back"/"next"/"refresh" move the frame, and "go to <site>" loads a
    // page whether or not the panel is already there.
    const panelOpen = Boolean(browseRef.current && !browseRef.current.closing);
    const navRequest = !intent && (panelOpen ? browseNavRequest(prompt) : browseGoto(prompt));
    const closeRequest = !intent && panelOpen && !navRequest && isCloseCommand(prompt);
    const browseQuery = intent || closeRequest || navRequest ? null : browseRequest(prompt);
    if (browseQuery) openBrowse(browseQuery.kind, browseQuery.query);

    let speech = null;
    let stream = null;
    try {
      if (closeRequest) {
        closeBrowse();
        setStage('ready');
        // The stage ends where it started ("ready"), so the mode effect won't re-run: resume here.
        voiceListenerRef.current?.setMode(document.hidden ? null : 'standby');
        return;
      }
      if (navRequest) {
        // Panel commands are answered by the frame itself, so they stay silent and
        // work with Ollama offline: no request, no reply, straight back to standby.
        if (navRequest.action === 'goto') pushBrowseStop({ kind: 'web', query: navRequest.query, url: navRequest.url });
        else if (navRequest.action === 'refresh') refreshBrowse();
        else if (!stepBrowse(navRequest.action === 'back' ? -1 : 1) && navRequest.action === 'back') closeBrowse();
        setStage('ready');
        voiceListenerRef.current?.setMode(document.hidden ? null : 'standby');
        return;
      }
      let answer;
      if (intent) {
        // Memory commands run locally, so listing/saving/forgetting still works
        // with Ollama offline and never relies on a model's claimed memory.
        if (currentMemory.error) answer = currentMemory.error;
        else if (intent.type === 'list') {
          answer = currentMemory.facts.length
            ? `Here’s what I remember about you: ${currentMemory.facts.map(describeMemoryFact).join('; ')}.`
            : "We haven’t saved any memories yet. What would you like me to remember?";
        } else if (intent.type === 'remember') {
          const result = rememberFact(currentMemory.facts, intent.fact);
          if (result.status === 'error') answer = result.error;
          else if (result.status === 'unchanged') {
            lastSavedMemoryRef.current = intent.fact;
            answer = `I’ve got that in mind already: ${describeMemoryFact(intent.fact)}.`;
          } else {
            const saved = commitMemories(result.facts, false);
            if (saved.ok) lastSavedMemoryRef.current = result.fact;
            answer = saved.ok
              ? `Got it! ${result.status === 'updated' ? 'I’ll remember the update' : 'I’ll keep that in mind'}: ${describeMemoryFact(result.fact)}.`
              : saved.error;
          }
        } else if (intent.type === 'forget') {
          // "forget that" with no subject means the memory saved most recently, if it still exists.
          const last = lastSavedMemoryRef.current;
          const subject = !intent.query && last && currentMemory.facts.includes(last) ? last : intent.query;
          const result = forgetFact(currentMemory.facts, subject);
          if (result.status === 'removed') lastSavedMemoryRef.current = '';
          if (result.status === 'error') answer = result.error;
          else if (result.status === 'missing') answer = `I couldn’t find a saved memory about “${result.query}”. We can take a look together in Settings.`;
          else if (result.status === 'ambiguous') answer = `I found a few memories about “${result.query}”. Which one would you like me to forget?`;
          else {
            const saved = commitMemories(result.facts, false);
            answer = saved.ok ? "All right, I’ve removed that from your saved memories." : saved.error;
          }
        }
      }
      if (browseQuery) {
        answer = BROWSE_FOUND_TEXT;
        conversationRef.current = [
          ...conversationRef.current,
          { role: 'user', content: prompt },
          { role: 'assistant', content: answer },
        ].slice(-6);
      } else if (!intent && settings.backend === 'gemini') {
        const conversation = conversationRef.current.slice(-6);
        const systemText = [SYSTEM_PROMPT, memoryPrompt(currentMemory.facts)].filter(Boolean).join('\n\n');
        const turns = [...conversation, { role: 'user', content: prompt }];
        const key = settings.geminiKey.trim();
        if (!key) throw new Error(GEMINI_REPLY_ERRORS.noKey);
        const result = await fetch(geminiEndpoint(key), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify(geminiRequestBody(systemText, turns)),
        });
        const payload = await result.json().catch(() => null);
        if (!result.ok) throw geminiError(payload, result.status);
        const reply = readGeminiText(payload);
        if (!reply.answer) throw new Error(GEMINI_REPLY_ERRORS.noReply);
        if (controller.signal.aborted) return;
        // Gemini's generateContent returns the whole reply at once, so it is spoken as one stream.
        const replyStream = createSpeechStream();
        stream = replyStream;
        replyStream.push(reply.answer);
        replyStream.end({ cutOff: reply.finishReason === 'MAX_TOKENS' });
        answer = replyStream.text || reply.answer;
        conversationRef.current = [
          ...conversation,
          { role: 'user', content: prompt },
          { role: 'assistant', content: answer },
        ].slice(-6);
      } else if (!intent) {
        const conversation = conversationRef.current.slice(-6);
        const messages = [
          {
            role: 'system',
            content: [SYSTEM_PROMPT, memoryPrompt(currentMemory.facts)].filter(Boolean).join('\n\n'),
          },
          ...conversation,
          { role: 'user', content: prompt },
        ];
        const result = await fetch(`${ollamaEndpoint(settings)}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ model: settings.model || OLLAMA_MODEL, messages, stream: true, ...OLLAMA_SAMPLING }),
        });
        if (!result.ok) {
          const payload = await result.json().catch(() => ({}));
          throw ollamaError(payload.error?.message, result.status);
        }
        // Speak the first complete sentence while the rest is still generating.
        const replyStream = createSpeechStream();
        stream = replyStream;
        const startSpeaking = () => {
          if (!speech && replyStream.pending && !controller.signal.aborted) speech = speakRef.current?.(replyStream) ?? null;
        };
        const reply = await readChatCompletionStream(result, {
          onDelta: (delta) => replyStream.push(delta),
          onChunk: () => { replyStream.flush(); startSpeaking(); },
        });
        if (controller.signal.aborted) { replyStream.cancel(); return; }
        // At the token limit the last sentence is unfinished: it isn't spoken or kept.
        replyStream.end({ cutOff: reply.finishReason === 'length' });
        answer = replyStream.text || reply.answer;
        startSpeaking();
        conversationRef.current = [
          ...conversation,
          { role: 'user', content: prompt },
          { role: 'assistant', content: answer },
        ].slice(-6);
      }
      if (controller.signal.aborted) return;
      setLastResponse(answer);
      // A stream with nothing speakable still finishes through the speaker (as "completed").
      const speechCompleted = await (stream ? (speech ?? speakRef.current?.(stream)) : speakRef.current?.(answer));
      if (!controller.signal.aborted) {
        celebrate();
        if (speechCompleted) showRichResponse(richResponse(answer), richVersion);
      }
    } catch (error) {
      // A reply that fails or is canceled mid-stream stops speaking right away.
      if (stream && !stream.ended) stream.cancel();
      if (controller.signal.aborted) return;
      dismissRichResponse(true);
      // A Gemini failure says nothing about the local Ollama server, so don't probe it.
      if (settings.backend === 'gemini') {
        setStage('ready');
        notify(friendlyGeminiError(error));
        return;
      }
      try {
        const models = await fetchOllamaModels(ollamaEndpoint(settings), controller.signal);
        setConnection('connected');
        setModelAvailable(hasOllamaModel(models, settings.model || OLLAMA_MODEL));
      } catch {
        if (controller.signal.aborted) return;
        setConnection('offline');
        setModelAvailable(false);
      }
      setStage('ready');
      notify(friendlyOllamaError(error, settings.model || OLLAMA_MODEL));
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
    }
  }, [notify, settings, celebrate, refreshMemories, commitMemories, dismissRichResponse, showRichResponse, openBrowse, closeBrowse, pushBrowseStop, stepBrowse, refreshBrowse]);

  // Resolve only when speech ends, not when it is queued. Otherwise standby
  // starts too early, hears NOVA's own answer, and "happy" masks speaking eyes.
  // A streamed reply is spoken as it arrives: each utterance takes everything that
  // is ready, and the next one starts when it ends. Stage stays "speaking" between them.
  const speakBrowser = useCallback((input, selectedVoiceKey, preview) => {
    const source = typeof input === 'string' ? textSpeechStream(input) : input;
    if (typeof window.speechSynthesis?.speak !== 'function' || typeof SpeechSynthesisUtterance !== 'function') {
      source.detach();
      setStage('ready');
      notify("I can’t speak aloud in this browser. Turn on Show last response in Settings to read my replies, or try Chrome or Edge.");
      return Promise.resolve(true); // Silent browsers can still use the visual reply.
    }

    voiceListenerRef.current?.setMode(null);
    speechFinishRef.current?.(false);
    window.speechSynthesis.cancel();
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      const avatarElement = avatarContainerRef.current;
      const voice = resolveVoice(voices, selectedVoiceKey) || defaultVoice(voices);
      let speechPulseTimer;
      let watchdogTimer;
      let current = null;
      let first = true;
      let finished = false;

      const clearPulse = () => {
        window.clearTimeout(speechPulseTimer);
        avatarElement?.classList.remove('speech-boundary-active');
        avatarElement?.style.removeProperty('--audio-pulse');
      };
      const finishSpeech = (resume = true, completed = false) => {
        if (finished) return;
        finished = true;
        window.clearTimeout(watchdogTimer);
        clearPulse();
        source.detach();
        if (current && utteranceRef.current === current) utteranceRef.current = null;
        if (speechFinishRef.current === finishSpeech) {
          speechFinishRef.current = null;
          voiceTestRef.current = false;
          setVoiceTestPlaying(false);
          setSpeechVoiceName('');
        }
        if (resume) setStage('ready');
        resolve(completed);
      };

      const speakNext = () => {
        if (finished) return;
        const text = source.poll();
        if (text === undefined) { // The model is still writing the next sentence.
          source.wait().then(speakNext);
          return;
        }
        if (text === null) { finishSpeech(true, true); return; }

        const utterance = new SpeechSynthesisUtterance(text);
        if (voice) {
          utterance.voice = voice;
          if (voice.lang) utterance.lang = voice.lang;
        }
        utterance.rate = TTS.rate;
        utterance.pitch = TTS.pitch;
        utterance.volume = TTS.volume;
        current = utterance;
        const live = () => !finished && current === utterance;
        const next = () => {
          window.clearTimeout(watchdogTimer);
          clearPulse();
          speakNext();
        };
        let started = false;
        utterance.onstart = () => { if (live()) { started = true; setStage('speaking'); } };
        // No word events: neutral eye light/scale, with the CSS speaking bounce intact.
        utterance.onboundary = (event) => {
          if (!live() || (event.name && event.name !== 'word') || !avatarElement) return;
          avatarElement.classList.add('speech-boundary-active');
          const wordLength = Math.max(1, Math.min(event.charLength || 1, 10));
          avatarElement.style.setProperty('--audio-pulse', Math.min(1, 0.65 + wordLength * 0.035).toFixed(3));
          window.clearTimeout(speechPulseTimer);
          speechPulseTimer = window.setTimeout(() => {
            avatarElement.style.setProperty('--audio-pulse', '0');
          }, 125);
        };
        utterance.onend = () => { if (live()) next(); };
        utterance.onerror = () => {
          if (!live()) return;
          finishSpeech();
          if (preview) notify("I couldn’t play that voice just now. Check your connection, or try another voice.");
        };
        // The stuck-speech watchdog runs per utterance, so a pause while the model
        // writes the next sentence is never mistaken for a lost end event.
        const ceiling = speechCeilingMs(text);
        let heard = false;
        let quiet = 0;
        let elapsed = 0;
        const giveUp = (completed) => {
          finishSpeech(true, completed);
          synth.cancel(); // Purge a wedged/stale queue; late events are ignored.
        };
        const watch = () => {
          watchdogTimer = window.setTimeout(() => {
            if (!live()) return;
            elapsed += SPEECH_CHECK_MS;
            if (synth.speaking === true) heard = true;
            quiet = synth.speaking || synth.pending ? 0 : quiet + 1;
            if (heard && quiet >= 2) { // Spoke, but its end event was lost.
              if (source.ended && !source.pending) return giveUp(true);
              synth.cancel();
              return next();
            }
            if (started && !heard) return; // Flags aren't reliable here; trust the events.
            if (elapsed < ceiling && (heard || quiet < 10)) return watch();
            giveUp(heard); // Wedged mid-reply, or a queued utterance that never started.
            if (!heard) notify("I couldn’t start speaking just now. Try again, or choose another voice in Settings.");
          }, SPEECH_CHECK_MS);
        };
        utteranceRef.current = utterance;
        if (first) {
          first = false;
          // Publish only once speech is configured, and freeze the actual utterance's
          // name even if voiceschanged updates the automatic pick while it is queued.
          setSpeechVoiceName(voice ? voice.name || 'Unnamed voice' : 'Browser default');
          setStage('speaking'); // Also covers an engine's queue before onstart.
        }
        try {
          synth.speak(utterance);
          if (live() && typeof synth.speaking === 'boolean') watch();
        } catch {
          finishSpeech();
          notify("I couldn’t start speaking just now. Try again, or choose another voice in Settings.");
        }
      };

      speechFinishRef.current = finishSpeech;
      source.onCancel = () => { finishSpeech(false); synth.cancel(); };
      voiceTestRef.current = preview;
      setVoiceTestPlaying(preview);
      speakNext();
    });
  }, [notify, voices]);

  // One reply through Kokoro: generation shows as "thinking"; "speaking" starts
  // with real audio. The eye pulse follows the audio's loudness on the AudioContext
  // clock and clears the moment playback ends or is canceled.
  const speakKokoro = useCallback((source, engine, audio, kokoroVoiceId, selectedVoiceKey, preview) => {
    voiceListenerRef.current?.setMode(null);
    speechFinishRef.current?.(false);
    window.speechSynthesis?.cancel();
    return new Promise((resolve) => {
      const voice = kokoroVoice(kokoroVoiceId);
      const avatarElement = avatarContainerRef.current;
      let finished = false;
      let session = null;
      const release = () => {
        avatarElement?.classList.remove('speech-boundary-active');
        avatarElement?.style.removeProperty('--audio-pulse');
        if (speechFinishRef.current === finishSpeech) {
          speechFinishRef.current = null;
          voiceTestRef.current = false;
          setVoiceTestPlaying(false);
          setSpeechVoiceName('');
        }
      };
      const finishSpeech = (resume = true, completed = false) => {
        if (finished) return;
        finished = true;
        session?.stop();
        release();
        if (resume) setStage('ready');
        resolve(completed);
      };
      speechFinishRef.current = finishSpeech;
      setSpeechVoiceName(`${voice.name} · Kokoro AI`);
      voiceTestRef.current = preview;
      setVoiceTestPlaying(preview);
      setStage('thinking');
      session = speakWithKokoro({
        engine, getContext: audio.get, source, voice: voice.id, timers: window,
        onWaiting: () => notify("My Kokoro voice is still loading. I’ll speak as soon as it’s ready."),
        onBlocked: () => notify("Tap anywhere or press a key so I can talk out loud."),
        onStart: () => { if (!finished) setStage('speaking'); },
        onPulse: (level) => {
          if (finished || !avatarElement) return;
          if (level === null) {
            avatarElement.classList.remove('speech-boundary-active');
            avatarElement.style.removeProperty('--audio-pulse');
          } else {
            avatarElement.classList.add('speech-boundary-active');
            avatarElement.style.setProperty('--audio-pulse', level.toFixed(3));
          }
        },
      });
      source.onCancel = () => finishSpeech(false);
      session.done.then((result) => {
        if (finished) return;
        if (result.status === 'failed') {
          // Hand the unplayed text to the Web Speech fallback, so nothing is lost.
          finished = true;
          release();
          if (result.reason !== 'load') notify("My Kokoro voice hit a snag, so I’ll use the browser voice for the rest of this reply.");
          source.unshift(result.remaining); // The rest of a streamed reply follows it.
          speakBrowserRef.current(source, selectedVoiceKey, preview).then(resolve);
          return;
        }
        if (result.status === 'blocked') notify("I couldn’t play audio without a tap first. Turn on Show last response in Settings to read my replies.");
        // Blocked audio still gets the visual reply, like a silent browser.
        finishSpeech(true, result.status !== 'stopped');
      });
    });
  }, [notify]);

  speakBrowserRef.current = speakBrowser;

  // Kokoro is the voice. Web Speech is the fallback when Kokoro couldn't load, and
  // for any reply whose first sentence arrives while Kokoro is still warming up
  // (the next reply uses Kokoro once it's ready). A voice test waits for Kokoro,
  // because it is testing that voice. Also used for the rest of one reply if
  // Kokoro fails mid-reply. `input` is text or a speech stream.
  const speakAnswer = useCallback((input, selectedVoiceKey = settings.voiceKey, preview = false, kokoroVoiceId = settings.kokoroVoice) => {
    const source = typeof input === 'string' ? textSpeechStream(input) : input;
    speakingSourceRef.current = source;
    const engine = kokoroRef.current;
    const audio = kokoroAudioRef.current;
    const browserVoice = typeof window.speechSynthesis?.speak === 'function' && typeof SpeechSynthesisUtterance === 'function';
    if (engine && audio && (engine.state === 'ready' || (engine.state === 'loading' && (preview || !browserVoice)))) {
      return speakKokoro(source, engine, audio, kokoroVoiceId, selectedVoiceKey, preview);
    }
    return speakBrowser(source, selectedVoiceKey, preview);
  }, [settings, speakKokoro, speakBrowser]);

  // Both refs are refreshed on every render, so callbacks that outlive a render still
  // reach the current speaker and the current request handler.
  speakRef.current = speakAnswer;

  const testVoice = useCallback((key, kokoroVoiceId) => {
    if (!settingsOpen || stage === 'thinking' || stage === 'speaking' || requestControllerRef.current || speechFinishRef.current) return;
    window.clearTimeout(moodTimerRef.current);
    setMood('idle');
    void speakRef.current?.(TTS_TEST_TEXT, key, true, kokoroVoiceId)?.catch(() => {
      stopVoiceTest();
      setStage('ready');
      notify("I couldn’t start that voice preview. Try another voice in Settings.");
    });
  }, [notify, settingsOpen, stage, stopVoiceTest]);

  // Keep the recognizer's event handler pointed at the latest assistant request.
  promptRef.current = (text) => {
    window.clearTimeout(greetTimerRef.current); // The question is here; skip the hello.
    if (greetingRef.current && isSameSpeech(text, greetingRef.current)) {
      greetingRef.current = ''; // Her own greeting, heard back by the mic. Not a question.
      return;
    }
    askAria(text).then(() => {});
  };

  // Start loading Kokoro on app load. A failed load (blocked CDN, no WebAssembly,
  // download stall, worker crash) switches every reply to the Web Speech fallback.
  useEffect(() => {
    if (kokoroStatus.state === 'failed') return undefined;
    const audio = createKokoroAudio(window.AudioContext || window.webkitAudioContext);
    const engine = createKokoroEngine({
      createWorker: () => browserKokoroWorker(window),
      timers: window,
      voice: settings.kokoroVoice, // Warmed up with the saved voice.
      onStatus: (status) => {
        setKokoroStatus(status);
        if (status.state === 'failed') notify("I couldn’t load my Kokoro voice, so I’ll use your browser’s voice for now.");
      },
    });
    kokoroAudioRef.current = audio;
    kokoroRef.current = engine;
    const unlock = () => { if (engine.state !== 'failed') audio.unlock(); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      speechFinishRef.current?.(false);
      engine.dispose();
      audio.dispose();
      kokoroRef.current = kokoroAudioRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- load once per mount

  useEffect(() => {
    const chime = createWakeChime(window.AudioContext || window.webkitAudioContext);
    wakeChimeRef.current = chime;
    const unlock = () => { void chime.unlock(); };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      chime.dispose();
      wakeChimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const listener = createVoiceListener({
      Recognition: SpeechRecognition,
      onStandbyChange: setWakeStandby,
      onSpeechDetected: (mode) => {
        dismissRichResponse();
        if (mode === 'standby') flashWakeAlert();
        // Words after the wake phrase are the request itself: no room for a hello.
        if (mode === 'question') window.clearTimeout(greetTimerRef.current);
      },
      onInterrupt: () => interruptRef.current?.(),
      spokenText: () => speakingSourceRef.current?.text || '',
      onUnsupported: () => setWakeMessage(WAKE_UNSUPPORTED_MESSAGE),
      onInputStart: () => {
        if (listener.wakeSupported) setWakeMessage('');
      },
      onWake: (reason = 'wake') => {
        dismissRichResponse();
        window.clearTimeout(moodTimerRef.current);
        window.clearTimeout(wakeAlertTimerRef.current);
        setWakeAlert(false);
        setMood('wake');
        moodTimerRef.current = window.setTimeout(() => setMood('idle'), 800);
        setNotice('');
        setStage('listening');
        void wakeChimeRef.current?.play();
        // Once the name is known, a wake word on its own is answered with a hello by name —
        // after a beat, and never when the request came in the same breath as the wake phrase.
        window.clearTimeout(greetTimerRef.current);
        const name = reason === 'question' ? '' : memoryName(memoriesRef.current);
        if (name && !requestControllerRef.current && !speechFinishRef.current) {
          greetTimerRef.current = window.setTimeout(() => {
            greetTimerRef.current = null;
            if (requestControllerRef.current || speechFinishRef.current) return;
            const greeting = `Hi ${name}!`;
            greetingRef.current = greeting;
            const settle = () => { if (greetingRef.current === greeting) greetingRef.current = ''; };
            void speakRef.current?.(greeting)?.then(settle, settle);
          }, WAKE_GREET_MS);
        }
      },
      onQuestion: (text) => promptRef.current?.(text),
      onInputEnd: (reason) => {
        setStage('ready');
        if (reason === 'no-speech') notify("I didn’t catch a question. Say “hey nova” or tap the mic when you’re ready to try again.");
      },
      onError: (error, mode) => {
        if (error === 'not-allowed' || error === 'service-not-allowed') {
          setWakeMessage("I need microphone permission to hear you. Allow it in your browser, then tap the mic button.");
        } else if (mode === 'standby') {
          setWakeMessage("I’m having trouble listening right now. Tap the mic button when you’re ready to try again.");
        }
        if (mode === 'question') {
          notify(error === 'not-allowed' || error === 'service-not-allowed'
            ? "I need microphone permission to hear you. Allow it in your browser settings, then we can try again."
            : error === 'no-speech'
              ? "I didn’t catch that. Tap the mic and give it another try when you’re ready."
              : "I had trouble hearing you just now. Tap the mic to try again.");
        }
      },
    });
    voiceListenerRef.current = listener;
    return () => {
      window.clearTimeout(greetTimerRef.current);
      listener.dispose();
      voiceListenerRef.current = null;
    };
  }, [SpeechRecognition, notify, dismissRichResponse, flashWakeAlert]);

  // Standby is automatic on load / after a reply. Never listen to settings edits
  // or a hidden tab; resume when the main view is idle again. While NOVA speaks,
  // listen only for "stop", "wait" or "hey nova" (not during a voice test).
  // speechVoiceName changes when a reply switches to the fallback voice, whose
  // start pauses the listener, so the interrupt mode is restored then too.
  useEffect(() => {
    const updateMode = () => {
      const mode = settingsOpen || document.hidden || stage === 'thinking'
        ? null
        : stage === 'speaking' ? (voiceTestPlaying ? null : 'interrupt')
          : stage === 'listening' ? 'question' : 'standby';
      voiceListenerRef.current?.setMode(mode);
    };
    updateMode();
    document.addEventListener('visibilitychange', updateMode);
    return () => document.removeEventListener('visibilitychange', updateMode);
  }, [settingsOpen, stage, SpeechRecognition, voiceTestPlaying, speechVoiceName]);

  useEffect(() => () => {
    requestControllerRef.current?.abort();
    speechFinishRef.current?.(false);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  // Stop talking at once (mic button, Space, or "stop" / "wait" / "hey nova") and
  // just listen. Aborting the request ends the reply; canceling its stream stops
  // Kokoro's Web Audio sources and queued chunks, or Web Speech, right away.
  const interruptSpeech = () => {
    requestControllerRef.current?.abort();
    speakingSourceRef.current?.cancel();
    speakingSourceRef.current = null;
    speechFinishRef.current?.(false);
    window.speechSynthesis?.cancel();
    dismissRichResponse();
    window.clearTimeout(moodTimerRef.current);
    setMood('idle');
    setStage('listening');
    voiceListenerRef.current?.setMode('question', { quiet: true });
  };
  interruptRef.current = interruptSpeech;
  const canInterrupt = stage === 'speaking' && !voiceTestPlaying;

  const toggleListening = () => {
    if (stage === 'speaking') {
      if (canInterrupt) interruptSpeech();
      return;
    }
    if (stage === 'listening') {
      voiceListenerRef.current?.setMode(null);
      setStage('ready');
      return;
    }
    if (stage !== 'ready') return;
    dismissRichResponse();
    if (!voiceListenerRef.current?.available) {
      notify("I can’t use the microphone in this browser. Try a recent version of Chrome or Edge so we can talk.");
      return;
    }
    window.speechSynthesis?.cancel();
    window.clearTimeout(moodTimerRef.current);
    setMood('idle');
    setNotice('');
    setStage('listening');
    voiceListenerRef.current.setMode('question');
  };

  useEffect(() => {
    const handleShortcut = (event) => {
      if ((event.code !== 'Space' && event.key !== ' ') || settingsOpen) return;
      const target = event.target;
      if (target?.isContentEditable || target?.closest?.('button, input, textarea, select, a, .rich-content-panel')) return;
      if (stage !== 'ready' && stage !== 'listening' && !canInterrupt) return;
      event.preventDefault();
      if (!event.repeat) toggleListening();
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [settingsOpen, stage, dismissRichResponse, canInterrupt]);

  const statusText = stage === 'ready' && connection === 'checking'
    ? STATUS_TEXT.starting : STATUS_TEXT[stage];

  const avatarActivity = { listening: 'is-listening', thinking: 'is-thinking', speaking: 'is-speaking' }[stage] || '';
  const avatarMood = stage === 'ready'
    ? (connection === 'offline' ? 'is-offline' : mood === 'happy' ? 'is-happy' : '')
    : stage === 'listening' && mood === 'wake' ? 'is-waking' : '';

  const saveSettings = (nextSettings) => {
    const updatedSettings = {
      model: nextSettings.model.trim() || OLLAMA_MODEL,
      ollamaUrl: trimTrailingSlashes(nextSettings.ollamaUrl || ''),
      backend: normalizeBackend(nextSettings.backend),
      geminiKey: (nextSettings.geminiKey || '').trim(),
      voiceKey: (nextSettings.voiceKey || '').trim(),
      kokoroVoice: kokoroVoice(nextSettings.kokoroVoice).id,
      showTranscript: Boolean(nextSettings.showTranscript),
    };
    try {
      window.localStorage.setItem('nova.ollama.model', updatedSettings.model);
      window.localStorage.setItem('nova.ollama.url', updatedSettings.ollamaUrl);
      window.localStorage.setItem(BACKEND_STORAGE_KEY, updatedSettings.backend);
      window.localStorage.setItem(GEMINI_KEY_STORAGE, updatedSettings.geminiKey);
      window.localStorage.setItem(TTS_VOICE_KEY, updatedSettings.voiceKey);
      window.localStorage.setItem(KOKORO_VOICE_KEY, updatedSettings.kokoroVoice);
      window.localStorage.setItem('nova.transcript.visible', String(updatedSettings.showTranscript));
    } catch {
      notify("I couldn’t save your settings just now. Check that browser storage is allowed, then try again.");
      return;
    }
    stopVoiceTest();
    setSettings(updatedSettings);
    setSettingsOpen(false);
    notify("All set! Your settings are saved.");
  };

  const closeSettings = useCallback(() => { stopVoiceTest(); setSettingsOpen(false); }, [stopVoiceTest]);
  const updateConnectionStatus = useCallback((nextConnection, nextModelAvailable) => {
    setConnection(nextConnection);
    setModelAvailable(nextModelAvailable);
  }, []);



  const showRichPanel = Boolean(richContent && !settingsOpen);

  return (
    <div data-avatar={avatar} className={`app-shell avatar-${avatar} stage-${stage}${showRichPanel ? ' has-rich-content' : ''}${browse ? ' has-browse-panel' : ''}${browse?.closing ? ' browse-closing' : ''} theme-${theme}`}>
      <header className="topbar">
        <div className="brand-name">{APP_NAME}</div>
        {/* Two controls live in this corner, both always visible: the light the room is in,
            then the way into settings. */}
        <div className="topbar-actions">
          <button className="icon-button theme-toggle" type="button" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} aria-pressed={theme === 'light'} onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}>
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
          <button ref={settingsTriggerRef} className="icon-button settings-trigger" type="button" aria-label="Open settings" aria-controls="nova-settings-panel" aria-expanded={settingsOpen} onClick={() => { dismissRichResponse(true); setSettingsOpen(true); }}>
            <SettingsIcon />
          </button>
        </div>
      </header>

      <main className="main-stage">
        <section className="assistant-stage" aria-label={`${APP_NAME} voice assistant`}>
          <p className={`status-word status-word-${stage}`} aria-live="polite" aria-atomic="true">{statusText}</p>
          <span
            className={`backend-pill backend-pill-${settings.backend}`}
            title={settings.backend === 'gemini' ? 'Replies come from Google Gemini (change in Settings)' : 'Replies come from Ollama on this computer (change in Settings)'}
          >
            {settings.backend === 'gemini' ? '⚡ Gemini' : '🖥️ Local'}
          </span>
          <div
            ref={avatarContainerRef}
            className={`avatar-container${avatar === 'bot' ? ' avatar-container-bot' : ''} ${avatarActivity} ${avatarMood}`}
          >
            {avatar === 'orb' && <>
              <div className="avatar-backlight" />
            </>}
            {/* Keep the outer ref mounted when switching, including during live speech. */}
            <div className="avatar-figure">
              {avatar === 'bot' ? <BotAvatar expression={avatarExpression(stage, mood)} /> : <RobotAvatar expression={avatarExpression(stage, mood)} />}
            </div>
          </div>
          <p className="active-voice-label" title={activeVoiceName} aria-label={`Active voice: ${activeVoiceName}`} aria-live="polite" aria-atomic="true">{activeVoiceName}</p>
          {/* Kokoro loads once per page, so this only appears while the page first warms up. */}
          {kokoroStatus.state === 'loading' && <p className="kokoro-warmup" role="status">warming up...</p>}
          {connection === 'offline' && (
            <div className="avatar-offline-display" role="status" aria-live="polite">
              <span>{OLLAMA_UNREACHABLE}</span>
              <span>Open Settings if you’d like a hand connecting.</span>
            </div>
          )}
          <h1 className="tagline">What’s on your mind?</h1>
          {settings.showTranscript && lastResponse && (
            <div className="response-transcript" role="region" aria-label="My last reply" aria-live="polite">
              <span>My last reply</span>
              <p>{lastResponse}</p>
            </div>
          )}
        </section>
      </main>

      {showRichPanel && <div className="rich-content-slot" ref={richSlotRef}>
        <RichResponsePanel content={richContent.content} closing={richContent.closing} onClose={() => dismissRichResponse()} />
      </div>}

      <footer className="control-dock">
        {wakeStandby && stage === 'ready' && !settingsOpen && (
          <div className={`wake-indicator${wakeAlert ? ' is-alert' : ''}`} role="status" aria-label={`I’m listening for “${WAKE_WORD}”`} title={`Say “${WAKE_WORD}” whenever you’re ready`}>
            <MicIcon />
            <span className="wake-hint" aria-hidden="true">{`Listening for “${WAKE_WORD}”...`}</span>
          </div>
        )}
        {wakeMessage && <p className="wake-message" role="status" aria-live="polite">{wakeMessage}</p>}
        <div className="mic-control-wrap">
          <div className={`mic-halo ${stage === 'listening' ? 'mic-halo-active' : ''}`} />
          <button
            ref={micButtonRef}
            className={`mic-button ${stage === 'listening' ? 'mic-button-active' : ''}${canInterrupt ? ' mic-button-stop' : ''}`}
            type="button"
            onClick={toggleListening}
            disabled={stage === 'thinking' || (stage === 'speaking' && !canInterrupt)}
            aria-label={canInterrupt ? 'Stop speaking' : stage === 'listening' ? 'Stop listening' : 'Start listening'}
            title={canInterrupt ? 'Stop speaking (or say “stop”)' : undefined}
            aria-keyshortcuts="Space"
          >
            {canInterrupt ? <StopIcon /> : <MicIcon stopped={stage === 'listening'} />}
            <span className="mic-button-sheen" />
          </button>
        </div>
        <AvatarSwitcher avatar={avatar} onChange={selectAvatar} />
      </footer>

      {browse && <BrowsePanel browse={browse} onClose={closeBrowse} onNavigate={goBrowse} onBack={() => stepBrowse(-1)} onForward={() => stepBrowse(1)} onRefresh={refreshBrowse} />}

      {notice && <div className="toast" role="status"><span className="toast-mark">!</span><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          voices={voices}
          speechAvailable={speechAvailable}
          voiceTestPlaying={voiceTestPlaying}
          voiceTestDisabled={!(kokoroActive || speechAvailable) || stage === 'thinking' || stage === 'speaking'}
          kokoroStatus={kokoroStatus}
          onTestVoice={testVoice}
          onStopVoiceTest={stopVoiceTest}
          memories={memoryState.facts}
          memoryError={memoryState.error}
          onDeleteMemory={deleteSavedMemory}
          onClearMemory={clearSavedMemories}
          standalone={STANDALONE_BUILD}
          connection={connection}
          modelAvailable={modelAvailable}
          onClose={closeSettings}
          onSave={saveSettings}
          onConnectionChange={updateConnectionStatus}
          openerRef={settingsTriggerRef}
        />
      )}
    </div>
  );
}

export default App;
