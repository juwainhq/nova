// Browserless specification checks: the real React-rendered avatar markup plus the
// real state, keyframe and palette rules that draw it. This is structural validation
// of the stylesheet, not a visual audition in a browser.
//   node scripts/verify-avatar.mjs
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = process.cwd();
const checks = [];
function check(label, ok, detail = '') { checks.push({ label, ok: Boolean(ok), detail }); }
const near = (a, b, tolerance = .0001) => Number.isFinite(a) && Math.abs(a - b) < tolerance;
// Only ever fed a validated arithmetic string, so no expression can escape to code.
const arith = (expr) => (/^[\d.\s/*()+-]+$/.test(expr.trim()) ? Number(Function(`"use strict";return (${expr})`)()) : NaN);

async function renderAvatar() {
  const result = await build({
    stdin: {
      contents: `
        import { createElement } from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import RobotAvatar from './src/RobotAvatar.jsx';
        process.stdout.write(renderToStaticMarkup(createElement(RobotAvatar)));
      `,
      resolveDir: root,
      loader: 'jsx',
    },
    bundle: true,
    write: false,
    platform: 'node',
    // CJS lets bundled react-dom/server require Node builtins from the temp probe.
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'warning',
  });
  const directory = await mkdtemp(join(tmpdir(), 'nova-avatar-'));
  try {
    const file = join(directory, 'probe.cjs');
    await writeFile(file, result.outputFiles[0].text, 'utf8');
    return (await run(process.execPath, [file], { cwd: root })).stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const markup = await renderAvatar();
const css = await readFile(resolve(root, 'src/index.css'), 'utf8');
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');

// Tiny markup reader: inspect real parent/child relationships and attributes rather
// than source constants or JSX ordering. No DOM package or browser is required.
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const tree = { tag: 'root', children: [] };
const stack = [tree];
for (const [tag] of markup.matchAll(/<[^>]+>/g)) {
  if (tag.startsWith('</')) { stack.pop(); continue; }
  const node = { tag: /^<([\w]+)/.exec(tag)?.[1], attrs: attrs(tag), children: [] };
  stack.at(-1).children.push(node);
  if (!tag.endsWith('/>')) stack.push(node);
}
const nodes = (node = tree) => [node, ...node.children.flatMap((child) => nodes(child))];
const hasClass = (node, name) => node?.attrs?.class?.split(' ').includes(name);
const byClass = (name) => nodes().filter((node) => hasClass(node, name));
const avatar = tree.children[0];
const eyes = byClass('robot-eye');
const gaze = byClass('eyes-gaze')[0];
const blink = byClass('eyes-blink')[0];
const voice = byClass('eyes-voice')[0];

// Read balanced CSS blocks so default rules can compose while media overrides stay
// reachable, and so a shared selector list split across lines is still caught.
function blocks(code) {
  const result = [];
  for (let cursor = 0; cursor < code.length;) {
    const open = code.indexOf('{', cursor);
    if (open < 0) break;
    let end = open + 1, depth = 1;
    while (end < code.length && depth) {
      if (code[end] === '{') depth += 1;
      if (code[end] === '}') depth -= 1;
      end += 1;
    }
    result.push({ header: code.slice(cursor, open).trim(), body: code.slice(open + 1, end - 1) });
    cursor = end;
  }
  return result;
}
const cssBlocks = blocks(cssCode);
const styleRules = [];
function collectRules(items, media = '') {
  for (const { header, body } of items) {
    if (/^@media/.test(header)) collectRules(blocks(body), header.replace(/^@media\s*/, ''));
    else if (!header.startsWith('@')) styleRules.push({ selectors: header.split(',').map((part) => part.trim()), body, media });
  }
}
collectRules(cssBlocks);
const rule = (selector) => styleRules.filter(({ selectors, media }) => !media && selectors.includes(selector))
  .map(({ body }) => body).join(';');
const property = (body, name) => [...body.matchAll(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'g'))].at(-1)?.[1]?.trim() ?? '';
const value = (selector, name) => property(rule(selector), name);
const animation = (selector) => value(selector, 'animation');
function keyframes(name) {
  const body = cssBlocks.find(({ header }) => header === `@keyframes ${name}`)?.body ?? '';
  const at = (time) => (time.trim() === 'from' ? 0 : time.trim() === 'to' ? 100 : parseFloat(time));
  return blocks(body).flatMap(({ header, body }) => header.split(',').map((time) => ({ at: at(time), body })))
    .sort((a, b) => a.at - b.at);
}
const transformAt = (frames, at) => property(frames.find((frame) => frame.at === at)?.body ?? '', 'transform');
const avatarRules = styleRules.filter(({ selectors }) => selectors.some((selector) => /\.?(?:robot-avatar|avatar-container|avatar-figure|avatar-blob|avatar-glow|listen-ring|eyes-|robot-eye)/.test(selector)));
const eyeRules = styleRules.filter(({ selectors }) => selectors.some((selector) => /(?:^|\.)(?:eyes-|robot-eye)/.test(selector)));
// Every --avatar-size declaration in the file, in source order: the default first,
// then one per compact viewport.
const sizes = styleRules.filter(({ selectors }) => selectors.includes('.avatar-container'))
  .map(({ body }) => parseFloat(property(body, '--avatar-size'))).filter(Number.isFinite);
// A `calc(var(--avatar-size) * …)` value resolved to CSS pixels at a given size.
const sizeRatio = (declaration) => {
  const match = /^calc\(var\(--avatar-size\) \* ([\d.\s/*()+-]+)\)$/.exec(declaration);
  return match ? arith(match[1]) : NaN;
};

// ---------------------------------------------------------------- structure & palette
check('renders a div face with a lowercase aria-label, and no SVG or image asset', avatar?.tag === 'div' && hasClass(avatar, 'robot-avatar')
  && avatar.attrs.role === 'img' && avatar.attrs['aria-label']?.startsWith('NOVA,') && !/<svg|<img|url\(/.test(markup)
  && Object.keys(avatar.attrs).filter((name) => /^aria-/i.test(name)).every((name) => name === name.toLowerCase()));
check('one organic body, no mouth, no stroke, no old orb layers', byClass('avatar-blob').length === 1 && !/mouth|smile|grin/i.test(markup + cssCode)
  && !/orb-|blob-shape|eye-iris|eye-crescent|eye-well/i.test(markup + cssCode));
check('the body is a flat surface with a morphing radius and no border or shadow', /border-radius:\s*46% 54%/.test(rule('.avatar-blob'))
  && value('.avatar-blob', 'background') === 'var(--surface)' && !/(?:^|;)\s*(?:border|box-shadow|filter):/.test(rule('.avatar-blob'))
  && animation('.avatar-blob') === 'blob-morph 16s ease-in-out infinite');
check('exactly one glow exists, it is radial, and it sits behind the face', value('.avatar-glow', 'background').startsWith('radial-gradient(')
  && value('.avatar-glow', 'z-index') === '-1' && (cssCode.match(/gradient\(/g) || []).length === 1
  && !/conic-gradient|linear-gradient/.test(cssCode));
check('the eyes are the only expressive element: two pure-white ovals', eyes.length === 2 && hasClass(eyes[0], 'robot-eye-left') && hasClass(eyes[1], 'robot-eye-right')
  && eyes.every((node) => node.tag === 'span' && !node.attrs.class.includes('robot-eye-left robot-eye-right'))
  && value('.robot-eye', 'background') === 'var(--eye, #ffffff)' && !eyes.some((node) => node.attrs.style));
check('both eyes are identical markup under one shared gaze > blink > rhythm pair', eyes.length === 2
  && eyes[0].tag === eyes[1].tag && JSON.stringify(eyes[0].attrs.style) === JSON.stringify(eyes[1].attrs.style)
  && eyes[0].attrs.class.replace('left', 'x') === eyes[1].attrs.class.replace('right', 'x') && eyes.every((node) => !node.children.length)
  && byClass('eyes-gaze').length === 1 && byClass('eyes-blink').length === 1 && byClass('eyes-voice').length === 1
  && gaze?.children[0] === blink && blink?.children[0] === voice && voice?.children.length === 2
  && voice.children.every((node) => hasClass(node, 'robot-eye')));
check('no side-specific, staggered or nth-child eye styles', eyeRules.every(({ selectors, body }) => selectors.every((selector) => !/robot-eye-(?:left|right)|nth-|first-child|last-child/.test(selector)))
  && !/animation-delay/.test(eyeRules.map(({ body }) => body).join(';')));
check('nothing in the avatar rotates, skews or uses perspective', ![...avatarRules.map(({ body }) => body), markup, ...keyframes('avatar-float').map(({ body }) => body),
  ...keyframes('avatar-hop').map(({ body }) => body), ...keyframes('eye-blink').map(({ body }) => body)]
  .join(';').match(/rotate|skew|perspective/));
check('no spinner, ring-of-dots or neon treatment anywhere', !/spinner|\.spin|ring-of|360deg|neon|glow-ring|tech-grid|grid-lines/i.test(cssCode)
  && !/backdrop-filter|text-shadow/.test(cssCode));
check('every shadow is a flat focus ring, never a drop shadow', [...cssCode.matchAll(/box-shadow:\s*([^;}]+)/g)].every((m) => /^(?:none|0 0 0 \d+px rgba\()/.test(m[1].trim())),
  [...cssCode.matchAll(/box-shadow:\s*([^;}]+)/g)].map((m) => m[1].trim()).join(' | '));
check('the palette is the five approved colours', value(':root', '--bg') === '#0f0d0b' && value(':root', '--surface') === '#1a1612'
  && value(':root', '--line') === '#2a2420' && value(':root', '--ink') === '#f5f0eb' && value(':root', '--muted') === '#9c8f85'
  && value(':root', '--accent') === '#f97316' && value(':root', '--eye') === '#ffffff');
check('the old multi-tone palette is gone from the source', !/#f5c99a|#ff6a1a|#cc4400|#fff7ef|#ab9582|--cream|--orange|--burnt|--dark\b/.test(css));

// ---------------------------------------------------------------- true CSS-pixel geometry
const boxSize = parseFloat(value('.avatar-container', '--avatar-size'));
const [eyeWFrac, eyeHFrac] = ['--eye-w', '--eye-h'].map((name) => sizeRatio(value('.robot-avatar', name)));
const gapFrac = sizeRatio(value('.robot-avatar', '--eye-gap'));
check(`default avatar is ${180}px with a width and height that both read the variable`, boxSize === 180
  && value('.robot-avatar', 'width') === 'var(--avatar-size, 180px)' && value('.robot-avatar', 'height') === 'var(--avatar-size, 180px)');
check('eyes are 22 × 34 CSS pixels at the default size, taller than wide', value('.robot-eye', 'width') === 'var(--eye-w)' && value('.robot-eye', 'height') === 'var(--eye-h)'
  && near(boxSize * eyeWFrac, 22) && near(boxSize * eyeHFrac, 34) && eyeHFrac > eyeWFrac,
  `${(boxSize * eyeWFrac).toFixed(2)} × ${(boxSize * eyeHFrac).toFixed(2)}px`);
check('the pair has a 24px inner gap and is centred by flex, not by margins', value('.eyes-voice', 'gap') === 'var(--eye-gap)' && near(boxSize * gapFrac, 24)
  && value('.eyes-voice', 'display') === 'flex' && value('.eyes-voice', 'justify-content') === ''
  && !/margin/.test(rule('.robot-eye')));
const liftFrac = -sizeRatio(value('.eyes-gaze', 'transform').match(/translateY\((.*)\)/)?.[1] ?? '');
check('the pair sits on the centre line, lifted 6 CSS pixels', value('.eyes-gaze', 'display') === 'grid'
  && value('.eyes-gaze', 'place-items') === 'center' && near(liftFrac, 1 / 30) && near(boxSize * liftFrac, 6),
  `lifted ${(boxSize * liftFrac).toFixed(2)}px at ${boxSize}px`);
check('oval, not capsule: the eye radius is 50% in both axes', value('.robot-eye', 'border-radius') === '50%' && !/rx=/.test(markup));
check('eye geometry is defined once, so compact viewports scale it for free', styleRules.filter(({ body }) => property(body, '--eye-w')).length === 1
  && /--eye-w:\s*calc\(var\(--avatar-size\) \* 11 \/ 90\)/.test(rule('.robot-avatar'))
  && /--eye-h:\s*calc\(var\(--avatar-size\) \* 17 \/ 90\)/.test(rule('.robot-avatar'))
  && eyes.every((node) => !node.attrs.style));
check('equal margins keep the pair inside the body at every size', sizes.every((size) => {
  const pairWidth = size * (2 * eyeWFrac + gapFrac);
  const pairHeight = size * eyeHFrac;
  return (size - pairWidth) / 2 >= size * .15 && (size - pairHeight) / 2 >= size * .2 && pairWidth < size && pairHeight < size;
}), `pair ${(boxSize * (2 * eyeWFrac + gapFrac)).toFixed(1)} × ${(boxSize * eyeHFrac).toFixed(1)}px inside ${boxSize}px`);

// ---------------------------------------------------------------- the ring and the glow
const ringFrac = sizeRatio(value('.listen-ring', 'width'));
const glowFrac = sizeRatio(value('.avatar-glow', 'width'));
check('the ring is a hairline circle at exactly 1.5x the avatar, hidden while idle', near(ringFrac, 1.5)
  && value('.listen-ring', 'height') === value('.listen-ring', 'width') && value('.listen-ring', 'border') === '1px solid rgba(249, 115, 22, .42)'
  && value('.listen-ring', 'opacity') === '0' && !value('.listen-ring', 'box-shadow') && !value('.listen-ring', 'filter'));
check('the ring stays outside the body at every size', sizes.every((size) => (size * ringFrac - size) / 2 > size * .04 + 10),
  sizes.map((size) => `${size}px: +${((size * ringFrac - size) / 2).toFixed(1)}px`).join(', '));
check('the container clears the ring, the hop and the speaking swell', value('.avatar-container', 'width') === value('.avatar-container', 'height')
  && (() => {
    const box = value('.avatar-container', 'width');
    const match = /^calc\(var\(--avatar-size\) \* 1\.5 \+ 40px\)$/.exec(box);
    return Boolean(match) && sizes.every((size) => {
      const container = size * 1.5 + 40;
      return (container - size * 1.5 * 1.03) / 2 > 1 && (container / 2 - size * 1.04 / 2) > 12;
    });
  })(), `container = 1.5 × size + 40px`);
check('the glow is wider than the ring and softer than a halo', near(glowFrac, 1.9) && value('.avatar-glow', 'height') === value('.avatar-glow', 'width')
  && sizes.every((size) => size * glowFrac >= size * ringFrac), `glow ${(boxSize * glowFrac).toFixed(0)}px`);
check('the glow never uses a filter or a blur: it is one gradient stop set', !/filter|blur/.test(rule('.avatar-glow')));

// ---------------------------------------------------------------- state transitions
const durations = avatarRules.flatMap(({ body }) => [...body.matchAll(/transition:\s*([^;}]+)/g)].map((m) => m[1]))
  .flatMap((declaration) => [...declaration.matchAll(/[\d.]+m?s/g)].map((m) => m[0]));
check('every avatar state change eases over exactly 300ms', durations.length >= 7 && durations.every((duration) => duration === '300ms'), `${durations.length} transitions`);
check('the avatar rules name ease-out, never a bounce or spring', avatarRules.every(({ body }) => !/cubic-bezier|ease-in-out!,/.test(body))
  && [...rule('.avatar-figure').matchAll(/transition:[^;]+/g)].every((m) => /ease-out/.test(m[0])));
check('body pose and animated rhythm are on separate elements', value('.avatar-figure', 'transform') === 'scale(var(--figure-scale, 1))'
  && !animation('.avatar-figure') && !value('.avatar-blob', '--figure-scale') && /animation:\s*avatar-float/.test(rule('.robot-avatar')));
const entranceFrames = blocks(cssBlocks.find(({ header }) => header === '@keyframes fade-in')?.body ?? '');
check('entrance: 400ms opacity-only fade cannot overshoot the speaking scale', animation('.avatar-container') === 'fade-in .4s ease-in-out both'
  && entranceFrames.length === 2 && entranceFrames.every(({ body }) => !property(body, 'transform'))
  && entranceFrames.map(({ body }) => property(body, 'opacity')).join(' ') === '0 1');

// ---------------------------------------------------------------- idle life
check('idle: the body drifts 4px on a 6s clock with ease-in-out', animation('.robot-avatar') === 'avatar-float 6s ease-in-out infinite');
const floatFrames = keyframes('avatar-float');
check('idle: drift travels exactly 0 → −4px → 0 on Y', transformAt(floatFrames, 0) === 'translateY(0)'
  && transformAt(floatFrames, 50) === 'translateY(-4px)' && transformAt(floatFrames, 100) === 'translateY(0)');
check('idle: the radius morphs slowly on three distinct organic shapes', (() => {
  const frames = keyframes('blob-morph');
  const radii = frames.map(({ body }) => property(body, 'border-radius')).filter(Boolean);
  return frames.length === 4 && radii.length === 4 && new Set(radii).size === 3 && near(frames[0].at, 0) && near(frames.at(-1).at, 100)
    && frames.every(({ body }) => !/transform|scale|rotate/.test(body));
})(), keyframes('blob-morph').map(({ at, body }) => `${at}% ${property(body, 'border-radius')}`).join(' / '));
check('idle: uneven radii never form a circle or a square', (() => {
  const shapes = keyframes('blob-morph').map(({ body }) => property(body, 'border-radius').match(/[\d.]+%/g)?.map(parseFloat) ?? []);
  // Four horizontal and four vertical radii per shape: unequal, so it is never a
  // circle (all equal), an ellipse (pairs equal) or a rounded rectangle (0%/100%).
  return shapes.length === 4 && shapes.every((numbers) => numbers.length === 8 && new Set(numbers).size >= 3
    && numbers.every((n) => n > 38 && n < 62));
})());
check('idle: one shared blink every 4s', animation('.eyes-blink') === 'eye-blink 4s ease-in-out infinite');
const blinkFrames = keyframes('eye-blink');
const closed = blinkFrames.find((frame) => frame.at === 97.5);
const closedScale = Number(/scaleY\(([\d.]+)\)/.exec(property(closed?.body ?? '', 'transform'))?.[1]);
check('blink: 34px → 2.72px → 34px, both eyes together', near(boxSize * eyeHFrac * closedScale, 34 * .08)
  && [0, 95, 100].every((at) => transformAt(blinkFrames, at) === 'scaleY(1)'));
check('blink: close/open takes exactly 200ms, centred at the end of the cycle', blinkFrames.map((frame) => frame.at).join(' ') === '0 95 97.5 100'
  && near((100 - 95) / 100 * 4000, 200) && near((97.5 - 95) / 100 * 4000, 100));
check('eye animation never introduces rotation, skew or a second scale', ['eye-blink', 'eyes-voice'].every((name) => keyframes(name).length
  && keyframes(name).every(({ body }) => !/rotate|skew/.test(body))) && !/scale/.test(keyframes('eyes-voice').map(({ body }) => body).join(';')));

// ---------------------------------------------------------------- listening
check('listening: only the ring appears, so the face itself never changes pose', value('.is-listening .listen-ring', 'opacity') === '1'
  && animation('.is-listening .listen-ring') === 'ring-breathe 3.2s ease-in-out infinite' && !styleRules.some(({ selectors }) => selectors.includes('.is-listening')));
check('listening: the ring breathes by 3% and never travels', (() => {
  const frames = keyframes('ring-breathe');
  return frames.length === 3 && /scale\(1\)$/.test(transformAt(frames, 0)) && /scale\(1\.03\)$/.test(transformAt(frames, 50))
    && /scale\(1\)$/.test(transformAt(frames, 100)) && frames.every(({ body }) => !/opacity|translateY\([^0]/.test(body));
})());
check('listening: the ring fades in and out instead of switching', /opacity 300ms ease-out/.test(rule('.listen-ring')));

// ---------------------------------------------------------------- thinking
const eyeShift = arith(/--eye-shift:\s*([\d./\s*()+-]+)/.exec(gaze?.attrs.style ?? '')?.[1] ?? 'NaN');
check('thinking: both eyes drop to exactly 10 CSS pixels below the centre line', value('.is-thinking .eyes-gaze', 'transform') === 'translateY(calc(var(--avatar-size) * var(--eye-shift, 0)))'
  && near(eyeShift, 1 / 18) && near(boxSize * eyeShift, 10), `${(boxSize * eyeShift).toFixed(2)}px at the default size`);
const gazeVars = [...new Set([...value('.is-thinking .eyes-gaze', 'transform').matchAll(/var\((--[\w-]+)[,)]/g)].map((m) => m[1]))];
check('thinking: the pose reads exactly the variables the gaze element owns', gazeVars.length === 2 && gazeVars.includes('--eye-shift') && gazeVars.includes('--avatar-size')
  && (gaze?.attrs.style ?? '').includes('--eye-shift:') && Number.isFinite(eyeShift) && eyeShift > 0
  && !/\btranslateX\b|rotate|skew/.test(value('.is-thinking .eyes-gaze', 'transform')));
check('thinking: the pair squints to 60% together, with no side-specific rule', value('.is-thinking .robot-eye', 'transform') === 'scaleY(.6)'
  && value('.eyes-gaze', 'transition') === 'transform 300ms ease-out' && !value('.is-thinking', '--eye-sx'));
check('thinking: the body draws in 1% and stays unscaled by audio', value('.is-thinking .avatar-figure', '--figure-scale') === '.99'
  && !animation('.is-thinking .robot-avatar') && !styleRules.some(({ selectors }) => selectors.includes('.is-thinking .eyes-blink')));

// ---------------------------------------------------------------- speaking
check('speaking: the scale is clamped strictly to 100–104% of live audio data', value('.is-speaking .avatar-figure', '--figure-scale') === 'calc(1 + clamp(0, var(--audio-pulse, 0), 1) * .04)');
check('speaking: the pulse is not also animated, so a silent stream cannot drift', !animation('.is-speaking .avatar-figure') && !value('.is-speaking', '--audio-pulse'));
check('speaking: quick gentle Y bounces never add extra scale', animation('.is-speaking .eyes-voice') === 'eyes-voice .5s ease-in-out infinite'
  && transformAt(keyframes('eyes-voice'), 0) === 'translateY(0)' && transformAt(keyframes('eyes-voice'), 50) === 'translateY(-2px)'
  && keyframes('eyes-voice').every(({ body }) => !/scale|rotate/.test(body)));
check('speaking: the morph and blink clocks keep running, never a second pair', !animation('.is-speaking .eyes-blink') && !animation('.is-speaking .avatar-blob')
  && !/eye-blink-rapid/.test(cssCode) && !value('.is-speaking', '--eye-sy'));

// ---------------------------------------------------------------- happy / wake / offline
for (const state of ['is-happy', 'is-waking']) {
  check(`${state}: both eyes squash to the same 42% and the blink clock stops`, value(`.${state} .robot-eye`, 'transform') === 'scaleY(.42)'
    && animation(`.${state} .eyes-blink`) === 'none' && !value(`.${state}`, '--eye-sx'));
  check(`${state}: one 800ms double bounce, not infinite hops`, animation(`.${state} .robot-avatar`) === 'avatar-hop .8s ease-in-out both'
    && value(`.${state} .avatar-figure`, '--figure-scale') === '1');
}
const hopFrames = keyframes('avatar-hop');
check('double bounce: exactly two peaks with grounded landings', hopFrames.length === 6
  && [0, 40, 80, 100].every((at) => transformAt(hopFrames, at) === 'translateY(0)')
  && transformAt(hopFrames, 20) === 'translateY(-9px)' && transformAt(hopFrames, 60) === 'translateY(-4px)');
check('offline: the face recaves evenly, with no amber anywhere', value('.is-offline .robot-eye', 'opacity') === '.42' && value('.is-offline .avatar-blob', 'background') === '#161311'
  && value('.is-offline .avatar-figure', '--figure-scale') === '.97'
  && !/249, 115, 22|--accent|#f97316/.test(styleRules.filter(({ selectors }) => selectors.some((s) => s.includes('is-offline'))).map(({ body }) => body).join(';')));
check('offline: the glow dims instead of adding a mood effect', value('.is-offline .avatar-glow', 'opacity') === '.4' && !animation('.is-offline .robot-avatar'));

// ---------------------------------------------------------------- sizing & motion hygiene
check('compact sizes reuse the coupled variable, no stale pixel overrides', sizes.join(' ') === '180 160 152 140 120 104', sizes.join(' '));
check('the only avatar size declared in CSS is --avatar-size', styleRules.filter(({ body }) => /(?:^|;)\s*width:\s*180px/.test(body)).length === 0
  && value('.robot-avatar', 'width').startsWith('var(--avatar-size'));
check('no mouth selectors, gradients or obsolete animations remain in the avatar CSS', !/\.mouth-|\.orb-smile|orb-wobble|orb-happy-hop|eye-drift|eye-tilt|eye-well|eyeWell|orbBloom/.test(cssCode)
  && !/gradient/.test([rule('.avatar-blob'), rule('.robot-eye'), rule('.eyes-gaze'), rule('.listen-ring')].join(';')));
const reduced = cssCode.slice(cssCode.indexOf('@media (prefers-reduced-motion: reduce)'));
check('reduced motion disables float, morph, gaze, blink and voice rhythm', /\.avatar-container, \.robot-avatar, \.avatar-blob, \.eyes-gaze, \.eyes-blink, \.eyes-voice\s*\{[^}]*animation: none !important; transform: none;/.test(reduced));
check('reduced motion suppresses the thinking drop, the swell and the ring', /\.is-thinking \.eyes-gaze \{ transform: none !important; \}/.test(reduced)
  && /\.avatar-figure \{ --figure-scale: 1 !important; \}/.test(reduced) && /\.listen-ring\s*\{[^}]*opacity: 0;/.test(reduced));
check('the layout stays a single centred column', value('.assistant-stage', 'flex-direction') === 'column'
  && value('.assistant-stage', 'align-items') === 'center' && value('.assistant-stage', 'justify-content') === 'center'
  && value('.main-stage', 'align-items') === 'center');
check('status text sits above the avatar in small caps amber', /font-variant-caps:\s*all-small-caps/.test(rule('.status-word'))
  && value('.status-word', 'color') === 'var(--accent)' && !/text-align:\s*left/.test(rule('.status-word')));
check('NOVA\'s words are floating text: 480px measure, no bubble, no background', value('.tagline', 'max-width') === '480px'
  && !/(?:^|;)\s*(?:background|border):/.test(rule('.tagline')) && value('.tagline', 'animation') === 'text-in .4s ease-out both'
  && keyframes('text-in').length === 2 && transformAt(keyframes('text-in'), 0) === 'translateY(8px)'
  && property(keyframes('text-in').find((f) => f.at === 100)?.body ?? '', 'opacity') === '1');
check('the header bar is gone; only a tiny all-caps label remains', value('.topbar', 'justify-content') === 'center'
  && !/background|border-bottom/.test(rule('.topbar')) && value('.brand-name', 'text-transform') === 'uppercase'
  && parseFloat(value('.brand-name', 'font-size')) <= 12);

// ---------------------------------------------------------------- real-CSS state sheet
const STATES = [
  ['idle', 'IDLE', '22 × 34px white ovals · 4s blink / 200ms · 16s radius morph'],
  ['is-listening', 'LISTENING', 'hairline amber ring at 1.5x, breathing · nothing else changes'],
  ['is-thinking', 'THINKING', 'eyes drop 10px and squint to 60% · body 99%'],
  ['is-speaking', 'SPEAKING', 'body 100–104% from live word data · gentle 2px bounce'],
  ['is-happy', 'HAPPY', 'both eyes squash to 42% · one 800ms double bounce'],
  ['is-listening is-waking', 'WAKE', '800ms double jump, then settles into listening'],
  ['is-offline', 'OFFLINE', 'eyes at 42% opacity · flatter body · dimmer glow'],
];
const cellMarkup = () => markup; // No SVG ids left to namespace; each cell owns its copy.
const sheet = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NOVA — avatar states</title>
    <style>
${css}
      body { margin: 0; padding: 34px 26px 44px; background: #0f0d0b; }
      .sheet-head { max-width: 1080px; margin: 0 auto 26px; }
      .sheet-head h1 { margin: 0; color: #f5f0eb; font-size: 19px; font-weight: 500; letter-spacing: -.02em; }
      .sheet-head p { margin: 7px 0 0; color: #9c8f85; font-size: 12px; line-height: 1.6; }
      .sheet-head button { margin-top: 10px; padding: 7px 12px; color: #f5f0eb; background: #1a1612; border: 1px solid #2a2420; border-radius: 999px; cursor: pointer; }
      .sheet { display: grid; gap: 14px; max-width: 1080px; margin: 0 auto; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
      .cell { display: flex; flex-direction: column; align-items: center; padding: 18px 12px 16px; border: 1px solid #2a2420; border-radius: 14px; background: #0f0d0b; }
      .cell .avatar-container { animation: none; }
      .cell-label { margin-top: 10px; color: #9c8f85; font: 10px var(--mono); letter-spacing: .18em; }
      .cell-note { margin-top: 6px; color: #9c8f85; font-size: 11px; line-height: 1.5; text-align: center; }
    </style>
  </head>
  <body>
    <div class="sheet-head">
      <h1>NOVA — avatar states</h1>
      <p>Real stylesheet and React-rendered markup. No microphone, model or audio is used here.
      Speaking holds a sample pulse of .8; real NOVA receives word-boundary events instead.
      Happy and wake jump once. Wake then settles into listening after 800ms.
      Dimensions are at the default 180px size; the compact tables scale the whole face.</p>
      <button type="button" id="replay">Replay happy / wake</button>
    </div>
    <div class="sheet">
${STATES.map(([className, label, note]) => `      <div class="cell">
        <div class="avatar-container ${className}"${label === 'SPEAKING' ? ' style="--audio-pulse: .8"' : ''}${label === 'WAKE' ? ' id="wake-preview"' : ''}>
          <div class="avatar-glow" aria-hidden="true"></div>
          <div class="listen-ring" aria-hidden="true"></div>
          <div class="avatar-figure">${cellMarkup()}</div>
        </div>
        <div class="cell-label">${label}</div>
        <div class="cell-note">${note}</div>
      </div>`).join('\n')}
    </div>
    <script>
      const happy = document.querySelector('.is-happy');
      const wake = document.getElementById('wake-preview');
      let wakeTimer;
      function replay() {
        clearTimeout(wakeTimer);
        happy.classList.remove('is-happy');
        wake.classList.remove('is-waking');
        void happy.offsetWidth;
        happy.classList.add('is-happy');
        wake.classList.add('is-waking');
        wakeTimer = setTimeout(() => wake.classList.remove('is-waking'), 800);
      }
      document.getElementById('replay').addEventListener('click', replay);
      wakeTimer = setTimeout(() => wake.classList.remove('is-waking'), 800);
    </script>
  </body>
</html>
`;
check('state sheet renders every real state from the same markup', sheet.includes(css)
  && STATES.every(([className, label]) => sheet.includes(`class="avatar-container ${className}"`) && sheet.includes(`<div class="cell-label">${label}</div>`))
  && (sheet.match(/class="avatar-blob"/g) || []).length === STATES.length);
const sheetIDs = [...sheet.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
check('state sheet keeps unique ids and no dangling url() references', sheetIDs.length === new Set(sheetIDs).size && !/url\(#/.test(sheet));

for (const { label, ok, detail } of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
const failed = checks.filter(({ ok }) => !ok).length;
console.log(failed ? `\n${failed} check(s) failed.` : `\nAll ${checks.length} checks passed.`);
if (failed) process.exitCode = 1;
else {
  await writeFile(resolve(root, 'avatar-states.html'), sheet, 'utf8');
  console.log('Wrote avatar-states.html — open it to review the states and replay happy / wake.');
}
