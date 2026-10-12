// Spoken search requests open a browsing panel beside NOVA instead of a new tab.
// Results are Google's own pages in an iframe. DuckDuckGo refuses to be framed
// (X-Frame-Options: SAMEORIGIN); Google allows it with the undocumented igu=1
// parameter, which Google could change at any time.
import { imageSearchQuery } from './rich-response.js';

export const BROWSE_FOUND_TEXT = "Here's what I found!";
export const BROWSE_SLIDE_MS = 300;
export const BROWSE_KINDS = { web: 'Web', images: 'Images', videos: 'Videos' };
// A session keeps its own trail of addresses, because the page inside the frame is
// cross-origin: no script here can read or steer Google's history, so back/forward
// can only mean "the searches and addresses NOVA opened".
export const BROWSE_HISTORY_MAX = 12;

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
  // An unfinished ask ("search for a", "look up pictures of") is not a search either.
  if (!query || query.length < 2 || /^(?:a|an|the|some|this|that)$/i.test(query)) return null;
  if (new RegExp(`^(?:(?:a|an|some|the)\\s+)?(?:${PICTURE}|${VIDEO})\\s+(?:of|for)\\b`, 'i').test(query)) return null;
  return query;
}

// ------------------------------------------------- product, shopping and picture asks
// The rules above only knew "search for X" / "look up X" / "find info about X", so a
// shopping ask came back as a spoken guess. Any request that *starts* with one of these
// actions and leaves a real thing behind is now a live search: "find me a laptop",
// "buy a keyboard", "where can I get a cheap SSD", "the price of AirPods". The object is
// what has to be solid: a question word, a possessive, an app feature or nothing at all
// stays conversation ("find my keys", "show me how to cook rice", "look up").
// The verb patterns below are regex *sources* interpolated into RegExp templates, so an
// escape has to survive two layers: inside a template literal `\s` is a plain "s", which
// silently breaks the pattern. String.raw keeps the backslash, and one literal regex.
const verb = (stem) => String.raw`(?:${stem}(?:s|es|ed|ing)?)`;
const ACT = String.raw`(?:${verb('find')}|${verb('look')}\s+(?:for|up)|lookup|${verb('search')}\s+(?:for|up|online|the\s+(?:web|internet))|${verb('google')}|${verb('show')}\s+(?:me|us)|${verb('get')}\s+me|${verb('give')}\s+me|${verb('send')}\s+me)`;
const SHOPPING = String.raw`(?:${verb('buy')}|${verb('shop')}(?:\s+for)?|${verb('purchase')}|${verb('order')}|compar(?:e|es|ing|ison))`;
const WHERE_GET = String.raw`where\s+(?:can|could|do|did|should|would|might)\s+(?:i|we|you)\s+(?:${verb('get')}|${verb('buy')}|${verb('find')}|${verb('purchase')}|${verb('order')})`;
const PRICE_OF = String.raw`(?:${verb('cost')}|prices?\s+(?:of|for)|(?:price |cost )?comparison(?:s)?\s+of)`;
// A "pictures of …" anywhere is an image request, even without a verb in front of it.
const PICTURES_OF = new RegExp(`\\b(?:${PICTURE})\\s+of\\s+(.+)$`, 'i');
// Media words alone are not a thing to shop for, and app nouns belong to the app itself.
const ONLY_MEDIA = new RegExp(`^(?:${PICTURE}|${VIDEO})(?:\\s+(?:of|for))?$`, 'i');
const APP_FEATURE = /\b(?:settings?|microphone|\bmic\b|volume|speakers?|transcript|memor(?:y|ies)|reminders?|wake\s+word|api\s+keys?|ollama|\bapp\b)/i;

// "I want to", "let's", "please" and the polite question forms in front of the verb.
const askLead = (text) => String(text || '').trim()
  .replace(new RegExp(LEAD, 'i'), '')
  .replace(/^(?:i\s+(?:want|need|hope)\s+to\s+|i(?:'d|\s+would)\s+like\s+to\s+|we\s+(?:want|need)\s+to\s+|let(?:\s+us|s)\s+|try\s+to\s+|go\s+and\s+)+/i, '')
  .trim();

const searchSubject = (text) => {
  const query = subject(text);
  if (!query || query.length < 2) return null;
  if (NOT_A_THING.test(query) || ONLY_MEDIA.test(query) || APP_FEATURE.test(query)) return null;
  if (/^(?:of|for|about|on|to|the|a)$/.test(query)) return null; // "look up", "a picture of"
  return query;
};

export function picturesOfQuery(text) {
  const match = PICTURES_OF.exec(clean(text));
  return match ? searchSubject(match[1]) : null;
}

export function shoppingRequestQuery(text) {
  const request = askLead(clean(text));
  if (!request) return null;
  const rules = [
    [new RegExp(String.raw`^(?:${WHERE_GET})\s+(.+)$`, 'i'), (query) => query],
    [new RegExp(String.raw`^(?:(?:what|how much)\s+(?:is|are)?\s*)?(?:the\s+)?${PRICE_OF}\s+(?:of|for|to)?\s*(?:the\s+)?(.+)$`, 'i'), (query) => `price of ${query}`],
    [new RegExp(String.raw`^(?:${SHOPPING})\s+(?:me\s+)?(?:some\s+)?(.+)$`, 'i'), (query) => query],
    [new RegExp(String.raw`^(?:${ACT})\s+(?:me\s+)?(?:some\s+)?(.+)$`, 'i'), (query) => query],
  ];
  for (const [pattern, shape] of rules) {
    const match = pattern.exec(request);
    if (!match) continue;
    const query = searchSubject(shape(match[1]));
    if (query) return query;
  }
  return null;
}

// "close", "hide", "dismiss" (optionally "the panel/browser/results…") — the whole request.
// "go back" used to live here; it now navigates the panel instead (see browseNavRequest).
export function isCloseCommand(text) {
  const words = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s']+/gu, ' ').replace(/\s+/g, ' ').trim();
  return /^(?:(?:ok|okay|now|nova)\s+)?(?:please\s+)?(?:close|hide|dismiss)(?:\s+(?:it|this|that|(?:the\s+)?(?:panel|browser|search(?:\s+results)?|results|window|page|pictures|images|videos)))?(?:\s+(?:please|now))?$/.test(words);
}

// Videos first ("show me a video of cats" is not a picture of "a video of cats"),
// then images, then web search, then the broad product/shopping rules.
// Anything else is a normal question.
export function browseRequest(text) {
  const video = videoRequestQuery(text);
  if (video) return { kind: 'videos', query: video };
  const image = imageRequestQuery(text);
  if (image) return { kind: 'images', query: image };
  const web = webSearchQuery(text);
  if (web) return { kind: 'web', query: web };
  const pictures = picturesOfQuery(text);
  if (pictures) return { kind: 'images', query: pictures };
  const shopping = shoppingRequestQuery(text);
  return shopping ? { kind: 'web', query: shopping } : null;
}

export function browseUrl(kind, query) {
  const url = new URL('https://www.google.com/search');
  url.searchParams.set('igu', '1');
  if (kind === 'images') url.searchParams.set('tbm', 'isch');
  else if (kind === 'videos') url.searchParams.set('tbm', 'vid');
  url.searchParams.set('q', query);
  return url.href;
}

// ---------------------------------------------------------------- address input
// Only http(s) may be framed. A pasted javascript:, data:, file: or view-source:
// address is refused outright: a frame with allow-same-origin would otherwise run
// it in this page's own origin.
const UNSAFE_ADDRESS = /^[a-z][a-z0-9+.-]*:(?!\/\/)/i;
export function browseTargetUrl(text) {
  const raw = String(text || '').trim().replace(/\s+/g, '');
  if (!raw || UNSAFE_ADDRESS.test(raw)) return null;
  const explicit = /^https?:\/\//i.test(raw);
  const candidate = /^https?:\/\//i.test(raw) ? raw : /^\/\//.test(raw) ? `https:${raw}` : `https://${raw}`;
  let url;
  try { url = new URL(candidate); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  // The frame runs scripts with its real origin (that is what makes Google usable in
  // here), so a page of *this* origin must not be loaded: it could read the app's
  // storage and, since links may now move the page behind NOVA, move it.
  const here = typeof location === 'object' && location ? location.origin : null;
  if (here && url.origin === here) return null;
  if (!/^[a-z0-9._-]+$/i.test(url.hostname) || /^\.|\.$/.test(url.hostname)) return null;
  // Without a typed scheme a host needs a dot, so "dogs" and "localhost" stay searches;
  // an explicit http(s):// address is taken as written (localhost dev servers included).
  if (!explicit && !url.hostname.includes('.')) return null;
  return url.href;
}

// The header shows the host of a typed page, or the words of a typed search.
export function browseHostLabel(url) {
  try { return new URL(url).hostname.replace(/^www\./i, ''); } catch { return String(url || ''); }
}

// What the address bar hands to the panel: a host becomes one stop, anything else
// is a search. A refused address (javascript:, data:, …) yields null, so the caller
// can say so rather than pretend the frame moved.
const REFUSED_SCHEME = /^(?:javascript|vbscript|data|blob|file|view-source|about|filesystem|resource|chrome(?:-extension)?):/i;

export function browseInputStop(text) {
  const raw = String(text || '').trim();
  if (!raw || REFUSED_SCHEME.test(raw)) return null;
  const url = browseTargetUrl(raw);
  return url
    ? { kind: 'web', query: browseHostLabel(url), url }
    : { kind: 'web', query: raw, url: browseUrl('web', raw) };
}

// Spoken browser commands. Back, forward and refresh need a panel to act on;
// "go to <site>" also works with the panel closed, since it opens one. Every target
// has to look like a host, so "go to bed" and "how do I go back to sleep" stay
// ordinary conversation instead of being swallowed by a command.
const stripAsk = (text) => String(text || '')
  .trim()
  .replace(/^[“”"']+|[“”"']+$/gu, '')
  .replace(/[.!?…\s]+$/gu, '')
  .replace(/^(?:ok|okay|alright|now|just|please)\s+/i, '')
  .replace(/^(?:can|could|would|will)\s+you\s+/i, '')
  .replace(/^\s*(?:for me|please)\s+/i, '')
  .trim();
const BACK_REQUEST = /^(?:(?:go|head|move|step|jump|come)\s+)?back(?:\s+(?:one|a|1)?\s*(?:step|page)?)?$/i;
const FORWARD_REQUEST = /^(?:(?:go|move|step|jump)\s+(?:on\s+)?forward|(?:next|forward)(?:\s+page)?|go\s+ahead)$/i;
const REFRESH_REQUEST = /^(?:refresh|reload)(?:\s+(?:the\s+)?(?:page|panel|results|browser|this|it))?$/i;
const GOTO_REQUEST = /^(?:(?:go|navigate|head|travel|jump)\s+to|open|visit|load|browse(?:\s+to)?|pull\s+up)\s+(.+)$/i;
const GOTO_FILLER = /\s+(?:for me|site|website|web\s+page|page|in\s+(?:the\s+)?a?\s*browser)$/i;
const GOTO_LEAD = /^(?:the\s+)?(?:website|site|page|url)\s+(?:of\s+)?/i;

export function browseGoto(text) {
  const match = GOTO_REQUEST.exec(stripAsk(text));
  if (!match) return null;
  const target = match[1].replace(GOTO_FILLER, '').replace(GOTO_LEAD, '').trim();
  const url = browseTargetUrl(target);
  return url ? { action: 'goto', url, query: browseHostLabel(url) } : null;
}

export function browseNavRequest(text) {
  const request = stripAsk(text);
  if (!request) return null;
  if (BACK_REQUEST.test(request)) return { action: 'back' };
  if (FORWARD_REQUEST.test(request)) return { action: 'forward' };
  if (REFRESH_REQUEST.test(request)) return { action: 'refresh' };
  return browseGoto(request);
}

// The trail a panel keeps: one entry per page NOVA opened, newest last.
export function pushBrowseHistory(entries, step, stop) {
  const kept = entries.slice(0, step + 1);
  if (kept.at(-1)?.url === stop.url) return { entries: kept, step: kept.length - 1 };
  kept.push(stop);
  const trimmed = kept.length > BROWSE_HISTORY_MAX ? kept.slice(kept.length - BROWSE_HISTORY_MAX) : kept;
  return { entries: trimmed, step: trimmed.length - 1 };
}
