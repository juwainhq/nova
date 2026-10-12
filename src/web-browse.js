// Spoken search requests open a browsing panel beside NOVA instead of a new tab.
// Results are Google's own pages in an iframe. DuckDuckGo refuses to be framed
// (X-Frame-Options: SAMEORIGIN); Google allows it with the undocumented igu=1
// parameter, which Google could change at any time.
import { imageSearchQuery } from './rich-response.js';

export const BROWSE_FOUND_TEXT = "Here's what I found!";
export const BROWSE_SLIDE_MS = 300;
export const BROWSE_KINDS = { web: 'Web', images: 'Images', videos: 'Videos' };

const LEAD = '^(?:(?:hey\\s+)?(?:please\\s+)?(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?|please\\s+)?';
const PICTURE = '(?:pictures?|photos?|photographs?|images?|pics?)';
const VIDEO = '(?:videos?|clips?|footage)';
const ARTICLE = /^(?:a|an|some|the)\s+/i;
// "show me ..." is only a picture when the rest is a thing, not a question or an app feature.
const NOT_A_THING = /^(?:how|what|what's|where|when|why|who|whom|which|whether|if|my|your|our|their|his|her|its|me|you|us|them|it|this|that|these|those|something|anything|everything|nothing|more|again|around|the\s+way|way|directions?|weather|news|time|date|settings?|transcript|reminders?|list)\b/i;

const subject = (text) => String(text || '')
  .replace(/[,\s]+please$/i, '')
  .replace(/[\s.!?…]+$/u, '')
  .replace(/^[“"']+|[”"']+$/gu, '')
  .replace(ARTICLE, '')
  .trim();
const clean = (text) => String(text || '').trim().replace(/[.!?…]+$/u, '');

export function videoRequestQuery(text) {
  const request = clean(text);
  const match = new RegExp(`${LEAD}(?:(?:show|find|get|give|play|pull\\s+up|bring\\s+up|look\\s+up|search\\s+for|search|google)(?:\\s+me)?\\s+)?(?:(?:a|an|some|the|a\\s+few)\\s+)?${VIDEO}\\s+(?:of|about|on|for|showing|with)\\s+(.+)$`, 'i').exec(request)
    || new RegExp(`${LEAD}(?:show|find|play|search\\s+for|look\\s+up)(?:\\s+me)?\\s+(?:(?:a|an|some|the)\\s+)?(.+?)\\s+${VIDEO}$`, 'i').exec(request);
  if (!match) return null;
  const query = subject(match[1]);
  return query && !/^(?:a|an|some|the)$/i.test(query) && !NOT_A_THING.test(query) ? query : null;
}

export function imageRequestQuery(text) {
  const existing = imageSearchQuery(text);
  if (existing) return subject(existing) || null;
  const request = clean(text);
  const match = new RegExp(`${LEAD}(?:show|tell)\\s+me\\s+what\\s+(.+?)\\s+looks?\\s+like$`, 'i').exec(request)
    || new RegExp(`${LEAD}what\\s+(?:does|do|did)\\s+(.+?)\\s+look\\s+like$`, 'i').exec(request)
    || new RegExp(`${LEAD}(?:show|get|give|find|pull\\s+up|bring\\s+up|look\\s+up|google)(?:\\s+me)?\\s+(?:(?:a|an|some|the|a\\s+few)\\s+)?${PICTURE}\\s+(?:of|for)\\s+(.+)$`, 'i').exec(request)
    || new RegExp(`^(?:(?:a|an|some|the)\\s+)?${PICTURE}\\s+of\\s+(.+)$`, 'i').exec(request);
  if (match) {
    const query = subject(match[1]);
    return query && !NOT_A_THING.test(query) ? query : null;
  }
  const show = new RegExp(`${LEAD}show\\s+me\\s+(.+)$`, 'i').exec(request);
  if (!show || NOT_A_THING.test(show[1].trim())) return null;
  const query = subject(show[1]);
  const onlyMediaWords = new RegExp(`^(?:${PICTURE}|${VIDEO})(?:\\s+(?:of|for))?$`, 'i').test(query);
  return query && !onlyMediaWords && !NOT_A_THING.test(query) ? query : null;
}

export function webSearchQuery(text) {
  const request = String(text || '').trim();
  const match = new RegExp(`${LEAD}(?:search\\s+(?:the\\s+web|the\\s+internet|online|google)\\s+for|search\\s+for|search\\s+up|search|look\\s+up|lookup|google|find\\s+(?:me\\s+)?(?:some\\s+)?(?:more\\s+)?(?:information|info|details)\\s+(?:about|on|for)|look\\s+for\\s+(?:information|info)\\s+(?:about|on))\\s+(.+)$`, 'i').exec(request);
  if (!match) return null;
  const query = match[1]
    .replace(/[,\s]+please[\s.!?…]*$/i, '')
    .replace(/\s+(?:on\s+google|online|on\s+the\s+(?:web|internet))[\s.!?…]*$/i, '')
    .replace(/[\s.!?…]+$/u, '')
    .replace(/^[“"']+|[”"']+$/gu, '')
    .trim();
  if (!query || new RegExp(`^(?:(?:a|an|some|the)\\s+)?(?:${PICTURE}|${VIDEO})\\s+(?:of|for)\\b`, 'i').test(query)) return null;
  return query;
}

// "close", "hide", "go back" (optionally "the panel/results/search…") — the whole request.
export function isCloseCommand(text) {
  const words = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s']+/gu, ' ').replace(/\s+/g, ' ').trim();
  return /^(?:(?:ok|okay|now|nova)\s+)?(?:please\s+)?(?:close|hide|go\s+back|dismiss)(?:\s+(?:it|this|that|(?:the\s+)?(?:panel|browser|search(?:\s+results)?|results|window|page|pictures|images|videos)))?(?:\s+(?:please|now))?$/.test(words);
}

// Videos first ("show me a video of cats" is not a picture of "a video of cats"),
// then images, then web search. Anything else is a normal question.
export function browseRequest(text) {
  const video = videoRequestQuery(text);
  if (video) return { kind: 'videos', query: video };
  const image = imageRequestQuery(text);
  if (image) return { kind: 'images', query: image };
  const web = webSearchQuery(text);
  return web ? { kind: 'web', query: web } : null;
}

export function browseUrl(kind, query) {
  const url = new URL('https://www.google.com/search');
  url.searchParams.set('igu', '1');
  if (kind === 'images') url.searchParams.set('tbm', 'isch');
  else if (kind === 'videos') url.searchParams.set('tbm', 'vid');
  url.searchParams.set('q', query);
  return url.href;
}
