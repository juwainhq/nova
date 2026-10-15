// Response speed. Both modes stream the reply and start speaking the first sentence as soon as it
// arrives. Fast keeps replies short; Detailed allows longer replies.
export const SPEED_STORAGE_KEY = 'nova_speed';
export const DEFAULT_SPEED = 'fast';
export const SPEED_MODES = Object.freeze({
  fast: Object.freeze({ id: 'fast', label: 'Fast', maxTokens: 60, temperature: 0.6, earlySpeech: true }),
  detailed: Object.freeze({ id: 'detailed', label: 'Detailed', maxTokens: 150, temperature: 0.7, earlySpeech: true }),
});

export function normalizeSpeed(value) {
  return value === 'detailed' ? 'detailed' : DEFAULT_SPEED;
}

export function speedMode(value) {
  return SPEED_MODES[normalizeSpeed(value)];
}
