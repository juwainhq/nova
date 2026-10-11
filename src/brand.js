// Single source of truth for the app's name in JavaScript. The HTML titles carry it
// as literals, since a module cannot reach them; everything reachable from JS reads
// it from here, so a future rename is one edit plus the titles.
export const APP_NAME = 'NOVA';
export const APP_TAGLINE = 'Voice Intelligence';

export default APP_NAME;
