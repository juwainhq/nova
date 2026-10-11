import { useCallback, useEffect, useRef, useState } from 'react';
import RobotAvatar from './RobotAvatar.jsx';
import { APP_NAME } from './brand.js';
import {
  TTS,
  TTS_VOICE_KEY,
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
    return 'Enter a full URL starting with http:// or https://';
  }
  return '';
}

// A hint that tells the operator exactly how to let this page reach Ollama.
function ConnectionHelp() {
  const originsCommand = ollamaOriginsCommand();
  return (
    <details className="field-help">
      <summary>Can’t connect? Enable CORS on your Ollama server</summary>
      <div className="field-help-body">
        <p>
          Ollama only accepts browser requests from a fixed list of origins, so it rejects
          this page until you allow it. Plain <code>http</code> is not the obstacle: browsers
          treat <code>http://localhost</code> as a secure origin, so this page may call it
          directly. A <code>file://</code> copy sends <code>Origin: null</code> instead, which
          no default entry matches — use the setting below for that.
        </p>
        <ol>
          <li>
            <span>Restart Ollama allowing this page’s origin.</span>
            <code className="field-help-command">{originsCommand}</code>
          </li>
          <li>
            <span>
              {STANDALONE_BUILD
                ? 'A single-file copy cannot know its own origin, so it needs the wildcard above.'
                : `Narrower than the wildcard: the exact value for this page is ${originsCommand.split('=')[1]?.split(' ollama')[0] || 'this page’s origin'}.`}
            </span>
          </li>
          <li>
            <span>Or, if you cannot restart it, install a CORS-unblocking browser extension.</span>
          </li>
        </ol>
        <p className="field-help-note">
          Recent Chrome additionally asks for permission before a public site may reach your
          local network — allow it when prompted. Hosting Ollama behind HTTPS (a reverse proxy
          or a tunnel such as ngrok or a Cloudflare tunnel) also works and needs no CORS
          opening, but exposes your machine to anyone holding the URL.
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
  if (!response.body) throw new Error('Ollama did not return a response stream.');

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
      throw new Error('Ollama returned an invalid streaming response.');
    }
    if (chunk.error) throw new Error(chunk.error.message || 'Ollama returned a streaming error.');
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
  if (!completeAnswer) throw new Error('Ollama returned an empty response.');
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
    throw new Error(payload.error?.message || `Ollama returned ${response.status}.`);
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
export function SettingsPanel({ settings, voices, connection, modelAvailable, standalone, onClose, onSave, onConnectionChange, openerRef }) {
  const [draft, setDraft] = useState(settings);
  const [testStatus, setTestStatus] = useState('idle');
  const [testMessage, setTestMessage] = useState('');
  const [downloadStatus, setDownloadStatus] = useState('idle');
  const [downloadMessage, setDownloadMessage] = useState('');
  const modelInputRef = useRef(null);
  const panelRef = useRef(null);
  const testControllerRef = useRef(null);

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
      openerRef.current?.focus();
    };
  }, [onClose, openerRef]);

  const handleSubmit = (event) => {
    event.preventDefault();
    onSave(draft);
  };

  const testOllama = async () => {
    testControllerRef.current?.abort();
    const controller = new AbortController();
    testControllerRef.current = controller;
    setTestStatus('checking');
    setTestMessage('Checking the configured Ollama endpoint…');
    try {
      const models = await fetchOllamaModels(ollamaEndpoint(draft), controller.signal);
      const requestedModel = draft.model.trim() || OLLAMA_MODEL;
      const installed = hasOllamaModel(models, requestedModel);
      const savedModel = settings.model.trim() || OLLAMA_MODEL;
      onConnectionChange('connected', hasOllamaModel(models, savedModel));
      setTestStatus(installed ? 'success' : 'warning');
      setTestMessage(installed
        ? 'Ollama is responding and the selected model is available.'
        : `Ollama is responding, but “${requestedModel}” is not installed.`);
    } catch (error) {
      if (error.name === 'AbortError') return;
      onConnectionChange('offline', false);
      setTestStatus('error');
      setTestMessage(error.message || 'Could not reach Ollama.');
    }
  };

  // Fetch the standalone build and download it byte-for-byte. A dev server that
  // rewrites HTML (Vite HMR injection) would corrupt the file, so the response is
  // verified against the parsed document before it is offered as a download.
  const downloadStandalone = async () => {
    setDownloadStatus('working');
    setDownloadMessage('Preparing the standalone file…');
    try {
      const response = await fetch(STANDALONE_PAGE, { cache: 'no-store' });
      if (!response.ok) throw new Error(`The standalone file returned ${response.status}.`);
      const markup = await response.text();
      const parsed = new DOMParser().parseFromString(markup, 'text/html');
      if (parsed.querySelectorAll('script').length !== 1) {
        throw new Error('This is not the standalone build. Serve the repository, or download it from the GitHub Pages site.');
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
      setDownloadMessage(`Saved ${STANDALONE_FILENAME}. Open it in Chrome, then allow the local network prompt.`);
    } catch (error) {
      setDownloadStatus('error');
      setDownloadMessage(error.message || 'The standalone file could not be downloaded.');
    }
  };

  const { english: englishVoices, others: otherVoices } = groupVoices(voices);
  // Until the user picks one, the dropdown reflects the voice the app would choose.
  const autoVoice = defaultVoice(voices);
  const selectedKey = resolveVoice(voices, draft.voiceKey) ? draft.voiceKey : voiceKey(autoVoice);
  const selectedVoice = resolveVoice(voices, selectedKey) || autoVoice;
  // A saved voice can vanish if the user uninstalls it; say so rather than silently
  // switching under them.
  const voiceCount = voices.length;
  const savedVoiceMissing = Boolean(draft.voiceKey) && voiceCount > 0 && !resolveVoice(voices, draft.voiceKey);
  const draftModel = draft.model.trim() || OLLAMA_MODEL;
  const connectionLabel = connection === 'checking'
    ? 'Checking connection…'
    : connection === 'offline'
      ? 'Ollama is offline'
      : modelAvailable === false && draftModel === settings.model
        ? 'Ollama is online · model not found'
        : 'Ollama is online';

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
              <p className="field-hint">Used for local responses. Default: {OLLAMA_MODEL}</p>
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
                    ? 'This standalone copy is opened from a file on your disk, so it calls Ollama directly. Keep the default unless Ollama listens elsewhere.'
                    : 'Leave blank to use the local Vite proxy. On a hosted page, point this at a backend the browser can reach.')}
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
                onChange={(event) => setDraft((current) => ({ ...current, voiceKey: event.target.value }))}
              >
                {!voiceCount && <option value="">No voices available in this browser</option>}
                {englishVoices.length > 0 && (
                  <optgroup label="English">
                    {englishVoices.map((voice) => (
                      <option key={voiceKey(voice)} value={voiceKey(voice)}>{voiceOptionLabel(voice)}</option>
                    ))}
                  </optgroup>
                )}
                {otherVoices.length > 0 && (
                  <optgroup label="Other languages">
                    {otherVoices.map((voice) => (
                      <option key={voiceKey(voice)} value={voiceKey(voice)}>{voiceOptionLabel(voice)}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <p className="field-hint" aria-live="polite">
                {voiceCount
                  ? `${voiceCount} voice${voiceCount === 1 ? '' : 's'} from this ${standalone ? 'device' : 'browser'}, best first. “offline” voices need no connection.`
                  : 'This browser exposes no speech voices yet. Reopen the panel if the list is still loading.'}
              </p>
              <p className={`field-hint ${savedVoiceMissing ? 'field-hint-error' : ''}`}>
                {savedVoiceMissing && selectedVoice
                  ? `Your saved voice is no longer installed. Falling back to ${describeVoice(selectedVoice)}.`
                  : selectedVoice
                    ? `Speaking with ${describeVoice(selectedVoice)} at rate ${TTS.rate}, pitch ${TTS.pitch}, volume ${TTS.volume}.`
                    : 'Speech runs in your browser — no API key and no network needed.'}
              </p>
            </div>

            <div className="settings-divider" />

            <label className="settings-toggle-row" htmlFor="show-transcript">
              <span className="settings-toggle-copy">
                <span className="config-title">Show last response</span>
                <span className="config-detail">Display a transcript below {APP_NAME}</span>
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

            <div className="settings-test">
              <div className="settings-test-heading">
                <div>
                  <span className="config-title">Ollama connection</span>
                  <span className="config-detail">{connectionLabel}</span>
                </div>
                <button className="test-ollama-button" type="button" onClick={testOllama} disabled={testStatus === 'checking'}>
                  {testStatus === 'checking' ? 'Testing…' : 'Test Ollama'}
                </button>
              </div>
              <p className={`test-result test-result-${testStatus}`} role="status" aria-live="polite">
                <i />
                {testMessage || 'Ping the local endpoint and check the selected model.'}
              </p>
            </div>

            <div className="settings-divider" />

            <div className="settings-field">
              <span className="field-label">Offline copy <span>OPTIONAL</span></span>
              {standalone ? (
                <p className="field-hint">
                  You are already running the standalone file, so it works straight from your disk.
                  Ollama still has to accept this file’s origin — expand the CORS help above.
                </p>
              ) : (
                <>
                  <button
                    className="standalone-button"
                    type="button"
                    onClick={downloadStandalone}
                    disabled={downloadStatus === 'working'}
                  >
                    {downloadStatus === 'working' ? 'Preparing…' : `Download ${STANDALONE_FILENAME}`}
                  </button>
                  <p className={`field-hint ${downloadStatus === 'error' ? 'field-hint-error' : ''}`} role="status" aria-live="polite">
                    {downloadMessage
                      || 'One self-contained HTML file with no build step. Open it in Chrome and it calls Ollama directly.'}
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
  const [lastResponse, setLastResponse] = useState('');
  const [notice, setNotice] = useState('');
  // A brief celebratory flourish after a reply lands, then back to idle.
  const [mood, setMood] = useState('idle');
  const voices = useSpeechVoices();
  const moodTimerRef = useRef(null);
  const noticeTimerRef = useRef(null);
  const settingsTriggerRef = useRef(null);
  const recognitionRef = useRef(null);
  const shouldListenRef = useRef(false);
  const promptRef = useRef(null);
  const speakRef = useRef(null);
  const avatarContainerRef = useRef(null);
  const conversationRef = useRef([]);

  const SpeechRecognition = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;

  const notify = useCallback((message) => {
    setNotice(message);
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), 4600);
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

  const askAria = useCallback(async (text) => {
    const prompt = text.trim();
    if (!prompt) return;
    setStage('thinking');

    const conversation = conversationRef.current.slice(-6);
    const messages = [
      {
        role: 'system',
        content: `You are ${APP_NAME}, a warm and witty local AI assistant. You run 100% locally on the user's machine. Keep responses under 3 sentences. Be helpful, kind, and efficient.`,
      },
      ...conversation,
      { role: 'user', content: prompt },
    ];

    try {
      const result = await fetch(`${ollamaEndpoint(settings)}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: settings.model || OLLAMA_MODEL, messages, stream: true }),
      });
      if (!result.ok) {
        const payload = await result.json().catch(() => ({}));
        throw new Error(payload.error?.message || `Ollama returned ${result.status}.`);
      }

      const answer = await readChatCompletionStream(result);
      setLastResponse(answer);
      conversationRef.current = [
        ...conversation,
        { role: 'user', content: prompt },
        { role: 'assistant', content: answer },
      ].slice(-6);
      await speakRef.current?.(answer);
      celebrate();
    } catch (error) {
      try {
        const models = await fetchOllamaModels(ollamaEndpoint(settings));
        setConnection('connected');
        setModelAvailable(hasOllamaModel(models, settings.model || OLLAMA_MODEL));
      } catch {
        setConnection('offline');
        setModelAvailable(false);
      }
      setStage('ready');
      const detail = error.message === 'Failed to fetch'
        ? `I could not reach Ollama at ${(settings.ollamaUrl || '').trim() || 'localhost:11434'}. Check that it is running and that its CORS settings accept this page — open Settings for the exact command.`
        : `I couldn't get a response from Ollama. ${error.message}`;
      notify(detail);
    }
  }, [notify, settings, celebrate]);

  // Voice output is the browser's own speech synthesis: no key, no network.
  const speakAnswer = useCallback(async (text) => {
    const finish = () => setStage('ready');

    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      finish();
      notify('This browser has no speech synthesis, so replies will stay silent.');
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const avatarElement = avatarContainerRef.current;
    let speechPulseTimer;

    // Fall back to the best voice on the machine until the user chooses one.
    const voice = resolveVoice(voices, settings.voiceKey) || defaultVoice(voices);
    if (voice) {
      utterance.voice = voice;
      if (voice.lang) utterance.lang = voice.lang;
    }
    utterance.rate = TTS.rate;
    utterance.pitch = TTS.pitch;
    utterance.volume = TTS.volume;

    const finishSpeech = () => {
      window.clearTimeout(speechPulseTimer);
      avatarElement?.classList.remove('speech-boundary-active');
      avatarElement?.style.removeProperty('--audio-pulse');
      finish();
    };

    utterance.onstart = () => setStage('speaking');
    // Word boundaries are the only live signal a local voice gives us, so the eyes
    // and body pulse off them. Engines that never fire it simply stay steady.
    utterance.onboundary = (event) => {
      if (event.name && event.name !== 'word') return;
      if (!avatarElement) return;
      avatarElement.classList.add('speech-boundary-active');
      const wordLength = Math.max(1, Math.min(event.charLength || 1, 10));
      avatarElement.style.setProperty('--audio-pulse', (0.58 + wordLength * 0.035).toFixed(3));
      window.clearTimeout(speechPulseTimer);
      speechPulseTimer = window.setTimeout(() => {
        avatarElement.style.setProperty('--audio-pulse', '.16');
      }, 125);
    };
    utterance.onend = finishSpeech;
    utterance.onerror = finishSpeech;

    window.speechSynthesis.speak(utterance);
  }, [notify, settings, voices]);

  // Both refs are refreshed on every render, so callbacks that outlive a render still
  // reach the current speaker and the current request handler.
  speakRef.current = speakAnswer;

  // Keep the recognizer's event handler pointed at the latest assistant request.
  promptRef.current = (text) => {
    askAria(text).then(() => {});
  };

  useEffect(() => {
    if (!SpeechRecognition) return undefined;
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      let finalText = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        if (event.results[index].isFinal) finalText += event.results[index][0]?.transcript || '';
      }
      if (finalText.trim()) {
        shouldListenRef.current = false;
        recognition.stop();
        promptRef.current?.(finalText.trim());
      }
    };
    recognition.onerror = (event) => {
      shouldListenRef.current = false;
      if (event.error !== 'aborted') {
        setStage('ready');
        const reason = event.error === 'not-allowed'
          ? 'Microphone access is blocked. Allow it in your browser settings and try again.'
          : event.error === 'no-speech'
            ? 'I did not hear anything. Tap the microphone and try again.'
            : `Speech recognition stopped: ${event.error}.`;
        notify(reason);
      }
    };
    recognition.onend = () => {
      if (shouldListenRef.current) {
        shouldListenRef.current = false;
        setStage('ready');
      }
    };
    recognitionRef.current = recognition;
    return () => {
      shouldListenRef.current = false;
      try {
        recognition.stop();
      } catch {
        // It may already be idle when the component unmounts.
      }
      recognitionRef.current = null;
    };
  }, [SpeechRecognition, notify]);

  useEffect(() => () => {
    window.clearTimeout(noticeTimerRef.current);
    window.clearTimeout(moodTimerRef.current);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  const toggleListening = () => {
    if (stage === 'listening') {
      shouldListenRef.current = false;
      recognitionRef.current?.stop();
      setStage('ready');
      return;
    }
    if (stage !== 'ready') return;
    if (!recognitionRef.current) {
      notify('Speech recognition is not supported in this browser. Try a recent version of Chrome or Edge.');
      return;
    }
    window.speechSynthesis?.cancel();
    setNotice('');
    shouldListenRef.current = true;
    try {
      recognitionRef.current.start();
      setStage('listening');
    } catch {
      shouldListenRef.current = false;
      notify('The microphone could not start. Please try again.');
    }
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

  const statusText = {
    ready: `${APP_NAME} READY`,
    listening: `${APP_NAME} LISTENING`,
    thinking: `${APP_NAME} THINKING`,
    speaking: `${APP_NAME} SPEAKING`,
  }[stage];

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
      notify('Settings could not be saved in this browser.');
      return;
    }
    setSettings(updatedSettings);
    setSettingsOpen(false);
    notify('Settings saved.');
  };

  const closeSettings = useCallback(() => setSettingsOpen(false), []);
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
            className={`avatar-container ${stage === 'listening' ? 'is-listening' : ''} ${stage === 'speaking' ? 'is-speaking' : ''} ${stage === 'thinking' ? 'is-thinking' : ''} ${mood === 'happy' && connection !== 'offline' ? 'is-happy' : ''} ${connection === 'offline' ? 'is-offline' : ''}`}
          >
            <div className="avatar-backlight" />
            <div className="listen-ring" aria-hidden="true" />
            {/* Pose on the wrapper, per-state rhythm on the SVG: nested transforms compose. */}
            <div className="avatar-figure">
              <RobotAvatar />
            </div>
          </div>
          {connection === 'offline' && (
            <div className="avatar-offline-display" role="status" aria-live="polite">
              <span>{APP_NAME} OFFLINE —</span>
              <span>{(settings.ollamaUrl || '').trim() ? 'Check your Ollama endpoint' : 'Start Ollama to connect'}</span>
            </div>
          )}
          <h1 className="tagline">Your voice, your world.</h1>
          <p className={`status-word status-word-${stage}`} aria-live="polite" aria-atomic="true">{statusText}</p>
          {settings.showTranscript && lastResponse && (
            <div className="response-transcript" role="region" aria-label="Last response transcript" aria-live="polite">
              <span>LAST RESPONSE</span>
              <p>{lastResponse}</p>
            </div>
          )}
        </section>
      </main>

      <footer className="control-dock">
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
