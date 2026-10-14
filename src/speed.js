// Response speed. Fast keeps replies short and starts speaking the first sentence while the rest
// is still generating. Detailed allows longer replies and waits for the full answer before speaking.
export const SPEED_STORAGE_KEY = 'nova_speed';
export const DEFAULT_SPEED = 'fast';
export const SPEED_MODES = Object.freeze({
  fast: Object.freeze({ id: 'fast', label: 'Fast', maxTokens: 80, temperature: 0.6, earlySpeech: true }),
  detailed: Object.freeze({ id: 'detailed', label: 'Detailed', maxTokens: 300, temperature: 0.7, earlySpeech: false }),
});

export function normalizeSpeed(value) {
  return value === 'detailed' ? 'detailed' : DEFAULT_SPEED;
}

export function speedMode(value) {
  return SPEED_MODES[normalizeSpeed(value)];
}
