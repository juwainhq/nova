// Startup playlist: on the first click or tap of a session, a YouTube playlist starts in a
// hidden embed. The embed plays from a random point, then stops after 30 seconds.

export const PLAYLIST_URL_KEY = 'nova_playlist_url';
export const STARTUP_SONG_KEY = 'nova_startup_song';
export const SONG_STARTED_KEY = 'nova_song_started';
export const SONG_PLAY_MS = 30000;
// The random start point, in seconds into the playlist's first track.
export const SONG_START_MAX_SECONDS = 300;

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

export function randomStartSeconds(random = Math.random) {
  return Math.floor(random() * (SONG_START_MAX_SECONDS + 1));
}

export function songEmbedUrl(listId, start) {
  return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(listId)}&autoplay=1&start=${start}`;
}

let armed = false;

// Arms once per page load, and only once per session. The listener reads the saved settings
// when the gesture happens, so a change made in Settings applies to the next session.
// `setSource` receives the embed URL to play, then '' after 30 seconds.
export function armStartupSong(setSource) {
  if (armed) return;
  let started = true;
  try {
    started = window.sessionStorage.getItem(SONG_STARTED_KEY) === 'true';
    if (!started) window.sessionStorage.setItem(SONG_STARTED_KEY, 'true');
  } catch {
    started = true; // Without session storage, don't risk a song on every refresh.
  }
  if (started) return;
  armed = true;
  window.addEventListener('pointerdown', () => {
    let enabled = true;
    let listId = '';
    try {
      enabled = startupSongEnabled(window.localStorage.getItem(STARTUP_SONG_KEY));
      listId = playlistIdFromUrl(window.localStorage.getItem(PLAYLIST_URL_KEY));
    } catch { /* Blocked storage: nothing to play. */ }
    if (!enabled || !listId) return;
    setSource(songEmbedUrl(listId, randomStartSeconds()));
    window.setTimeout(() => setSource(''), SONG_PLAY_MS);
  }, { once: true });
}
