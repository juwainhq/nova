// Exercise the compiled App and SettingsPanel with the existing browser doubles.
// This verifies selection/lifecycle, not the sound or availability of OS voices.
import { createAppHarness, createStorageDouble } from './speech-test-fixtures.mjs';

const voice = (name, extra = {}) => ({ name, lang: 'en-US', voiceURI: `${name}-uri`, localService: true, ...extra });
const ariaVoice = voice('Microsoft Aria Online (Natural)', { localService: false });
const guyVoice = voice('Microsoft Guy Online (Natural)', { localService: false });
const googleVoice = voice('Google US English', { localService: false });
const basicVoice = voice('Samantha', { default: true });
const allVoices = [basicVoice, googleVoice, guyVoice, ariaVoice];
const panelNode = (ui) => ui.nodes().find((node) => node.props.onTestVoice && node.props.onClose);
const atStage = (ui, stage) => ui.find('status-word')?.props.className.split(' ').includes(`status-word-${stage}`);
const label = (ui) => ui.find('active-voice-label')?.props.children;
const sample = "Hey, I'm Nova. Ready when you are.";

async function openSettings(ui) {
  ui.find('settings-trigger').props.onClick();
  ui.flush();
  const mic = ui.recognition.instances[0];
  if (mic?.active) mic.end();
  return createAppHarness({ panelProps: panelNode(ui).props });
}
const syncPanel = (ui, panel) => panel.updatePanel(panelNode(ui).props);
const choose = (panel, key) => { panel.find('settings-select').props.onChange({ target: { value: key } }); panel.flush(); };
const test = (ui, panel) => { panel.find('test-voice-button').props.onClick(); ui.flush(); syncPanel(ui, panel); };

export async function verifyVoices(check) {
  const loaded = await createAppHarness({ voices: allVoices });
  check('voice load: getVoices runs immediately and in the mount refresh', loaded.voiceReads >= 2);
  check('voice load: automatic selection shows Aria under the avatar', label(loaded) === ariaVoice.name);
  const stageChildren = loaded.find('assistant-stage').props.children;
  check('voice label is directly below the avatar with accessible full-name text', stageChildren.indexOf(loaded.find('active-voice-label'))
    === stageChildren.indexOf(loaded.find('avatar-container')) + 1
    && loaded.find('active-voice-label').props['aria-label'] === `Active voice: ${ariaVoice.name}`
    && loaded.find('active-voice-label').props['aria-live'] === 'polite');
  loaded.unmount();

  const late = await createAppHarness({ voices: [] });
  check('empty voice list: label honestly identifies the browser default', label(late) === 'Browser default');
  late.updateVoices(allVoices);
  check('voiceschanged: delayed voices automatically select the priority winner', label(late) === ariaVoice.name);
  late.voiceReadError = true;
  late.updateVoices(allVoices);
  check('voice enumeration errors fall back safely instead of crashing', label(late) === 'Browser default');
  late.unmount();

  const timer = await createAppHarness({ voices: [] });
  timer.updateVoices(allVoices, false);
  timer.clock.tick(499);
  timer.flush();
  check('voice loading fallback: does not refresh before its 500ms delay', label(timer) === 'Browser default');
  timer.clock.tick(1);
  timer.flush();
  check('voice loading fallback: selects late voices even without voiceschanged', label(timer) === ariaVoice.name);
  timer.unmount();
  check('voice loading callbacks and timers are removed on unmount', timer.clock.pending === 0);
  const readsAfterUnmount = timer.voiceReads;
  timer.updateVoices([basicVoice]);
  check('unmounted voice listeners cannot refresh the voice list', timer.voiceReads === readsAfterUnmount);

  const ui = await createAppHarness({ voices: [basicVoice, googleVoice] });
  ui.clock.tick();
  await ui.settle();
  const panel = await openSettings(ui);
  choose(panel, basicVoice.voiceURI);
  test(ui, panel);
  const preview = ui.utterances[0];
  check('Test Voice speaks the exact phrase using the unsaved dropdown choice', preview?.text === sample && preview.voice === basicVoice);
  check('Test Voice uses rate .92, pitch .88 and unchanged full volume', preview?.rate === .92 && preview.pitch === .88 && preview.volume === 1);
  check('Test Voice leaves saved preferences, memory and chat requests untouched', ui.storage.getItem('nova.tts.voice') === null
    && ui.storage.getItem('nova.memory') === null && !ui.requests.some((request) => request.url.endsWith('/chat/completions')));
  check('queued preview sets the real speaker label and provides a Stop test action', label(ui) === basicVoice.name
    && panel.find('test-voice-button').props.disabled && Boolean(panel.find('voice-test-stop'))
    && atStage(ui, 'speaking'));
  const starts = ui.recognition.instances[0].starts.length;
  ui.clock.tick(10000);
  ui.flush();
  check('queued preview never restarts wake recognition prematurely', ui.recognition.instances[0].starts.length === starts && !ui.find('wake-indicator'));
  preview.onstart();
  preview.onboundary({ name: 'word', charLength: 10 });
  ui.flush();
  check('voice preview uses the existing real-boundary avatar signal', ui.avatarElement.style.getPropertyValue('--audio-pulse') === '1.000');
  ui.updateVoices(allVoices);
  syncPanel(ui, panel);
  check('active voice label stays with the utterance when a better auto voice arrives', label(ui) === basicVoice.name);
  preview.onend();
  await ui.settle();
  syncPanel(ui, panel);
  check('preview completion restores the preferred label and clears live word pulses', label(ui) === ariaVoice.name
    && ui.avatarElement.style.getPropertyValue('--audio-pulse') === '' && !panel.find('test-voice-button').props.disabled);
  check('preview completion does not invent a reply transcript, celebration or standby in settings', !ui.find('response-transcript')
    && !ui.find('avatar-container').props.className.includes('is-happy') && !ui.find('wake-indicator'));

  // Changing a draft voice cancels only this preview; old callbacks cannot hijack
  // the next one. The same pulse cleanup is used for test and answer speech.
  test(ui, panel);
  const oldPreview = ui.utterances.at(-1);
  oldPreview.onboundary({ name: 'word', charLength: 10 });
  const beforeChange = ui.cancellations;
  choose(panel, guyVoice.voiceURI);
  ui.flush();
  syncPanel(ui, panel);
  check('changing the dropdown cancels the previous preview and clears its signal', atStage(ui, 'ready')
    && ui.avatarElement.style.getPropertyValue('--audio-pulse') === '' && !panel.find('voice-test-stop')
    && ui.cancellations === beforeChange + 1);
  test(ui, panel);
  const guyPreview = ui.utterances.at(-1);
  oldPreview.onstart();
  oldPreview.onend();
  oldPreview.onerror();
  oldPreview.onboundary({ name: 'word', charLength: 10 });
  ui.flush();
  check('stale preview callbacks cannot change the new voice, stage or brightness', label(ui) === guyVoice.name
    && atStage(ui, 'speaking') && ui.avatarElement.style.getPropertyValue('--audio-pulse') === '');
  const beforeStop = ui.cancellations;
  panel.find('voice-test-stop').props.onClick();
  ui.flush();
  syncPanel(ui, panel);
  check('Stop test releases the preview without leaving the UI speaking', atStage(ui, 'ready')
    && !panel.find('voice-test-stop') && label(ui) === ariaVoice.name && ui.cancellations === beforeStop + 1);

  test(ui, panel);
  const failedPreview = ui.utterances.at(-1);
  failedPreview.onerror();
  ui.flush();
  syncPanel(ui, panel);
  check('preview engine errors release the controls and report an honest failure', !panel.find('test-voice-button').props.disabled
    && ui.find('toast')?.props.children.some((node) => typeof node?.props?.children === 'string' && /couldn.t play that voice/.test(node.props.children)));
  ui.speechThrows = true;
  test(ui, panel);
  check('synchronous speech startup failure cannot strand preview state', atStage(ui, 'ready') && !panel.find('voice-test-stop'));
  ui.speechThrows = false;

  // Saving an active preview must stop it too. Previewing itself never saved it.
  test(ui, panel);
  const savingPreview = ui.utterances.at(-1);
  const beforeSave = ui.cancellations;
  panel.nodes().find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
  ui.flush();
  panel.unmount();
  savingPreview.onstart();
  savingPreview.onend();
  ui.flush();
  check('Save stops the preview and rejects its late callbacks', ui.cancellations === beforeSave + 1
    && atStage(ui, 'ready'));
  check('Save persists the selected URI and updates the preferred voice label', ui.storage.getItem('nova.tts.voice') === guyVoice.voiceURI && label(ui) === guyVoice.name);
  const saved = await createAppHarness({ voices: [], storage: ui.storage });
  saved.updateVoices(allVoices);
  check('manual voice preference survives reload and late loading despite a higher auto priority', label(saved) === guyVoice.name);
  saved.clock.tick();
  saved.recognition.instances[0].result('hey nova tell me something');
  saved.recognition.instances[0].end();
  await saved.settle();
  check('normal replies honor the saved explicit voice override', saved.utterances[0]?.voice === guyVoice);
  saved.unmount();
  const autoPanel = await openSettings(ui);
  choose(autoPanel, '');
  autoPanel.nodes().find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
  ui.flush();
  autoPanel.unmount();
  check('Automatic clears the manual preference and returns to the priority picker', ui.storage.getItem('nova.tts.voice') === '' && label(ui) === ariaVoice.name);

  const closingPanel = await openSettings(ui);
  test(ui, closingPanel);
  const closingPreview = ui.utterances.at(-1);
  closingPreview.onboundary({ name: 'word', charLength: 10 });
  const beforeClose = ui.cancellations;
  panelNode(ui).props.onClose();
  ui.flush();
  closingPanel.unmount();
  ui.clock.tick();
  ui.flush();
  check('closing settings stops only the preview and safely resumes standby', !panelNode(ui)
    && ui.avatarElement.style.getPropertyValue('--audio-pulse') === '' && Boolean(ui.find('wake-indicator'))
    && ui.cancellations === beforeClose + 1);
  closingPreview.onstart();
  closingPreview.onend();
  ui.flush();
  check('late callbacks from a closed preview cannot change the current stage', atStage(ui, 'ready'));

  const unmountPanel = await openSettings(ui);
  test(ui, unmountPanel);
  const unmountedPreview = ui.utterances.at(-1);
  unmountedPreview.onboundary({ name: 'word', charLength: 10 });
  ui.unmount();
  unmountPanel.unmount();
  const utteranceCount = ui.utterances.length;
  unmountedPreview.onstart();
  unmountedPreview.onend();
  unmountedPreview.onboundary({ name: 'word', charLength: 10 });
  check('unmount cancels preview speech, timers and all late word pulses', ui.clock.pending === 0
    && ui.avatarElement.style.getPropertyValue('--audio-pulse') === '' && ui.utterances.length === utteranceCount);

  const empty = await createAppHarness({ voices: [] });
  empty.clock.tick();
  const emptyVoicePanel = await openSettings(empty);
  check('empty voice list still permits testing the browser default', !emptyVoicePanel.find('test-voice-button').props.disabled);
  test(empty, emptyVoicePanel);
  check('default preview does not pretend an unavailable named voice was selected', empty.utterances[0]?.voice === undefined && label(empty) === 'Browser default');
  empty.updateVoices(allVoices);
  check('late loading does not rename an already queued browser-default utterance', label(empty) === 'Browser default');
  empty.utterances[0].onend();
  empty.flush();
  check('after a default preview, the newly loaded priority voice is preferred', label(empty) === ariaVoice.name);
  empty.unmount();
  emptyVoicePanel.unmount();

  for (const options of [{ speech: false }, { missingSynthesis: true }]) {
    const unsupported = await createAppHarness(options);
    const unsupportedPanel = await openSettings(unsupported);
    check(`missing speech API (${Object.keys(options)[0]}): honest label and disabled preview`, label(unsupported) === 'Voice isn’t available here'
      && unsupportedPanel.find('test-voice-button').props.disabled);
    panelNode(unsupported).props.onTestVoice('');
    unsupported.flush();
    check(`missing speech API (${Object.keys(options)[0]}): no utterance or stuck speaking stage`, unsupported.utterances.length === 0
      && atStage(unsupported, 'ready'));
    unsupported.unmount();
    unsupportedPanel.unmount();
  }

  const offline = await createAppHarness({ voices: allVoices, modelsOffline: true });
  await offline.settle();
  const offlinePanel = await openSettings(offline);
  test(offline, offlinePanel);
  check('Test Voice works independently of an offline Ollama server', offline.utterances[0]?.text === sample
    && offline.utterances[0].voice === ariaVoice && !offline.requests.some((request) => request.url.endsWith('/chat/completions')));
  offline.unmount();
  offlinePanel.unmount();

  // Opening/closing settings cannot cancel a normal answer or let its label track
  // a newly arrived preferred voice before the original utterance actually ends.
  const normal = await createAppHarness({ voices: [basicVoice], storage: createStorageDouble() });
  normal.deferChat = true;
  normal.clock.tick();
  normal.recognition.instances[0].result('hey nova tell me something');
  normal.recognition.instances[0].end();
  normal.flush();
  const busyPanel = await openSettings(normal);
  check('Test Voice is disabled while a normal response is processing', busyPanel.find('test-voice-button').props.disabled);
  panelNode(normal).props.onTestVoice('');
  check('preview callbacks cannot interrupt an in-flight model request', normal.utterances.length === 0);
  await normal.settle();
  normal.pendingChats[0].resolve();
  await normal.settle();
  syncPanel(normal, busyPanel);
  const answer = normal.utterances[0];
  normal.updateVoices(allVoices);
  check('normal replies retain their actual speaker label across voiceschanged', label(normal) === basicVoice.name && answer.voice === basicVoice);
  check('Test Voice remains disabled during a normal queued/spoken reply', busyPanel.find('test-voice-button').props.disabled);
  const beforeCancel = normal.cancellations;
  panelNode(normal).props.onTestVoice(ariaVoice.voiceURI);
  panelNode(normal).props.onClose();
  normal.flush();
  busyPanel.unmount();
  check('closing settings and forced test clicks cannot cancel a normal reply', normal.cancellations === beforeCancel && normal.utterances.length === 1
    && atStage(normal, 'speaking'));
  answer.onend();
  await normal.settle();
  check('a completed normal reply adopts the new preferred voice for future speech', label(normal) === ariaVoice.name);
  normal.clock.tick();
  normal.flush();
  normal.recognition.instances[0].result('hey nova tell me more');
  normal.recognition.instances[0].end();
  await normal.settle();
  normal.pendingChats[1].resolve();
  await normal.settle();
  check('the next actual reply uses newly loaded voices through the fresh speaker ref', normal.utterances[1]?.voice === ariaVoice
    && normal.utterances[1].rate === .92 && normal.utterances[1].pitch === .88);
  normal.unmount();

  // Engine safety net: only the public speaking/pending booleans are read.
  const notice = (ui) => ui.find('toast')?.props.children[1]?.props.children;
  const rich = (ui) => Boolean(ui.find('rich-content-slot'));
  async function speakingUi(answer = 'Hello! I am here to help.') {
    const ui = await createAppHarness({ voices: [basicVoice], storage: createStorageDouble() });
    Object.assign(ui.window.speechSynthesis, { speaking: false, pending: false });
    ui.chatAnswer = answer;
    ui.clock.tick();
    await ui.settle();
    ui.recognition.instances[0].result('hey nova tell me something');
    ui.recognition.instances[0].end();
    await ui.settle();
    return ui;
  }
  const tick = async (ui, ms) => { ui.clock.tick(ms); await ui.settle(); };

  const lost = await speakingUi('Two ideas:\n- Tea\n- A walk');
  lost.window.speechSynthesis.speaking = true;
  lost.utterances[0].onstart();
  await tick(lost, 5000);
  check('speech watchdog: a reply that is still speaking is left alone', atStage(lost, 'speaking') && !rich(lost));
  lost.window.speechSynthesis.speaking = false;
  await tick(lost, 1000);
  check('speech watchdog: one quiet check is not treated as a lost end event', atStage(lost, 'speaking'));
  const lostCancels = lost.cancellations;
  await tick(lost, 1000);
  check('speech watchdog: a lost end event finishes the reply and publishes its cards', atStage(lost, 'ready') && rich(lost)
    && lost.cancellations === lostCancels + 1 && !notice(lost));
  lost.utterances[0].onend();
  lost.utterances[0].onerror();
  await lost.settle();
  check('speech watchdog: late events from a rescued utterance are ignored', atStage(lost, 'ready') && lost.utterances.length === 1);
  lost.unmount();

  const dropped = await speakingUi('Two ideas:\n- Tea\n- A walk');
  await tick(dropped, 9000);
  check('speech watchdog: a slow-to-start queued utterance gets 10 seconds', atStage(dropped, 'speaking') && !notice(dropped));
  await tick(dropped, 1000);
  check('speech watchdog: an utterance that never starts recovers with a friendly message and no cards', atStage(dropped, 'ready')
    && !rich(dropped) && notice(dropped) === 'I couldn’t start speaking just now. Try again, or choose another voice in Settings.');
  dropped.unmount();

  const wedged = await speakingUi();
  wedged.window.speechSynthesis.speaking = true;
  wedged.utterances[0].onstart();
  await tick(wedged, 18000);
  check('speech watchdog: speech within the generous length-based ceiling is never cut off', atStage(wedged, 'speaking'));
  const wedgedCancels = wedged.cancellations;
  await tick(wedged, 1000);
  check('speech watchdog: a wedged engine is canceled at the ceiling so listening can resume', atStage(wedged, 'ready')
    && wedged.cancellations === wedgedCancels + 1);
  wedged.clock.tick();
  wedged.flush();
  check('speech watchdog: wake-word standby resumes after a rescued reply', Boolean(wedged.find('wake-indicator')));
  wedged.unmount();

  const unreliable = await speakingUi();
  unreliable.utterances[0].onstart();
  await tick(unreliable, 120000);
  check('speech watchdog: engines whose flags never report speaking keep trusting real events', atStage(unreliable, 'speaking'));
  unreliable.utterances[0].onend();
  await unreliable.settle();
  check('speech watchdog: the normal end event still completes those replies', atStage(unreliable, 'ready'));
  unreliable.unmount();

  const finished = await speakingUi();
  finished.window.speechSynthesis.speaking = true;
  finished.utterances[0].onstart();
  await tick(finished, 2000);
  finished.window.speechSynthesis.speaking = false;
  finished.utterances[0].onend();
  await finished.settle();
  const finishedCancels = finished.cancellations;
  await tick(finished, 120000);
  check('speech watchdog: a normally ended reply leaves no watchdog behind', atStage(finished, 'ready') && finished.cancellations === finishedCancels);
  finished.unmount();
  check('speech watchdog: unmount clears every watchdog timer', finished.clock.pending === 0);
}
