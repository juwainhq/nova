import { APP_NAME } from './brand.js';

// Appearance only. These preferences never enter a prompt, voice setting or memory.
export const AVATAR_STORAGE_KEY = 'nova_avatar';
export const AVATARS = Object.freeze([
  { id: 'orb', name: 'Orb', description: 'Orb · amber theme' },
  { id: 'bot', name: 'Bot', description: `${APP_NAME} Bot · blue theme` },
]);

export function readAvatar(storage) {
  try {
    const saved = (storage || window.localStorage).getItem(AVATAR_STORAGE_KEY);
    return saved === 'bot' ? 'bot' : 'orb';
  } catch {
    return 'orb';
  }
}

// Adapt the existing activity/mood to a drawing, without changing the assistant's
// state machine. Offline is a connection status, not a different assistant activity.
export function avatarExpression(stage, mood) {
  if (stage === 'listening') return mood === 'wake' ? 'waking' : 'listening';
  if (stage === 'thinking' || stage === 'speaking') return stage;
  return mood === 'happy' ? 'happy' : 'idle';
}
