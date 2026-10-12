import { useCallback, useEffect, useRef, useState } from 'react';
import { BROWSE_KINDS } from './web-browse.js';

// On phones the results sheet is dismissed by dragging its grabber down: a release
// past a third of the sheet (or a quick flick) closes it, anything shorter rides a
// CSS transition back. Transitions outrank the panel's slide keyframes, so the
// finger's own offset stays in charge for the whole gesture. The × button and
// "close" stay the keyboard/voice paths, so the grabber itself is decorative.
const CLOSE_FRACTION = 1 / 3;
const FLICK_PX_PER_MS = 0.5; // A deliberate downward toss, not a slow slide.
const RELEASE_MS = 220; // Kept under the panel's own 300ms unmount window.

export default function BrowsePanel({ browse, onClose, onNavigate, onBack, onForward, onRefresh }) {
  const rootRef = useRef(null);
  const addressRef = useRef(null);
  const dragRef = useRef(null);
  // Sticky: once the finger has taken the sheet, the entry keyframes stop filling.
  const [dragged, setDragged] = useState(false);
  const [address, setAddress] = useState(browse.url);
  // An address the app refuses (a non-web scheme) marks the bar instead of doing nothing.
  const [refused, setRefused] = useState(false);

  // The frame is cross-origin: nothing here can read where Google went next, so
  // the bar shows the address NOVA last loaded, and follows back/forward/refresh.
  useEffect(() => { setAddress(browse.url); setRefused(false); }, [browse.url]);

  const submitAddress = useCallback((event) => {
    event.preventDefault();
    const raw = address.trim();
    if (!raw) return;
    // The app owns the address rules (see browseInputStop), so it also reports back.
    if (onNavigate?.(raw) === false) { setRefused(true); return; }
    setRefused(false);
    addressRef.current?.select?.(); // Ready for the next address without another tap.
  }, [address, onNavigate]);

  const endDrag = useCallback((snapBack = false) => {
    const root = rootRef.current;
    const drag = dragRef.current;
    dragRef.current = null;
    if (!root?.style || !drag) return;
    const height = root.clientHeight || 0;
    const speed = drag.time > 0 ? drag.offset / drag.time : 0;
    const close = !snapBack && (drag.offset >= height * CLOSE_FRACTION || speed >= FLICK_PX_PER_MS);
    root.style.transition = `transform ${RELEASE_MS}ms ease-out`;
    root.style.transform = close ? 'translateY(100%)' : 'translateY(0)';
    if (!close) {
      // Ride back, then hand the sheet back to the stylesheet. A drag that started
      // again in the meantime keeps its own transform, so leave that one alone.
      window.setTimeout(() => {
        if (dragRef.current) return;
        root.style.transition = '';
        root.style.transform = '';
      }, RELEASE_MS);
      return;
    }
    // The slide-out keyframes always start from the top of the sheet; this transition
    // is already carrying it from wherever the finger stopped, and the panel unmounts
    // inside the app's own 300ms window, so the held styles never need clearing.
    root.style.animationName = 'none';
    onClose();
  }, [onClose]);

  const onHandlePointerDown = (event) => {
    if (browse.closing || dragRef.current || !rootRef.current?.style) return;
    dragRef.current = { from: event.clientY, offset: 0, startedAt: 0, time: 0 };
    setDragged(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onHandlePointerMove = (event) => {
    const drag = dragRef.current;
    const root = rootRef.current;
    if (!drag || !root?.style) return;
    // Downward travel only: pulling up must never cover NOVA.
    const offset = Math.max(0, event.clientY - drag.from);
    if (offset > 2 && !drag.startedAt) drag.startedAt = event.timeStamp || 0;
    drag.offset = offset;
    drag.time = (event.timeStamp || 0) - drag.startedAt;
    root.style.transform = `translateY(${offset}px)`;
  };

  const kind = BROWSE_KINDS[browse.kind] || BROWSE_KINDS.web;
  const classes = ['browse-panel'];
  if (browse.closing) classes.push('is-closing');
  if (dragged) classes.push('is-dragged');
  const onGoogle = /^https:\/\/(?:www\.)?google\.com\/search\?/.test(browse.url);
  const canBack = (browse.entries?.length ?? 0) > 0 && browse.step > 0;
  const canForward = browse.step >= 0 && browse.step < (browse.entries?.length ?? 0) - 1;
  return (
    <aside
      ref={rootRef}
      className={classes.join(' ')}
      aria-label={`${kind} results for ${browse.query}`}
      aria-hidden={browse.closing || undefined}
    >
      <div
        className="browse-handle"
        aria-hidden="true"
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={() => endDrag()}
        onPointerCancel={() => endDrag(true)}
      />
      <header className="browse-header">
        <span className="browse-kind">{kind}</span>
        <h2 className="browse-query" title={browse.query}>{browse.query}</h2>
        <button className="browse-close" type="button" aria-label="Close search panel" disabled={browse.closing} onClick={onClose}>×</button>
      </header>
      <div className="browse-chrome">
        <div className="browse-nav">
          <button className="browse-nav-button" type="button" aria-label="Go back" title="Back" disabled={!canBack || browse.closing} onClick={onBack}>←</button>
          <button className="browse-nav-button" type="button" aria-label="Go forward" title="Forward" disabled={!canForward || browse.closing} onClick={onForward}>→</button>
          <button className="browse-nav-button" type="button" aria-label="Refresh this page" title="Refresh" disabled={browse.closing} onClick={onRefresh}>↺</button>
        </div>
        <form className="browse-address" onSubmit={submitAddress}>
          <input
            ref={addressRef}
            className={`browse-address-input${refused ? ' is-refused' : ''}`}
            type="text"
            aria-label="Address or search"
            aria-invalid={refused || undefined}
            title={refused ? 'Only a web address or a search can open in here.' : undefined}
            placeholder="Search or type an address"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck="false"
            value={address}
            onChange={(event) => { setAddress(event.target.value); setRefused(false); }}
          />
        </form>
      </div>
      <iframe
        key={`${browse.url}#${browse.frame || 0}`}
        className="browse-frame"
        src={browse.url}
        title={onGoogle ? `Google ${kind.toLowerCase()} results for ${browse.query}` : `${browse.query} in the browsing panel`}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        allow="autoplay; fullscreen; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </aside>
  );
}
