import { useCallback, useEffect, useRef, useState } from 'react';
import RobotAvatar from './RobotAvatar.jsx';
import { APP_NAME } from './brand.js';
import {
  OLLAMA_REPLY_ERRORS, OLLAMA_UNREACHABLE, STATUS_TEXT, SYSTEM_PROMPT,
  friendlyOllamaError, ollamaError,
} from './personality.js';
import {
  MEMORY_KEY, describeMemoryFact, forgetFact, memoryPrompt, parseMemoryIntent,
  readMemoryStore, rememberFact, writeMemoryStore,
} from './memory.js';
import {
  TTS,
  TTS_TEST_TEXT,
  TTS_VOICE_KEY,
  WAKE_WORD,
  WAKE_UNSUPPORTED_MESSAGE,
  createVoiceListener,
  createWakeChime,
  defaultVoice,
  describeVoice,
  groupVoices,
  listVoices,
  resolveVoice,
  voiceKey,
  voiceOptionLabel,
} from './speech.js';

const OLLAMA_MODEL = 'mistral:7b-instruct-q4_K_M';

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

async function readChatCompletionStream(response) {
  if (!response.body) throw new Error(OLLAMA_REPLY_ERRORS.noStream);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  let readerDone = false;
  let streamDone = false;

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
    if (typeof delta === 'string') answer += delta;
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
  }

  if (!streamDone && buffer.trim()) consumeLine(buffer);
  if (streamDone && !readerDone) await reader.cancel().catch(() => {});
  const completeAnswer = answer.trim();
  if (!completeAnswer) throw new Error(OLLAMA_REPLY_ERRORS.emptyReply);
  return completeAnswer;
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
  onTestVoice = null, onStopVoiceTest = null, voiceTestPlaying = false, voiceTestDisabled = true, speechAvailable = false }) {
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
              <label className="field-label" htmlFor="ollama-url">Ollama endpoint <span>OPTIONAL</span></label>
              <input
                id="ollama-url"
                className="settings-input"
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
              <p className={`field-hint ${endpointWarning(draft.ollamaUrl) ? 'field-hint-error' : ''}`} aria-live="polite">
                {endpointWarning(draft.ollamaUrl)
                  || (standalone
                    ? "Keep the default if Ollama is running on this computer, or enter the address you’d like me to use."
                    : "Leave this blank when using the local Vite server. On a hosted page, use an Ollama address your browser can reach.")}
              </p>
              <ConnectionHelp />
            </div>

            <div className="settings-divider" />

            <div className="settings-field">
              <label className="field-label" htmlFor="nova-voice">{APP_NAME} Voice</label>
              <select
                id="nova-voice"
                className="settings-select"
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
              <div className="voice-preview">
                <button className="test-ollama-button test-voice-button" type="button" disabled={voiceTestDisabled || voiceTestPlaying} onClick={() => onTestVoice?.(draft.voiceKey)}>Test Voice</button>
                {voiceTestPlaying && <button className="text-button voice-test-stop" type="button" onClick={onStopVoiceTest}>Stop test</button>}
              </div>
              <p className="field-hint">
                {!speechAvailable ? "I can’t speak aloud in this browser. You can try Chrome or Edge instead."
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
    voiceKey: readSetting(TTS_VOICE_KEY),
    showTranscript: readSetting('nova.transcript.visible', 'false') === 'true',
  }));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memoryState, setMemoryState] = useState(readMemoryStore);
  const [lastResponse, setLastResponse] = useState('');
  const [notice, setNotice] = useState('');
  const [wakeStandby, setWakeStandby] = useState(false);
  const [wakeMessage, setWakeMessage] = useState('');
  // Brief wake and post-reply flourishes; busy stages always take visual priority.
  const [mood, setMood] = useState('idle');
  const voices = useSpeechVoices();
  const [speechVoiceName, setSpeechVoiceName] = useState('');
  const [voiceTestPlaying, setVoiceTestPlaying] = useState(false);
  const voiceTestRef = useRef(false);
  const speechAvailable = typeof window !== 'undefined' && typeof window.speechSynthesis?.speak === 'function'
    && typeof SpeechSynthesisUtterance === 'function';
  const preferredVoice = resolveVoice(voices, settings.voiceKey) || defaultVoice(voices);
  const activeVoiceName = speechVoiceName || (speechAvailable
    ? (preferredVoice ? preferredVoice.name || 'Unnamed voice' : 'Browser default')
    : "Voice isn’t available here");
  const moodTimerRef = useRef(null);
  const noticeTimerRef = useRef(null);
  const settingsTriggerRef = useRef(null);
  const voiceListenerRef = useRef(null);
  const wakeChimeRef = useRef(null);
  const speechFinishRef = useRef(null);
  const requestControllerRef = useRef(null);
  const promptRef = useRef(null);
  const speakRef = useRef(null);
  const avatarContainerRef = useRef(null);
  const conversationRef = useRef([]);
  const memoriesRef = useRef(memoryState.facts);

  const SpeechRecognition = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;

  const notify = useCallback((message) => {
    setNotice(message);
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), 4600);
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
  }, []);

  useEffect(() => {
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
  }, [settings.model, settings.ollamaUrl]);

  // Memory is independent of the settings draft. Persist first, then publish it;
  // never claim a fact was saved/deleted when localStorage rejected the write.
  const applyMemoryState = useCallback((next, interrupt = true, forceReset = false) => {
    const changed = JSON.stringify(next.facts) !== JSON.stringify(memoriesRef.current);
    memoriesRef.current = next.facts;
    setMemoryState(next);
    if (!changed && !forceReset) return;
    conversationRef.current = []; // Removed/replaced facts must not survive in chat history.
    if (interrupt) {
      requestControllerRef.current?.abort();
      speechFinishRef.current?.(false);
      window.speechSynthesis?.cancel();
      window.clearTimeout(moodTimerRef.current);
      setMood('idle');
      setLastResponse('');
      setStage('ready');
    }
  }, []);

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
    voiceListenerRef.current?.setMode(null);
    setStage('thinking');
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;

    const currentMemory = refreshMemories(false);
    const intent = parseMemoryIntent(prompt);

    try {
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
          else if (result.status === 'unchanged') answer = `I’ve got that in mind already: ${describeMemoryFact(intent.fact)}.`;
          else {
            const saved = commitMemories(result.facts, false);
            answer = saved.ok
              ? `Got it! ${result.status === 'updated' ? 'I’ll remember the update' : 'I’ll keep that in mind'}: ${describeMemoryFact(result.fact)}.`
              : saved.error;
          }
        } else if (intent.type === 'forget') {
          const result = forgetFact(currentMemory.facts, intent.query);
          if (result.status === 'error') answer = result.error;
          else if (result.status === 'missing') answer = `I couldn’t find a saved memory about “${result.query}”. We can take a look together in Settings.`;
          else if (result.status === 'ambiguous') answer = `I found a few memories about “${result.query}”. Which one would you like me to forget?`;
          else {
            const saved = commitMemories(result.facts, false);
            answer = saved.ok ? "All right, I’ve removed that from your saved memories." : saved.error;
          }
        }
      }
      if (!intent) {
        const conversation = conversationRef.current.slice(-6);
        const messages = [
          {
            role: 'system',
            content: `${SYSTEM_PROMPT}\n\n${memoryPrompt(currentMemory.facts)}`,
          },
          ...conversation,
          { role: 'user', content: prompt },
        ];
        const result = await fetch(`${ollamaEndpoint(settings)}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ model: settings.model || OLLAMA_MODEL, messages, stream: true }),
        });
        if (!result.ok) {
          const payload = await result.json().catch(() => ({}));
          throw ollamaError(payload.error?.message, result.status);
        }
        answer = await readChatCompletionStream(result);
        if (controller.signal.aborted) return;
        conversationRef.current = [
          ...conversation,
          { role: 'user', content: prompt },
          { role: 'assistant', content: answer },
        ].slice(-6);
      }
      if (controller.signal.aborted) return;
      setLastResponse(answer);
      await speakRef.current?.(answer);
      if (!controller.signal.aborted) celebrate();
    } catch (error) {
      if (controller.signal.aborted) return;
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
  }, [notify, settings, celebrate, refreshMemories, commitMemories]);

  // Resolve only when speech ends, not when it is queued. Otherwise standby
  // starts too early, hears NOVA's own answer, and "happy" masks speaking eyes.
  const speakAnswer = useCallback((text, selectedVoiceKey = settings.voiceKey, preview = false) => {
    if (typeof window.speechSynthesis?.speak !== 'function' || typeof SpeechSynthesisUtterance !== 'function') {
      setStage('ready');
      notify("I can’t speak aloud in this browser. Turn on Show last response in Settings to read my replies, or try Chrome or Edge.");
      return Promise.resolve();
    }

    voiceListenerRef.current?.setMode(null);
    speechFinishRef.current?.(false);
    window.speechSynthesis.cancel();
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      const avatarElement = avatarContainerRef.current;
      let speechPulseTimer;
      let finished = false;

      const voice = resolveVoice(voices, selectedVoiceKey) || defaultVoice(voices);
      if (voice) {
        utterance.voice = voice;
        if (voice.lang) utterance.lang = voice.lang;
      }
      utterance.rate = TTS.rate;
      utterance.pitch = TTS.pitch;
      utterance.volume = TTS.volume;

      const finishSpeech = (resume = true) => {
        if (finished) return;
        finished = true;
        window.clearTimeout(speechPulseTimer);
        avatarElement?.classList.remove('speech-boundary-active');
        avatarElement?.style.removeProperty('--audio-pulse');
        if (speechFinishRef.current === finishSpeech) {
          speechFinishRef.current = null;
          voiceTestRef.current = false;
          setVoiceTestPlaying(false);
          setSpeechVoiceName('');
        }
        if (resume) setStage('ready');
        resolve();
      };
      utterance.onstart = () => { if (!finished) setStage('speaking'); };
      // No word events: neutral eye light/scale, with the CSS speaking bounce intact.
      utterance.onboundary = (event) => {
        if (finished || (event.name && event.name !== 'word') || !avatarElement) return;
        avatarElement.classList.add('speech-boundary-active');
        const wordLength = Math.max(1, Math.min(event.charLength || 1, 10));
        avatarElement.style.setProperty('--audio-pulse', Math.min(1, 0.65 + wordLength * 0.035).toFixed(3));
        window.clearTimeout(speechPulseTimer);
        speechPulseTimer = window.setTimeout(() => {
          avatarElement.style.setProperty('--audio-pulse', '0');
        }, 125);
      };
      utterance.onend = () => finishSpeech();
      utterance.onerror = () => {
        if (finished) return;
        finishSpeech();
        if (preview) notify("I couldn’t play that voice just now. Check your connection, or try another voice.");
      };
      speechFinishRef.current = finishSpeech;
      // Publish only after configuration succeeds, and freeze the actual utterance's
      // name even if voiceschanged updates the automatic pick while it is queued.
      setSpeechVoiceName(voice ? voice.name || 'Unnamed voice' : 'Browser default');
      voiceTestRef.current = preview;
      setVoiceTestPlaying(preview);
      setStage('speaking'); // Also covers an engine's queue before onstart.
      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        finishSpeech();
        notify("I couldn’t start speaking just now. Try again, or choose another voice in Settings.");
      }
    });
  }, [notify, settings, voices]);

  // Both refs are refreshed on every render, so callbacks that outlive a render still
  // reach the current speaker and the current request handler.
  speakRef.current = speakAnswer;

  const testVoice = useCallback((key) => {
    if (!settingsOpen || stage === 'thinking' || stage === 'speaking' || requestControllerRef.current || speechFinishRef.current) return;
    window.clearTimeout(moodTimerRef.current);
    setMood('idle');
    void speakRef.current?.(TTS_TEST_TEXT, key, true)?.catch(() => {
      stopVoiceTest();
      setStage('ready');
      notify("I couldn’t start that voice preview. Try another voice in Settings.");
    });
  }, [notify, settingsOpen, stage, stopVoiceTest]);

  // Keep the recognizer's event handler pointed at the latest assistant request.
  promptRef.current = (text) => {
    askAria(text).then(() => {});
  };

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
      onUnsupported: () => setWakeMessage(WAKE_UNSUPPORTED_MESSAGE),
      onInputStart: () => {
        if (listener.wakeSupported) setWakeMessage('');
      },
      onWake: () => {
        window.clearTimeout(moodTimerRef.current);
        setMood('wake');
        moodTimerRef.current = window.setTimeout(() => setMood('idle'), 800);
        setNotice('');
        setStage('listening');
        void wakeChimeRef.current?.play();
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
      listener.dispose();
      voiceListenerRef.current = null;
    };
  }, [SpeechRecognition, notify]);

  // Standby is automatic on load / after a reply. Never listen to the speaker,
  // settings edits, or a hidden tab; resume when the main view is idle again.
  useEffect(() => {
    const updateMode = () => {
      const mode = settingsOpen || document.hidden || stage === 'thinking' || stage === 'speaking'
        ? null
        : stage === 'listening' ? 'question' : 'standby';
      voiceListenerRef.current?.setMode(mode);
    };
    updateMode();
    document.addEventListener('visibilitychange', updateMode);
    return () => document.removeEventListener('visibilitychange', updateMode);
  }, [settingsOpen, stage, SpeechRecognition]);

  useEffect(() => () => {
    requestControllerRef.current?.abort();
    speechFinishRef.current?.(false);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  const toggleListening = () => {
    if (stage === 'listening') {
      voiceListenerRef.current?.setMode(null);
      setStage('ready');
      return;
    }
    if (stage !== 'ready') return;
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
      if (target?.isContentEditable || target?.closest?.('button, input, textarea, select')) return;
      if (stage !== 'ready' && stage !== 'listening') return;
      event.preventDefault();
      if (!event.repeat) toggleListening();
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [settingsOpen, stage]);

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
      voiceKey: (nextSettings.voiceKey || '').trim(),
      showTranscript: Boolean(nextSettings.showTranscript),
    };
    try {
      window.localStorage.setItem('nova.ollama.model', updatedSettings.model);
      window.localStorage.setItem('nova.ollama.url', updatedSettings.ollamaUrl);
      window.localStorage.setItem(TTS_VOICE_KEY, updatedSettings.voiceKey);
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



  return (
    <div className={`app-shell stage-${stage}`}>
      <header className="topbar">
        <div className="brand-name">{APP_NAME}</div>
        <button ref={settingsTriggerRef} className="icon-button settings-trigger" type="button" aria-label="Open settings" aria-controls="nova-settings-panel" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(true)}>
          <SettingsIcon />
        </button>
      </header>

      <main className="main-stage">
        <section className="assistant-stage" aria-label={`${APP_NAME} voice assistant`}>
          <div
            ref={avatarContainerRef}
            className={`avatar-container ${avatarActivity} ${avatarMood}`}
          >
            <div className="avatar-backlight" />
            <div className="listen-ring" aria-hidden="true" />
            {/* Pose on the wrapper, per-state rhythm on the SVG: nested transforms compose. */}
            <div className="avatar-figure">
              <RobotAvatar />
            </div>
          </div>
          <p className="active-voice-label" title={activeVoiceName} aria-label={`Active voice: ${activeVoiceName}`} aria-live="polite" aria-atomic="true">{activeVoiceName}</p>
          {connection === 'offline' && (
            <div className="avatar-offline-display" role="status" aria-live="polite">
              <span>{OLLAMA_UNREACHABLE}</span>
              <span>Open Settings if you’d like a hand connecting.</span>
            </div>
          )}
          <h1 className="tagline">What’s on your mind?</h1>
          <p className={`status-word status-word-${stage}`} aria-live="polite" aria-atomic="true">{statusText}</p>
          {settings.showTranscript && lastResponse && (
            <div className="response-transcript" role="region" aria-label="My last reply" aria-live="polite">
              <span>My last reply</span>
              <p>{lastResponse}</p>
            </div>
          )}
        </section>
      </main>

      <footer className="control-dock">
        {wakeStandby && stage === 'ready' && !settingsOpen && (
          <div className="wake-indicator" role="status" aria-label={`I’m listening for “${WAKE_WORD}”`} title={`Say “${WAKE_WORD}” whenever you’re ready`}>
            <MicIcon />
          </div>
        )}
        {wakeMessage && <p className="wake-message" role="status" aria-live="polite">{wakeMessage}</p>}
        <div className="mic-control-wrap">
          <div className={`mic-halo ${stage === 'listening' ? 'mic-halo-active' : ''}`} />
          <button
            className={`mic-button ${stage === 'listening' ? 'mic-button-active' : ''}`}
            type="button"
            onClick={toggleListening}
            disabled={stage === 'thinking' || stage === 'speaking'}
            aria-label={stage === 'listening' ? 'Stop listening' : 'Start listening'}
            aria-keyshortcuts="Space"
          >
            <MicIcon stopped={stage === 'listening'} />
            <span className="mic-button-sheen" />
          </button>
        </div>
      </footer>

      {notice && <div className="toast" role="status"><span className="toast-mark">!</span><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          voices={voices}
          speechAvailable={speechAvailable}
          voiceTestPlaying={voiceTestPlaying}
          voiceTestDisabled={!speechAvailable || stage === 'thinking' || stage === 'speaking'}
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
