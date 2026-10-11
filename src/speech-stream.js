// Speech that starts before the reply is finished. Ollama's tokens are pushed in
// as they arrive. After each network chunk, completed sentences become available
// to the speaker while the rest of the reply is still generating.

// A sentence ends at . ! ? or … followed by whitespace (closing quotes and
// brackets included), or at a line break (list items often have no full stop).
const BOUNDARY = /[.!?…]+["'”’)\]]*(?=\s)|\n/g;
const TITLES = /^(?:mr|mrs|ms|dr|prof|sr|jr|st|vs)$/i;

// A full stop that doesn't end a sentence: "1." list markers, initials, "U.S.",
// "e.g.", and titles such as "Dr.". A missed boundary only delays speech a little;
// it never changes what is said.
function isSentenceEnd(text, index) {
  if (text[index] !== '.') return true;
  const before = text.slice(0, index);
  const token = /\S*$/.exec(before)[0];
  const word = token.replace(/^[("'“‘[*_]+/, '');
  if (/^\d+$/.test(word) && /(?:^|\n)[\s>*_-]*$/.test(before.slice(0, before.length - token.length))) return false;
  return !(/^(?:[A-Za-z]\.)*[A-Za-z]$/.test(word) || TITLES.test(word));
}

// Index just past the last complete sentence in `text` (0 when there is none).
export function sentenceCut(text) {
  let cut = 0;
  for (const match of String(text || '').matchAll(BOUNDARY)) {
    if (match[0] === '\n' || isSentenceEnd(text, match.index)) cut = match.index + match[0].length;
  }
  return cut;
}

// One reply's speakable text. A single speaker consumes it at a time:
//   poll()   — all text that is ready (consumed), null once the reply ended and
//              everything was taken, or undefined while waiting for more
//   wait()   — resolves when poll() may return something new (or on detach)
//   detach() — the current speaker is done; wake its pending wait()
//   unshift  — return unplayed text to the front, for a fallback speaker
//   cancel() — the reply failed or was abandoned: end it and stop the speaker now
//              through the `onCancel` it registered
export function createSpeechStream() {
  let buffer = ''; // Received, sentence not finished yet.
  let ready = ''; // Complete, waiting for the speaker.
  let accepted = ''; // Everything that is (or will be) spoken.
  let ended = false;
  let canceled = false;
  let onCancel = null;
  let waiters = [];
  const wake = () => {
    const current = waiters;
    waiters = [];
    current.forEach((resolve) => resolve());
  };
  const accept = (text) => {
    ready += text;
    accepted += text;
  };
  return {
    push(delta) {
      if (!ended && typeof delta === 'string') buffer += delta;
    },
    // Called once per network chunk, so text that arrives together is spoken together.
    flush() {
      if (ended) return;
      const cut = sentenceCut(buffer);
      if (cut > 0) {
        accept(buffer.slice(0, cut));
        buffer = buffer.slice(cut);
      }
      if (ready.trim()) wake();
    },
    // `cutOff`: the model hit its token limit, so the last sentence is unfinished.
    // Drop it unless it is all there is. `discard` drops everything not yet taken.
    end({ cutOff = false, discard = false } = {}) {
      if (ended) return;
      if (discard) ready = '';
      else if (!cutOff || !/[\p{L}\p{N}]/u.test(accepted)) accept(buffer);
      buffer = '';
      ended = true;
      wake();
    },
    poll() {
      const text = ready.trim();
      if (text) {
        ready = '';
        return text;
      }
      ready = '';
      return ended ? null : undefined;
    },
    wait() {
      return new Promise((resolve) => {
        if (ready.trim() || ended) resolve();
        else waiters.push(resolve);
      });
    },
    detach() {
      onCancel = null;
      wake();
    },
    cancel() {
      if (canceled) return;
      canceled = true;
      ended = true;
      ready = buffer = '';
      const stop = onCancel;
      onCancel = null;
      wake();
      stop?.();
    },
    set onCancel(handler) { onCancel = canceled ? null : handler; },
    unshift(text) {
      if (String(text || '').trim()) ready = `${String(text).trim()} ${ready}`;
      wake();
    },
    get pending() { return Boolean(ready.trim()); },
    get ended() { return ended; },
    get canceled() { return canceled; },
    get text() { return accepted.trim(); },
  };
}

// A finished reply (local memory answers, voice tests) through the same interface.
export function textSpeechStream(text) {
  const stream = createSpeechStream();
  stream.push(String(text || ''));
  stream.end();
  return stream;
}
