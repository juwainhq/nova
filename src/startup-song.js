// Startup playlist: on the first load of a session, a visible card offers to play the saved
// YouTube playlist. It closes after 45 seconds, or sooner when dismissed.

export const PLAYLIST_URL_KEY = 'nova_playlist_url';
export const STARTUP_SONG_KEY = 'nova_startup_song';
export const INTRO_PLAYED_KEY = 'nova_played_intro';
export const PLAYER_DISMISS_MS = 45000;
export const PLAYER_FADE_MS = 1000;
export const NO_PLAYLIST_MESSAGE = 'No playlist saved — add one in Settings → Voice';

export function startupSongEnabled(value) {
  return value !== 'false';
}

// Extracts the playlist ID from a YouTube URL. Handles youtube.com/playlist?list=XXX,
// youtube.com/watch?v=xxx&list=XXX and youtu.be/xxx?list=XXX.
export function getPlaylistId(url) {
  const match = String(url || '').match(/[?&]list=([^&]+)/);
  return match ? match[1] : null;
}

export function playerEmbedUrl(pid) {
  return `https://www.youtube.com/embed/videoseries?list=${pid}&autoplay=1&mute=0`;
}

// Returns the playlist ID to show, or null when the card should not appear: no saved playlist,
// an invalid one, the startup song is off, or the card already appeared this session. A shown
// card marks the session.
export function startSessionSong() {
  try {
    if (window.sessionStorage.getItem(INTRO_PLAYED_KEY) === 'true') return null;
    if (!startupSongEnabled(window.localStorage.getItem(STARTUP_SONG_KEY))) return null;
    const pid = getPlaylistId(window.localStorage.getItem(PLAYLIST_URL_KEY));
    if (!pid) return null;
    window.sessionStorage.setItem(INTRO_PLAYED_KEY, 'true');
    console.log('Playlist ID:', pid);
    return pid;
  } catch {
    return null; // Blocked storage: no card.
  }
}
