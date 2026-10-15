import { useEffect, useState } from 'react';
import { PLAYER_DISMISS_MS, PLAYER_FADE_MS, playerEmbedUrl } from './startup-song.js';

// A small card in the bottom-left corner. The YouTube iframe inside it is 1px and nearly
// transparent, because a hidden iframe is blocked from playing. Closing the card removes
// the iframe, which stops the playback.
export default function StartupPlayer({ listId, onDismiss }) {
  const [muted, setMuted] = useState(false);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fade = window.setTimeout(() => setFading(true), PLAYER_DISMISS_MS);
    return () => window.clearTimeout(fade);
  }, []);

  useEffect(() => {
    if (!fading) return undefined;
    const remove = window.setTimeout(onDismiss, PLAYER_FADE_MS);
    return () => window.clearTimeout(remove);
  }, [fading, onDismiss]);

  return (
    <section className={`startup-player${fading ? ' is-fading' : ''}`} role="region" aria-label="Startup music player">
      <div className="startup-player-top">
        <span className="startup-player-title">♪ Now Playing</span>
      </div>
      <div className="startup-player-controls">
        <span className="startup-player-bar" aria-hidden="true"><i /></span>
        <button
          className="startup-player-button"
          type="button"
          aria-label={muted ? 'Unmute startup song' : 'Mute startup song'}
          aria-pressed={muted}
          onClick={() => setMuted((current) => !current)}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        <button className="startup-player-button" type="button" aria-label="Close music player" onClick={() => { setFading(true); }}>✕</button>
      </div>
      <iframe
        className="startup-player-frame"
        title="Startup playlist"
        src={fading ? 'about:blank' : playerEmbedUrl(listId, muted)}
        width="1"
        height="1"
        allow="autoplay; encrypted-media"
        style={{ position: 'absolute', opacity: 0.01 }}
      />
    </section>
  );
}
