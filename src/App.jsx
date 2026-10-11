import { useCallback, useEffect, useRef, useState } from 'react';

const OLLAMA_MODEL = 'mistral:7b-instruct-q4_K_M';
const DEFAULT_ELEVENLABS_VOICE = '21m00Tcm4TlvDq8ikWAM';

function readSetting(key, fallback = '') {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
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

function RobotAvatar() {
  return (
    <svg className="robot-avatar" viewBox="0 0 280 280" fill="none" role="img" aria-label="ARIA, a softly glowing white orb">
      <defs>
        <radialGradient id="orbSurface" cx="0" cy="0" r="1" gradientTransform="matrix(145 164 -153 135 93 76)" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFDF9" />
          <stop offset=".48" stopColor="#FFF8EF" />
          <stop offset=".8" stopColor="#F2E5D5" />
          <stop offset="1" stopColor="#D8C4AE" />
        </radialGradient>
        <radialGradient id="orbHighlight" cx="0" cy="0" r="1" gradientTransform="matrix(48 54 -49 44 91 72)" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" stopOpacity=".9" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <filter id="orbBloom" x="-45%" y="-45%" width="190%" height="190%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="15" />
        </filter>
        <filter id="orbShadow" x="-35%" y="-25%" width="170%" height="180%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="11" stdDeviation="10" floodColor="#000000" floodOpacity=".28" />
        </filter>
        <filter id="mouthBloom" x="-70%" y="-180%" width="240%" height="460%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      <circle className="orb-bloom" cx="140" cy="140" r="106" fill="#FFF0DB" filter="url(#orbBloom)" />
      <path className="blob-shape" d="M141 29C202 29 251 77 251 139C251 199 207 247 146 251C83 254 31 208 29 146C27 84 74 32 134 29C136 29 139 29 141 29Z" fill="url(#orbSurface)" stroke="#FFFDFC" strokeOpacity=".88" strokeWidth="2" filter="url(#orbShadow)" />
      <ellipse cx="116" cy="83" rx="52" ry="39" fill="url(#orbHighlight)" opacity=".72" />
      <path d="M63 171C73 215 108 237 146 237" stroke="#C6AD92" strokeOpacity=".22" strokeWidth="2" strokeLinecap="round" />
      <path d="M217 76C237 95 246 119 246 144" stroke="#FFFFFF" strokeOpacity=".58" strokeWidth="2" strokeLinecap="round" />

      <g className="robot-eye robot-eye-left">
        <ellipse cx="105" cy="129" rx="5.2" ry="7.2" fill="#5C4636" />
        <ellipse cx="103.4" cy="126.8" rx="1.5" ry="1.8" fill="#FFFDF8" opacity=".9" />
      </g>
      <g className="robot-eye robot-eye-right">
        <ellipse cx="175" cy="129" rx="5.2" ry="7.2" fill="#5C4636" />
        <ellipse cx="173.4" cy="126.8" rx="1.5" ry="1.8" fill="#FFFDF8" opacity=".9" />
      </g>
      <path className="mouth-glow" d="M108 160Q140 186 172 160" stroke="#FF9A56" strokeWidth="14" strokeLinecap="round" filter="url(#mouthBloom)" />
      <path className="orb-smile mouth-light" d="M111 160Q140 182 169 160" stroke="#7D5B40" strokeOpacity=".76" strokeWidth="3.4" strokeLinecap="round" />
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

async function attachAvatarAudioMeter(audio, avatarElement) {
  const AudioContextType = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextType || !avatarElement) return () => {};

  let context;
  let frame = 0;
  let active = true;
  try {
    context = new AudioContextType();
    if (context.state === 'suspended') await context.resume();
    const source = context.createMediaElementSource(audio);
    const analyser = context.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.78;
    source.connect(analyser);
    analyser.connect(context.destination);

    const frequencies = new Uint8Array(analyser.frequencyBinCount);
    avatarElement.classList.add('audio-meter-active');
    const update = () => {
      if (!active) return;
      analyser.getByteFrequencyData(frequencies);
      const highIndex = Math.min(42, frequencies.length);
      let total = 0;
      for (let index = 2; index < highIndex; index += 1) total += frequencies[index];
      const average = total / Math.max(1, highIndex - 2);
      const level = Math.max(0, Math.min(1, (average - 5) / 58));
      avatarElement.style.setProperty('--audio-pulse', (0.12 + level * 0.88).toFixed(3));
      avatarElement.style.setProperty('--mouth-scale', (0.78 + level * 0.58).toFixed(3));
      frame = window.requestAnimationFrame(update);
    };
    update();

    return () => {
      if (!active) return;
      active = false;
      window.cancelAnimationFrame(frame);
      avatarElement.classList.remove('audio-meter-active');
      avatarElement.style.removeProperty('--audio-pulse');
      avatarElement.style.removeProperty('--mouth-scale');
      context?.close().catch(() => {});
    };
  } catch {
    active = false;
    avatarElement.classList.remove('audio-meter-active');
    avatarElement.style.removeProperty('--audio-pulse');
    avatarElement.style.removeProperty('--mouth-scale');
    context?.close().catch(() => {});
    return () => {};
  }
}

async function fetchOllamaModels(signal) {
  const response = await fetch('/api/ollama/models', { signal });
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

function SettingsPanel({ settings, connection, modelAvailable, onClose, onSave, onConnectionChange, openerRef }) {
  const [draft, setDraft] = useState(settings);
  const [voiceOptions, setVoiceOptions] = useState([]);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [voiceRefresh, setVoiceRefresh] = useState(0);
  const [testStatus, setTestStatus] = useState('idle');
  const [testMessage, setTestMessage] = useState('');
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

  useEffect(() => {
    const apiKey = draft.apiKey.trim();
    const controller = new AbortController();
    setVoiceOptions([]);
    setVoiceError('');

    if (!apiKey) {
      setVoiceLoading(false);
      return () => controller.abort();
    }

    setVoiceLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/elevenlabs/v1/voices', {
          headers: { 'xi-api-key': apiKey },
          signal: controller.signal,
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.detail?.message || payload.detail?.status || `ElevenLabs returned ${response.status}.`);
        }
        const payload = await response.json();
        const voices = Array.isArray(payload.voices)
          ? payload.voices.filter((voice) => voice?.voice_id && voice?.name)
          : [];
        setVoiceOptions(voices);
        if (!voices.length) setVoiceError('No voices were returned for this API key.');
      } catch (error) {
        if (error.name !== 'AbortError') setVoiceError(error.message || 'Could not load ElevenLabs voices.');
      } finally {
        if (!controller.signal.aborted) setVoiceLoading(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [draft.apiKey, voiceRefresh]);

  const handleSubmit = (event) => {
    event.preventDefault();
    onSave(draft);
  };

  const testOllama = async () => {
    testControllerRef.current?.abort();
    const controller = new AbortController();
    testControllerRef.current = controller;
    setTestStatus('checking');
    setTestMessage('Checking the local Ollama endpoint…');
    try {
      const models = await fetchOllamaModels(controller.signal);
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

  const voiceIsListed = voiceOptions.some((voice) => voice.voice_id === draft.voiceId);
  const fallbackVoiceLabel = !draft.apiKey.trim()
    ? (draft.voiceId === DEFAULT_ELEVENLABS_VOICE ? 'Default voice · add a key to browse' : 'Saved voice · add a key to browse')
    : voiceLoading ? 'Loading saved voice…' : 'Current selection';
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
      <section ref={panelRef} id="aria-settings-panel" className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="settings-panel-header">
          <div>
            <p className="settings-eyebrow">ARIA / PREFERENCES</p>
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

            <div className="settings-divider" />

            <div className="settings-field">
              <label className="field-label" htmlFor="eleven-key">ElevenLabs API key <span>OPTIONAL</span></label>
              <input
                id="eleven-key"
                className="settings-input"
                type="password"
                autoComplete="off"
                placeholder="Paste your API key"
                value={draft.apiKey}
                onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))}
              />
              <p className="field-hint">Saved only in this browser. Leave blank to use device speech.</p>
            </div>

            <div className="settings-field">
              <div className="field-label-row">
                <label className="field-label" htmlFor="voice-id">ElevenLabs voice</label>
                <button
                  className="settings-inline-button"
                  type="button"
                  disabled={!draft.apiKey.trim() || voiceLoading}
                  onClick={() => setVoiceRefresh((current) => current + 1)}
                >
                  {voiceLoading ? 'Loading…' : 'Refresh'}
                </button>
              </div>
              <select
                id="voice-id"
                className="settings-select"
                value={draft.voiceId}
                onChange={(event) => setDraft((current) => ({ ...current, voiceId: event.target.value }))}
              >
                {draft.voiceId && !voiceIsListed && <option value={draft.voiceId}>{fallbackVoiceLabel}</option>}
                {!draft.voiceId && <option value="">Use default voice</option>}
                {voiceOptions.map((voice) => (
                  <option key={voice.voice_id} value={voice.voice_id}>{voice.name}</option>
                ))}
              </select>
              <p className={`field-hint ${voiceError ? 'field-hint-error' : ''}`} aria-live="polite">
                {voiceError || (voiceLoading ? 'Loading voices from ElevenLabs…' : voiceOptions.length ? `${voiceOptions.length} voices available.` : 'Add an API key to browse your voices.')}
              </p>
            </div>

            <div className="settings-divider" />

            <label className="settings-toggle-row" htmlFor="show-transcript">
              <span className="settings-toggle-copy">
                <span className="config-title">Show last response</span>
                <span className="config-detail">Display a transcript below ARIA</span>
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
                  <span className="config-title">Local Ollama</span>
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
    model: readSetting('aria.ollama.model', OLLAMA_MODEL) || OLLAMA_MODEL,
    apiKey: readSetting('aria.elevenlabs.apiKey'),
    voiceId: readSetting('aria.elevenlabs.voiceId', DEFAULT_ELEVENLABS_VOICE),
    showTranscript: readSetting('aria.transcript.visible', 'false') === 'true',
  }));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lastResponse, setLastResponse] = useState('');
  const [notice, setNotice] = useState('');
  const noticeTimerRef = useRef(null);
  const settingsTriggerRef = useRef(null);
  const recognitionRef = useRef(null);
  const shouldListenRef = useRef(false);
  const promptRef = useRef(null);
  const audioRef = useRef(null);
  const avatarContainerRef = useRef(null);
  const audioMeterCleanupRef = useRef(() => {});
  const conversationRef = useRef([]);

  const SpeechRecognition = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;

  const notify = useCallback((message) => {
    setNotice(message);
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), 4600);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setConnection('checking');
    setModelAvailable(null);
    const checkOllama = async () => {
      try {
        const models = await fetchOllamaModels(controller.signal);
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
  }, [settings.model]);

  const askAria = useCallback(async (text) => {
    const prompt = text.trim();
    if (!prompt) return;
    setStage('thinking');

    const conversation = conversationRef.current.slice(-6);
    const messages = [
      {
        role: 'system',
        content: "You are ARIA, a sharp and witty local AI assistant with a robotic personality. You run 100% locally on the user's machine. Keep responses under 3 sentences. Be helpful, slightly sarcastic, and efficient.",
      },
      ...conversation,
      { role: 'user', content: prompt },
    ];

    try {
      const result = await fetch('/api/ollama/chat/completions', {
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
      await speakAnswer(answer);
    } catch (error) {
      try {
        const models = await fetchOllamaModels();
        setConnection('connected');
        setModelAvailable(hasOllamaModel(models, settings.model || OLLAMA_MODEL));
      } catch {
        setConnection('offline');
        setModelAvailable(false);
      }
      setStage('ready');
      const detail = error.message === 'Failed to fetch'
        ? 'I could not reach Ollama. Check that it is running at localhost:11434 and the model is installed.'
        : `I couldn't get a response from Ollama. ${error.message}`;
      notify(detail);
    }
  // speakAnswer is assigned immediately below and kept current through promptRef.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify, settings]);

  const speakAnswer = useCallback(async (text) => {
    const finish = () => setStage('ready');

    if (settings.apiKey) {
      let objectUrl;
      let stopAudioMeter = () => {};
      try {
        const voiceId = settings.voiceId.trim() || DEFAULT_ELEVENLABS_VOICE;
        const result = await fetch(`/api/elevenlabs/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': settings.apiKey,
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_turbo_v2_5',
            voice_settings: { stability: 0.42, similarity_boost: 0.78, style: 0.18, use_speaker_boost: true },
          }),
        });
        if (!result.ok) {
          const body = await result.json().catch(() => ({}));
          throw new Error(body.detail?.message || body.detail?.status || `ElevenLabs returned ${result.status}.`);
        }
        objectUrl = URL.createObjectURL(await result.blob());
        const audio = new Audio(objectUrl);
        audioRef.current = audio;
        stopAudioMeter = await attachAvatarAudioMeter(audio, avatarContainerRef.current);
        audioMeterCleanupRef.current = stopAudioMeter;
        await new Promise((resolve, reject) => {
          audio.onended = resolve;
          audio.onerror = () => reject(new Error('Audio playback failed.'));
          const playback = audio.play();
          if (playback?.then) {
            playback.then(() => setStage('speaking')).catch(reject);
          } else {
            setStage('speaking');
          }
        });
        stopAudioMeter();
        audioMeterCleanupRef.current = () => {};
        URL.revokeObjectURL(objectUrl);
        finish();
        return;
      } catch (error) {
        stopAudioMeter();
        audioMeterCleanupRef.current = () => {};
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        notify(`ElevenLabs unavailable — using your device voice instead. ${error.message}`);
      }
    }

    if ('speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined') {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const avatarElement = avatarContainerRef.current;
      let speechPulseTimer;
      const finishSpeech = () => {
        window.clearTimeout(speechPulseTimer);
        avatarElement?.classList.remove('speech-boundary-active');
        avatarElement?.style.removeProperty('--audio-pulse');
        avatarElement?.style.removeProperty('--mouth-scale');
        finish();
      };
      utterance.rate = 0.97;
      utterance.pitch = 1.02;
      utterance.onstart = () => setStage('speaking');
      utterance.onboundary = (event) => {
        if (event.name && event.name !== 'word') return;
        if (!avatarElement) return;
        avatarElement.classList.add('speech-boundary-active');
        const wordLength = Math.max(1, Math.min(event.charLength || 1, 10));
        avatarElement.style.setProperty('--audio-pulse', (0.58 + wordLength * 0.035).toFixed(3));
        avatarElement.style.setProperty('--mouth-scale', (0.88 + wordLength * 0.045).toFixed(3));
        window.clearTimeout(speechPulseTimer);
        speechPulseTimer = window.setTimeout(() => {
          avatarElement.style.setProperty('--audio-pulse', '.16');
          avatarElement.style.setProperty('--mouth-scale', '.78');
        }, 125);
      };
      utterance.onend = finishSpeech;
      utterance.onerror = finishSpeech;
      window.speechSynthesis.speak(utterance);
    } else {
      finish();
      notify('Text-to-speech is not available in this browser.');
    }
  }, [notify, settings]);

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
    audioMeterCleanupRef.current();
    if (audioRef.current) audioRef.current.pause();
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
    ready: 'READY',
    listening: 'LISTENING',
    thinking: 'THINKING',
    speaking: 'SPEAKING',
  }[stage];

  const saveSettings = (nextSettings) => {
    const updatedSettings = {
      model: nextSettings.model.trim() || OLLAMA_MODEL,
      apiKey: nextSettings.apiKey.trim(),
      voiceId: nextSettings.voiceId.trim() || DEFAULT_ELEVENLABS_VOICE,
      showTranscript: Boolean(nextSettings.showTranscript),
    };
    try {
      window.localStorage.setItem('aria.ollama.model', updatedSettings.model);
      window.localStorage.setItem('aria.elevenlabs.apiKey', updatedSettings.apiKey);
      window.localStorage.setItem('aria.elevenlabs.voiceId', updatedSettings.voiceId);
      window.localStorage.setItem('aria.transcript.visible', String(updatedSettings.showTranscript));
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
        <div className="brand-name">ARIA</div>
        <button ref={settingsTriggerRef} className="icon-button settings-trigger" type="button" aria-label="Open settings" aria-controls="aria-settings-panel" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(true)}>
          <SettingsIcon />
        </button>
      </header>

      <main className="main-stage">
        <section className="assistant-stage" aria-label="ARIA voice assistant">
          <div ref={avatarContainerRef} className={`avatar-container ${stage === 'listening' ? 'is-listening' : ''} ${stage === 'speaking' ? 'is-speaking' : ''} ${stage === 'thinking' ? 'is-thinking' : ''}`}>
            <div className="avatar-backlight" />
            <div className="listen-ring" aria-hidden="true" />
            <RobotAvatar />
            {connection === 'offline' && (
              <div className="avatar-offline-display" role="status" aria-live="polite">
                <span>ARIA OFFLINE —</span>
                <span>Start Ollama to connect</span>
              </div>
            )}
          </div>
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
