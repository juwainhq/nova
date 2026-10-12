// Visual vocabulary from the concept board. `waking` is an internal bridge to
// the assistant's existing 800ms wake mood, not another recognition state.
export const AVATAR_EXPRESSIONS = Object.freeze([
  'neutral', 'happy', 'wink', 'surprised', 'thinking', 'sleepy',
  'speaking', 'listening', 'idle', 'waking',
]);

export function validAvatarExpression(value) {
  return AVATAR_EXPRESSIONS.includes(value) ? value : 'neutral';
}

// One small, cancellable sequence per activity; never a recurring timer. These
// reactions cannot issue a command, change the microphone, or put NOVA to sleep.
export const AVATAR_REACTIONS = Object.freeze({
  idle: Object.freeze([
    Object.freeze({ after: 12000, face: 'wink', decorative: true }),
    Object.freeze({ after: 12800, face: 'idle', decorative: true }),
    Object.freeze({ after: 45000, face: 'sleepy' }),
  ]),
  happy: Object.freeze([
    Object.freeze({ after: 900, face: 'wink', decorative: true }),
  ]),
});
