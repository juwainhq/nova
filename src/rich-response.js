// Response text is data, never HTML. No preview scraping or image downloads.
export const RICH_VISIBLE_MS = 30000;
export const RICH_FADE_MS = 280;
export const MAX_RICH_LINKS = 24;
export const MAX_RICH_ITEMS = 60;

function trimUrl(value) {
  // Repeat until stable so "(see https://example.com.)" loses both ")" and ".".
  let url = value;
  for (let previous = ''; url !== previous;) {
    previous = url;
    url = url.replace(/[.,!?;:'"”’…]+$/, '');
    // Keep balanced Wikipedia-style parentheses, but not prose/Markdown delimiters.
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
      if (url.endsWith(close) && url.split(close).length > url.split(open).length) url = url.slice(0, -1);
    }
  }
  return url;
}

export function responseLinks(text, limit = MAX_RICH_LINKS) {
  const links = [];
  const seen = new Set();
  const source = String(text || '');
  for (const match of source.matchAll(/(^|[^a-z0-9])(https?:\/\/[^\s<>"`]+)/gi)) {
    try {
      let candidate = trimUrl(match[2]);
      const emphasis = source.slice(0, match.index + match[1].length).match(/(\*\*|__|\*|_)(?:\[[^\]]*\]\()?$/)?.[1];
      if (emphasis && candidate.endsWith(emphasis)) candidate = trimUrl(candidate.slice(0, -emphasis.length));
      const url = new URL(candidate);
      if (!/^https?:$/.test(url.protocol) || !url.hostname || url.username || url.password) continue;
      const href = url.href;
      if (seen.has(href)) continue;
      seen.add(href);
      links.push({ href, domain: url.hostname.replace(/^www\./i, ''), detail: `${url.pathname}${url.search}${url.hash}` });
      if (links.length === limit) break;
    } catch { /* Ignore malformed links rather than making a broken/unsafe card. */ }
  }
  return links;
}

function plainLabel(value) {
  return value.replace(/\[([^\]]+)\]\(https?:\/\/(?:[^()\s]|\([^()\s]*\))*\)/gi, '$1')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`/g, (_, bold, underline, code) => bold || underline || code)
    .replace(/(^|[\s(])(?:\*([^*]+)\*|_([^_]+)_)(?=$|[\s).,:;!?])/g, (_, prefix, star, underscore) => prefix + (star || underscore))
    .trim();
}

export function responseItems(text, limit = MAX_RICH_ITEMS) {
  const items = [];
  let fence = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) { fence = fence === marker[1][0] ? null : fence || marker[1][0]; continue; }
    if (fence) continue;
    const match = line.match(/^\s*(?:[-+*•–]\s+|\d{1,4}[.)]\s+)(\S.*)$/);
    if (!match) continue;
    const label = plainLabel(match[1].replace(/^\[[ xX]\]\s*/, ''));
    // Skips "* * *" / "- - -" rules and other marker-only lines.
    if (/[\p{L}\p{N}]/u.test(label)) items.push(label);
    if (items.length === limit) break;
  }
  return items;
}

export function imageSearchQuery(text) {
  const request = String(text || '').trim();
  const prefix = '(?:(?:please\\s+)?(?:can|could|would)\\s+you\\s+(?:please\\s+)?|please\\s+)?';
  const action = '(?:show|find|search(?:\\s+for)?|look\\s+for|generate|create)(?:\\s+me)?';
  const subject = '(?:(?:a|an|some|the)\\s+)?(?:pictures?|photos?|images?)\\s+(?:of|for)\\s+';
  const match = new RegExp(`^${prefix}${action}\\s+${subject}(.+)$`, 'i').exec(request)
    || /^(?:please\s+)?(?:i['’]d like|i want)(?:\s+to see)?\s+(?:an?\s+)?(?:picture|photo|image)\s+of\s+(.+)$/i.exec(request)
    || /^(?:please\s+)?search\s+google\s+images\s+for\s+(.+)$/i.exec(request);
  return match ? match[1].replace(/[,\s]+please[.!?]*$/i, '').replace(/[.!?]+$/, '').trim() || null : null;
}

export function googleImagesLink(query) {
  const url = new URL('https://www.google.com/search');
  url.searchParams.set('tbm', 'isch');
  url.searchParams.set('q', query);
  return url.href;
}

// `pictures` are fetched image candidates (see web-browse.js); without them the
// image card stays a Google Images placeholder.
export function richResponse(text, imageQuery = null, pictures = []) {
  const images = [];
  const links = [];
  if (imageQuery) {
    const image = { query: imageQuery, href: googleImagesLink(imageQuery) };
    if (Array.isArray(pictures) && pictures.length) image.pictures = pictures.slice(0, 24);
    images.push(image);
  }
  const allLinks = responseLinks(text, MAX_RICH_LINKS + 1);
  for (const link of allLinks.slice(0, MAX_RICH_LINKS)) {
    const url = new URL(link.href);
    const query = url.searchParams.get('q');
    if (['google.com', 'www.google.com', 'images.google.com'].includes(url.hostname)
      && url.pathname === '/search' && query && (url.searchParams.get('tbm') === 'isch' || url.searchParams.get('udm') === '2')) {
      if (!images.some((image) => image.query === query)) images.push({ query, href: link.href });
    } else links.push(link);
  }
  const allItems = responseItems(text, MAX_RICH_ITEMS + 1);
  return { links, images, items: allItems.slice(0, MAX_RICH_ITEMS), truncated: allLinks.length > MAX_RICH_LINKS || allItems.length > MAX_RICH_ITEMS };
}

export function hasRichResponse(content) {
  return Boolean(content && (content.links.length || content.images.length || content.items.length));
}
