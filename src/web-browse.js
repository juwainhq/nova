// Image and web search for spoken requests. No API keys: pictures come from
// Wikimedia Commons and Openverse (searched together, results interleaved),
// with LoremFlickr and the retired source.unsplash.com as plain-URL fallbacks.
// The panel shows three and swaps any picture that fails to load for the next.
import { imageSearchQuery } from './rich-response.js';

export const IMAGE_FOUND_TEXT = "Here's what I found!";
export const WEB_SEARCH_TEXT = 'Opening that search for you!';
export const WEB_SEARCH_BLOCKED_TEXT = `${WEB_SEARCH_TEXT} Your browser held the new tab back, so tap the link below.`;
export const IMAGE_RESULTS = 3;
export const IMAGE_SEARCH_TIMEOUT_MS = 5000;
const API_RESULTS = 6;

const LEAD = '^(?:(?:hey\\s+)?(?:please\\s+)?(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?|please\\s+)?';
const PICTURE = '(?:pictures?|photos?|photographs?|images?|pics?)';
const ARTICLE = /^(?:a|an|some|the)\s+/i;
// "show me ..." is only a picture when the rest is a thing, not a question or an app feature.
const NOT_A_THING = /^(?:how|what|what's|where|when|why|who|whom|which|whether|if|my|your|our|their|his|her|its|me|you|us|them|it|this|that|these|those|something|anything|everything|nothing|more|again|around|the\s+way|way|directions?|weather|news|time|date|settings?|transcript|reminders?|list)\b/i;

const subject = (text) => String(text || '')
  .replace(/[,\s]+please$/i, '')
  .replace(/[\s.!?…]+$/u, '')
  .replace(/^[“"']+|[”"']+$/gu, '')
  .replace(ARTICLE, '')
  .trim();

export function imageRequestQuery(text) {
  const existing = imageSearchQuery(text);
  if (existing) return subject(existing) || null;
  const request = String(text || '').trim().replace(/[.!?…]+$/u, '');
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
  const onlyPictureWords = new RegExp(`^${PICTURE}(?:\\s+(?:of|for))?$`, 'i').test(query);
  return query && !onlyPictureWords && !NOT_A_THING.test(query) ? query : null;
}

export function webSearchQuery(text) {
  const request = String(text || '').trim();
  const match = new RegExp(`${LEAD}(?:search\\s+(?:the\\s+web|the\\s+internet|online|google)\\s+for|search\\s+for|search\\s+up|look\\s+up|lookup|google|find\\s+(?:me\\s+)?(?:some\\s+)?(?:more\\s+)?(?:information|info|details)\\s+(?:about|on|for)|look\\s+for\\s+(?:information|info)\\s+(?:about|on))\\s+(.+)$`, 'i').exec(request);
  if (!match) return null;
  const query = match[1]
    .replace(/[,\s]+please[\s.!?…]*$/i, '')
    .replace(/\s+(?:on\s+google|online|on\s+the\s+(?:web|internet))[\s.!?…]*$/i, '')
    .replace(/[\s.!?…]+$/u, '')
    .replace(/^[“"']+|[”"']+$/gu, '')
    .trim();
  if (!query || new RegExp(`^(?:(?:a|an|some|the)\\s+)?${PICTURE}\\s+(?:of|for)\\b`, 'i').test(query)) return null;
  return query;
}

export function googleSearchLink(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

// Shown when the browser blocks the tab (voice input has no click to allow pop-ups).
export function searchCard(query) {
  return { links: [{ href: googleSearchLink(query), domain: 'google.com', detail: `Search: ${query}` }], images: [], items: [], truncated: false };
}

// Pop-ups need a user gesture; a voice request may not count, so report whether it opened.
export function openSearchTab(query, win = globalThis.window) {
  if (typeof win?.open !== 'function') return false;
  try {
    const tab = win.open(googleSearchLink(query), '_blank');
    if (!tab) return false;
    try { tab.opener = null; } catch { /* Some browsers make opener read-only. */ }
    return true;
  } catch { return false; }
}

const httpsUrl = (value) => {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
};
const picture = (thumb, full, title, source) => {
  const small = httpsUrl(thumb);
  return small ? { thumb: small, full: httpsUrl(full) || small, title: String(title || '').trim(), source } : null;
};

export function wikimediaSearchUrl(query) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  Object.entries({
    action: 'query', format: 'json', origin: '*', generator: 'search', gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: '6', gsrlimit: String(API_RESULTS), prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '400',
  }).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.href;
}

export function openverseSearchUrl(query) {
  const url = new URL('https://api.openverse.org/v1/images/');
  Object.entries({ q: query, page_size: String(API_RESULTS), mature: 'false', format: 'json' })
    .forEach(([key, value]) => url.searchParams.set(key, value));
  return url.href;
}

export function wikimediaPictures(data) {
  return Object.values(data?.query?.pages || {})
    .sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0))
    .map((page) => {
      const info = page?.imageinfo?.[0];
      if (!info || !/^image\/(?:jpeg|png|webp|gif)$/.test(info.mime)) return null;
      const title = String(page.title || '').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ');
      return picture(info.thumburl, info.url, title, 'Wikimedia Commons');
    })
    .filter(Boolean);
}

export function openversePictures(data) {
  return (Array.isArray(data?.results) ? data.results : [])
    .filter((result) => result && !result.mature)
    .map((result) => picture(result.thumbnail, result.url, result.title, 'Openverse'))
    .filter(Boolean);
}

export function fallbackPictures(query) {
  const tags = String(query).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 4);
  const path = (tags.length ? tags : ['nature']).map(encodeURIComponent).join(',');
  const term = encodeURIComponent(query);
  return [
    ...[1, 2, 3].map((n) => picture(`https://loremflickr.com/400/300/${path}?lock=${n}`, `https://loremflickr.com/1600/1200/${path}?lock=${n}`, query, 'LoremFlickr')),
    ...[1, 2, 3].map((n) => picture(`https://source.unsplash.com/400x300/?${term},${n}`, `https://source.unsplash.com/1600x1200/?${term},${n}`, query, 'Unsplash')),
  ];
}

// Gallery slots hold candidate indexes (-1 = nothing left to show in that slot).
export function galleryStart(count) {
  return { slots: Array.from({ length: Math.min(IMAGE_RESULTS, count) }, (_, index) => index), next: IMAGE_RESULTS };
}

export function galleryAfterError({ slots, next }, slot, count) {
  if (slots[slot] === undefined || slots[slot] < 0) return { slots, next };
  return { slots: slots.map((index, i) => (i === slot ? (next < count ? next : -1) : index)), next: next < count ? next + 1 : next };
}

async function searchSource(url, parse, { fetch: fetcher, signal, timers, timeoutMs }) {
  if (signal?.aborted) return [];
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let giveUp;
  const timeout = new Promise((resolve) => { giveUp = () => { controller?.abort(); resolve([]); }; });
  const stop = () => giveUp();
  signal?.addEventListener?.('abort', stop, { once: true });
  const timer = timers.setTimeout(stop, timeoutMs);
  const request = (async () => {
    const response = await fetcher(url, { signal: controller?.signal, headers: { Accept: 'application/json' } });
    if (!response?.ok) return [];
    return parse(await response.json());
  })().catch(() => []);
  try { return await Promise.race([request, timeout]); } finally {
    timers.clearTimeout(timer);
    signal?.removeEventListener?.('abort', stop);
  }
}

// Resolves (never rejects) to every usable candidate: API results first, then the fallbacks.
export async function findImages(query, {
  fetch: fetcher = globalThis.fetch, signal, timeoutMs = IMAGE_SEARCH_TIMEOUT_MS,
  timers = { setTimeout: (...args) => setTimeout(...args), clearTimeout: (id) => clearTimeout(id) },
} = {}) {
  const options = { fetch: fetcher, signal, timers, timeoutMs };
  const [wikimedia, openverse] = typeof fetcher === 'function' ? await Promise.all([
    searchSource(wikimediaSearchUrl(query), wikimediaPictures, options),
    searchSource(openverseSearchUrl(query), openversePictures, options),
  ]) : [[], []];
  const mixed = [];
  for (let i = 0; i < Math.max(wikimedia.length, openverse.length); i += 1) mixed.push(wikimedia[i], openverse[i]);
  const seen = new Set();
  return [...mixed, ...fallbackPictures(query)].filter((item) => {
    if (!item || seen.has(item.thumb)) return false;
    seen.add(item.thumb);
    return true;
  });
}
