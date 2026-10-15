// Startup playlist: on the first load of a session, a visible mini player starts the saved
// YouTube playlist. It fades out after 45 seconds, or sooner when dismissed.

export const PLAYLIST_URL_KEY = 'nova_playlist_url';
export const STARTUP_SONG_KEY = 'nova_startup_song';
export const INTRO_PLAYED_KEY = 'nova_played_intro';
export const PLAYER_DISMISS_MS = 45000;
export const PLAYER_FADE_MS = 400;

export function startupSongEnabled(value) {
  return value !== 'false';
}

// The playlist ID from a YouTube playlist (or watch) URL, or '' when there is none.
export function playlistIdFromUrl(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  let url;
  try {
    url = new URL(value);
  } catch {
    return '';
  }
  const host = url.hostname.replace(/^www\./, '');
  if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'music.youtube.com' && host !== 'youtu.be') return '';
  const id = url.searchParams.get('list') || '';
  return /^[A-Za-z0-9_-]{6,}$/.test(id) ? id : '';
}

export function playerEmbedUrl(listId, muted) {
  return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(listId)}&autoplay=1&mute=${muted ? 1 : 0}&controls=0`;
}

// Returns the playlist ID to show, or '' when the player should not appear: no saved playlist,
// the startup song is off, or the player already appeared this session. Marks the session.
export function startSessionSong() {
  try {
    if (window.sessionStorage.getItem(INTRO_PLAYED_KEY) === 'true') return '';
    const enabled = startupSongEnabled(window.localStorage.getItem(STARTUP_SONG_KEY));
    const listId = playlistIdFromUrl(window.localStorage.getItem(PLAYLIST_URL_KEY));
    if (!enabled || !listId) return '';
    window.sessionStorage.setItem(INTRO_PLAYED_KEY, 'true');
    return listId;
  } catch {
    return ''; // Blocked storage: no player.
  }
}
