import { useEffect, useState } from 'react';
import { NO_PLAYLIST_MESSAGE, PLAYER_DISMISS_MS, PLAYER_FADE_MS, PLAYLIST_URL_KEY, getPlaylistId, playerEmbedUrl } from './startup-song.js';

// The startup music card. Browsers only allow sound after a direct tap, so the card waits for
// one: a tap anywhere on the page, or the play button, starts the playlist. The YouTube iframe
// is 1px and nearly transparent. Closing the card or its 45-second timer removes the iframe,
// which stops playback, and the card fades out.
export default function StartupPlayer({ onDismiss }) {
  const [playing, setPlaying] = useState(false);
  const [closed, setClosed] = useState(false);
  const [pid, setPid] = useState('');
  const [error, setError] = useState('');

  // Builds the embed from the saved playlist URL. Without a playlist, nothing plays.
  const startPlayback = () => {
    let saved = '';
    try { saved = window.localStorage.getItem(PLAYLIST_URL_KEY) || ''; } catch { /* Blocked storage: no playlist. */ }
    const id = getPlaylistId(saved);
    if (!id) {
      setError(NO_PLAYLIST_MESSAGE);
      return;
    }
    console.log('Playlist ID:', id);
    setError('');
    setPid(id);
    setPlaying(true);
  };

  // Any tap outside the card starts the playlist. A tap inside the card is left to its buttons.
  useEffect(() => {
    if (playing || closed) return undefined;
    const onPointer = (event) => {
      if (event.target instanceof Element && event.target.closest('.startup-player')) return;
      startPlayback();
    };
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  }, [playing, closed]);

  // The card closes itself after 45 seconds, whether or not it has been tapped.
  useEffect(() => {
    const timer = window.setTimeout(() => setClosed(true), PLAYER_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // After the fade, the card leaves the page.
  useEffect(() => {
    if (!closed) return undefined;
    const timer = window.setTimeout(onDismiss, PLAYER_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [closed, onDismiss]);

  return (
    <section className={`startup-player${closed ? ' is-closed' : ''}`} role="region" aria-label="Startup music player">
      <div className="startup-player-top">
        <span className="startup-player-brand">♪ NOVA</span>
        <button className="startup-player-close" type="button" aria-label="Close music player" onClick={() => setClosed(true)}>✕</button>
      </div>
      <p className="startup-player-name">Your Playlist</p>
      {playing ? (
        <button className="startup-player-play is-playing" type="button" disabled>
          <span className="startup-player-dot" aria-hidden="true" />
          ⏸ Playing...
        </button>
      ) : (
        <button className="startup-player-play" type="button" onClick={startPlayback}>▶ Tap to play</button>
      )}
      {error && <p className="startup-player-error" role="alert">{error}</p>}
      <div className="startup-player-foot">
        <span className="startup-player-line" aria-hidden="true" />
        <p className="startup-player-note">Auto-closes in 45s</p>
      </div>
      {playing && !closed && (
        <iframe
          title="Startup playlist"
          width="1"
          height="1"
          src={playerEmbedUrl(pid)}
          allow="autoplay; encrypted-media"
          style={{ position: 'absolute', width: '1px', height: '1px', opacity: 0.01 }}
        />
      )}
    </section>
  );
}
