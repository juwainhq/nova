// Browserless specification checks: real React-rendered SVG geometry plus the
// real state/keyframe rules. This is structural validation, not a visual audition.
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

// Tiny SVG tree reader: inspect real parent/child relationships and attributes,
// not source constants or JSX ordering. No DOM package or browser is required.
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
const svg = tree.children[0];
const eyeGroups = byClass('robot-eye');
const irises = byClass('eye-iris');
const crescents = byClass('eye-crescent');
const gaze = byClass('eyes-gaze')[0];
const blink = byClass('eyes-blink')[0];
const voice = byClass('eyes-voice')[0];

// Read balanced CSS blocks so default rules can compose while media overrides
// remain separate. This also catches rules split across a shared selector list.
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
function collectRules(items, conditional = false) {
  for (const { header, body } of items) {
    if (/^@media/.test(header)) collectRules(blocks(body), true);
    else if (!header.startsWith('@')) styleRules.push({ selectors: header.split(',').map((part) => part.trim()), body, conditional });
  }
}
collectRules(cssBlocks);
const rule = (selector) => styleRules.filter(({ selectors, conditional }) => !conditional && selectors.includes(selector))
  .map(({ body }) => body).join(';');
const property = (body, name) => [...body.matchAll(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'g'))].at(-1)?.[1]?.trim() ?? '';
const value = (selector, name) => property(rule(selector), name);
const animation = (selector) => value(selector, 'animation');
function keyframes(name) {
  const body = cssBlocks.find(({ header }) => header === `@keyframes ${name}`)?.body ?? '';
  return blocks(body).flatMap(({ header, body }) => header.split(',').map((time) => ({ at: parseFloat(time), body })))
    .sort((a, b) => a.at - b.at);
}
const transformAt = (frames, at) => property(frames.find((frame) => frame.at === at)?.body ?? '', 'transform');
const poseRules = styleRules.filter(({ selectors }) => selectors.some((selector) => /\.(?:eye-|eyes-|robot-eye)/.test(selector)));

// ---------------------------------------------------------------- SVG & symmetry
check('renders an accessible SVG with lowercase aria-label', svg?.tag === 'svg' && svg.attrs.role === 'img'
  && svg.attrs['aria-label']?.startsWith('NOVA,')
  && Object.keys(svg.attrs).filter((name) => /^aria-/i.test(name)).every((name) => name === name.toLowerCase()));
check('keeps the mouthless orb body and bloom', byClass('blob-shape').length === 1 && byClass('orb-bloom').length === 1 && !/mouth/i.test(markup));
check('has exactly two named eyes', eyeGroups.length === 2 && hasClass(eyeGroups[0], 'robot-eye-left') && hasClass(eyeGroups[1], 'robot-eye-right'));
check('both base eyes restore the SVG capsule silhouette with semicircular ends', irises.length === 2 && irises.every((node) =>
  node.tag === 'rect' && near(Number(node.attrs.rx), Number(node.attrs.width) / 2)
  && near(Number(node.attrs.ry), Number(node.attrs.rx)) && Number(node.attrs.height) > Number(node.attrs.width)));
check('both eyes have identical shape, paint and pose children', eyeGroups.length === 2
  && JSON.stringify(eyeGroups[0].children) === JSON.stringify(eyeGroups[1].children));
check('one shared gaze > blink > voice hierarchy contains both eyes', byClass('eyes-gaze').length === 1
  && byClass('eyes-blink').length === 1 && byClass('eyes-voice').length === 1
  && gaze?.children[0] === blink && blink?.children[0] === voice
  && voice?.children.length === 2 && voice.children.every((node) => hasClass(node, 'robot-eye')));
check('each eye has one identical local scale containing capsule and crescent', eyeGroups.length === 2 && eyeGroups.every((node) =>
  node.children.length === 1 && hasClass(node.children[0], 'eye-scale') && node.children[0].children.length === 2));
check('no pupil, gleam, lid, drift or tilt layers remain', !/eye-spark|eye-lid|eye-drift|eye-tilt/.test(markup + cssCode));
check('no eye uses a rotation, skew, stroke or CSS border', eyeGroups.length === 2
  && nodes(voice).every((node) => !/rotate|skew/.test(node.attrs?.transform ?? '') && !node.attrs?.stroke)
  && poseRules.every(({ body }) => !/rotate|skew|(?:^|;)\s*(?:border|perspective)/.test(body)));
check('no side-specific, staggered or nth-child eye styles', poseRules.every(({ selectors, body }) =>
  selectors.every((selector) => !/robot-eye-(?:left|right)|nth-|first-child|last-child/.test(selector))
  && !/animation-delay|--eye-blink/.test(body)));
check('local eye pivot is fixed at zero in view-box coordinates', value('.eye-scale', 'transform-box') === 'view-box'
  && value('.eye-scale', 'transform-origin') === '0 0');

// ---------------------------------------------------------------- true CSS-pixel geometry
const viewBox = svg?.attrs.viewBox?.split(' ').map(Number) ?? [];
const boxSize = parseFloat(value('.avatar-container', '--avatar-size'));
const unit = boxSize / viewBox[2];
const eyes = eyeGroups.map((node, i) => {
  const match = /^translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)$/.exec(node.attrs.transform ?? '');
  const shape = irises[i]?.attrs ?? {};
  const scale = match ? +match[3] : NaN;
  return {
    scale,
    x: ((match ? +match[1] : NaN) + (Number(shape.x) + Number(shape.width) / 2) * scale) * unit,
    y: ((match ? +match[2] : NaN) + (Number(shape.y) + Number(shape.height) / 2) * scale) * unit,
    w: Number(shape.width) * scale * unit,
    h: Number(shape.height) * scale * unit,
  };
});
const [left = {}, right = {}] = eyes;
const orbWidth = boxSize * 222 / 280;
const innerGap = right.x - right.w / 2 - (left.x + left.w / 2);
const margins = [left.x - left.w / 2 - 29 * unit, 251 * unit - (right.x + right.w / 2)];
check('default avatar is 160px with an unchanged 280-square viewBox', boxSize === 160 && viewBox.join(' ') === '0 0 280 280');
check('SVG CSS box inherits the same size in both dimensions', value('.robot-avatar', 'width') === 'var(--avatar-size, 160px)'
  && value('.robot-avatar', 'height') === 'var(--avatar-size, 160px)');
check('both capsules keep the exact 28px × 42px on-screen size', eyes.length === 2 && eyes.every((eye) => near(eye.w, 28) && near(eye.h, 42)),
  eyes.map((eye) => `${eye.w}×${eye.h}px`).join(' / '));
check('conversion from local pixels to SVG units is uniform', eyes.length === 2 && eyes.every((eye) => near(eye.scale, 280 / 160)));
check('capsule centers stay at local zero, not bounding-box dependent', irises.length === 2 && irises.every(({ attrs: shape }) =>
  near(Number(shape.x) + Number(shape.width) / 2, 0) && near(Number(shape.y) + Number(shape.height) / 2, 0)));
check('pair has an exact 18px inner gap', near(innerGap, 18), `${innerGap}px`);
check('pair is perfectly centered with matching vertical centers', near((left.x + right.x) / 2, boxSize / 2) && near(left.y, right.y));
check('eyes are in the upper half at y=60px', eyes.length === 2 && eyes.every((eye) => near(eye.y, 60) && eye.y < boxSize / 2));
check('equal cheek margins keep the pair away from the rim', near(margins[0], margins[1]) && Math.min(...margins) >= orbWidth * .15);
check('blink pivot is the shared pair center, not either eye', blink?.attrs.style === 'transform-origin:140px 105px'
  && value('.eyes-blink', 'transform-box') === 'view-box');

// ---------------------------------------------------------------- neutral radial well
const well = nodes().find((node) => node.attrs?.id === 'eyeWell');
const stops = well?.children ?? [];
const shades = stops.map((node) => node.attrs['stop-color']);
check('eye well is a centered radial gradient, not the old linear fill', well?.tag === 'radialGradient'
  && well.attrs.cx === '.5' && well.attrs.cy === '.5' && well.attrs.r === '.5' && !well.attrs.gradientTransform);
check('base eye surface is #1a1a1a with a subtle #161616 center', shades.join(' ') === '#161616 #1a1a1a'
  && stops[0]?.attrs.offset === '0' && stops[1]?.attrs.offset === '1');
check('both capsules and crescents share that same fill', [...irises, ...crescents].length === 4
  && [...irises, ...crescents].every((node) => node.attrs.fill === 'url(#eyeWell)'));
check('gradient defaults agree with rendered neutral colors', value('.eye-surface', 'stop-color') === 'var(--eye-color, #1a1a1a)'
  && value('.eye-shade', 'stop-color') === 'var(--eye-shadow, #161616)');
check('no old independent eye glow filter remains', poseRules.every(({ selectors, body }) =>
  selectors.includes('.eyes-voice') || !/drop-shadow|url\(/.test(body)));

// ---------------------------------------------------------------- state transitions & idle
for (const [selector, prop] of [['.avatar-figure', 'transform'], ['.eyes-gaze', 'transform'], ['.eye-scale', 'transform'],
  ['.eye-iris', 'opacity'], ['.eye-crescent', 'opacity'], ['.robot-eye', 'opacity'], ['.eye-surface', 'stop-color'], ['.eye-shade', 'stop-color']]) {
  check(`${selector}: state transitions use 400ms ease-in-out`, value(selector, 'transition') === `${prop} 400ms ease-in-out`);
}
const avatarSelectors = /(?:^|\.)(?:robot-avatar|avatar-figure|avatar-backlight|avatar-container|listen-ring|eyes-gaze|eyes-blink|eyes-voice|eye-scale|eye-iris|eye-crescent|eye-surface|eye-shade|robot-eye)$/;
const transitionDurations = styleRules.filter(({ selectors }) => selectors.some((selector) => avatarSelectors.test(selector)))
  .flatMap(({ body }) => [...body.matchAll(/transition:\s*([^;}]+)/g)].map((match) => match[1]))
  .flatMap((declaration) => [...declaration.matchAll(/\d+(?:\.\d+)?m?s/g)].map((match) => match[0]));
check('every avatar state change eases over 400ms, never a snap', transitionDurations.length >= 10
  && transitionDurations.every((duration) => duration === '400ms'));
check('body pose and animated rhythm are on separate elements', /rotateY\(var\(--figure-y, 0deg\)\) scale\(var\(--figure-scale, 1\)\)/.test(value('.avatar-figure', 'transform'))
  && !value('.avatar-figure', 'animation') && !value('.robot-avatar', '--figure-scale'));
check('body never rotates on Z or applies skew/perspective', styleRules.filter(({ selectors }) => selectors.some((selector) => /\.(?:avatar-figure|robot-avatar|avatar-container)/.test(selector)))
  .every(({ body }) => !/rotate\(|rotateZ|skew|perspective/.test(body)));
const entranceFrames = blocks(cssBlocks.find(({ header }) => header === '@keyframes fade-in')?.body ?? '');
check('entrance: 400ms opacity-only fade cannot overshoot the speaking scale', animation('.avatar-container') === 'fade-in .4s ease-in-out both'
  && entranceFrames.length === 2 && entranceFrames.every(({ body }) => !property(body, 'transform'))
  && entranceFrames.map(({ body }) => property(body, 'opacity')).join(' ') === '0 1');
check('idle: float repeats every 3s with ease-in-out', animation('.robot-avatar') === 'orb-float 3s ease-in-out infinite');
const floatFrames = keyframes('orb-float');
check('idle: body travels exactly 0 → −8px → 0 on Y', transformAt(floatFrames, 0) === 'translateY(0)'
  && transformAt(floatFrames, 50) === 'translateY(-8px)' && transformAt(floatFrames, 100) === 'translateY(0)');
check('idle: one shared blink every 4s', animation('.eyes-blink') === 'eye-blink 4s ease-in-out infinite');
const blinkFrames = keyframes('eye-blink');
const closed = blinkFrames.find((frame) => frame.at === 97.5);
const closedScale = Number(/scaleY\(([\d.]+)\)/.exec(property(closed?.body ?? '', 'transform'))?.[1]);
check('blink: 42px → 4px → 42px, both eyes together', near(left.h * closedScale, 4)
  && [0, 95, 100].every((at) => transformAt(blinkFrames, at) === 'scaleY(1)'));
check('blink: close/open takes exactly 200ms, centered in that window', blinkFrames.map((frame) => frame.at).join(' ') === '0 95 97.5 100'
  && near((100 - 95) / 100 * 4000, 200) && near((97.5 - 95) / 100 * 4000, 100));
check('eye animation never introduces rotation or skew', ['eye-blink', 'eyes-thinking'].every((name) => keyframes(name).length
  && keyframes(name).every(({ body }) => !/rotate|skew/.test(body))));

// ---------------------------------------------------------------- listening
check('listening: both eyes scale to exactly 115%', value('.is-listening', '--eye-sx') === '1.15' && value('.is-listening', '--eye-sy') === '1.15');
check('listening: eye background brightens to #222', value('.is-listening', '--eye-color') === '#222' && value('.is-listening', '--eye-shadow') === '#1e1e1e');
check('listening: body uses rotateY(5deg), never a Z tilt', value('.is-listening .avatar-figure', '--figure-y') === '5deg');
check('listening: no perspective can make the two eyes unequal', !/\bperspective\s*:|perspective\(/.test(cssCode));
check('listening: soft orange pulse ring repeats every 1.5s', animation('.is-listening .listen-ring') === 'listen-pulse 1.5s ease-out infinite'
  && /rgba\(255, 106, 26, \.45\)/.test(value('.listen-ring', 'border')));
const ringFrames = keyframes('listen-pulse');
check('listening: ring expands outward and fades fully', transformAt(ringFrames, 0).endsWith('scale(1)')
  && transformAt(ringFrames, 100).endsWith('scale(1.5)') && property(ringFrames.at(-1)?.body ?? '', 'opacity') === '0');

// ---------------------------------------------------------------- thinking
check('thinking: shared gaze uses a 2.8s ease-in-out cycle', animation('.is-thinking .eyes-gaze') === 'eyes-thinking 2.8s ease-in-out infinite');
const shift = parseFloat(property(gaze?.attrs.style ?? '', '--eye-shift')) * unit;
check('thinking: gaze displacement is exactly 6 CSS pixels', near(shift, 6), `${shift}px at the default size`);
const gazeVars = [...new Set(keyframes('eyes-thinking').flatMap(({ body }) => [...body.matchAll(/var\((--[\w-]+)\)/g)].map((match) => match[1])))];
check('thinking: the keyframes read exactly the variable the gaze element defines', gazeVars.length === 1
  && Boolean(gazeVars[0]) && (gaze?.attrs.style ?? '').includes(`${gazeVars[0]}:`) && Number.isFinite(shift) && shift > 0);
const thinkingFrames = keyframes('eyes-thinking');
const leftFrames = thinkingFrames.filter(({ body }) => property(body, 'transform') === 'translateX(calc(-1 * var(--eye-shift)))');
const rightFrames = thinkingFrames.filter(({ body }) => property(body, 'transform') === 'translateX(var(--eye-shift))');
check('thinking: both sides pause for exactly 800ms', leftFrames.length === 2 && rightFrames.length === 2
  && near((leftFrames[1].at - leftFrames[0].at) * 28, 800)
  && near((rightFrames[1].at - rightFrames[0].at) * 28, 800));
check('thinking: smooth 400ms moves left, right and home', thinkingFrames.length === 6
  && near(leftFrames[0]?.at * 28, 400)
  && near((rightFrames[0]?.at - leftFrames[1]?.at) * 28, 400)
  && near((100 - rightFrames[1]?.at) * 28, 400)
  && transformAt(thinkingFrames, 0) === 'translateX(0)' && transformAt(thinkingFrames, 100) === 'translateX(0)');
check('thinking: body shrinks to 97%', value('.is-thinking .avatar-figure', '--figure-scale') === '.97');
check('thinking: slow subtle lateral sway, no squint or rotation', animation('.is-thinking .robot-avatar') === 'orb-sway 3s ease-in-out infinite'
  && transformAt(keyframes('orb-sway'), 0) === 'translateX(-3px)' && transformAt(keyframes('orb-sway'), 50) === 'translateX(3px)'
  && !value('.is-thinking', '--eye-sy'));

// ---------------------------------------------------------------- speaking
check('speaking: brightness reads live boundary data on the shared pair', value('.is-speaking .eyes-voice', 'filter') === 'brightness(calc(1 + clamp(0, var(--audio-pulse, 0), 1) * .8))');
check('speaking: light has no fake looping animation or slow state transition', !animation('.is-speaking .eyes-voice') && !value('.eyes-voice', 'transition'));
check('speaking: scale is clamped strictly to 100–104%', value('.is-speaking .avatar-figure', '--figure-scale') === 'calc(1 + clamp(0, var(--audio-pulse, 0), 1) * .04)');
check('speaking: quick gentle Y bounces never add extra scale', animation('.is-speaking .robot-avatar') === 'orb-word-bounce .5s ease-in-out infinite'
  && transformAt(keyframes('orb-word-bounce'), 0) === 'translateY(0)' && transformAt(keyframes('orb-word-bounce'), 50) === 'translateY(-3px)'
  && keyframes('orb-word-bounce').every(({ body }) => !/scale|rotate/.test(body)));
check('speaking: retains the shared blink, never rapid or independent blinks', !/eye-blink-rapid/.test(cssCode)
  && !animation('.is-speaking .eyes-blink') && !value('.is-speaking', '--eye-sx'));

// ---------------------------------------------------------------- happy / wake
check('happy/wake: both eyes have identical filled SVG crescents', crescents.length === 2 && crescents.every((node) => node.tag === 'path')
  && crescents[0].attrs.d === crescents[1].attrs.d);
// These mirrored cubic curves have extrema x=±14, y=±21: the same local eye
// bounds before the requested scaleX(1.2)/scaleY(.4) pose is applied.
check('crescent geometry is symmetric within the original 28×42 bounds', crescents.every((node) =>
  node.attrs.d === 'M-14 21C-14 -35 14 -35 14 21C8 -11 -8 -11 -14 21Z'));
check('crescents are hidden in the base state', value('.eye-crescent', 'opacity') === '0');
for (const state of ['is-happy', 'is-waking']) {
  check(`${state}: wide crescents scaleX(1.2), scaleY(.4)`, value(`.${state}`, '--eye-sx') === '1.2' && value(`.${state}`, '--eye-sy') === '.4');
  check(`${state}: iris crossfades to crescent without a second blink`, value(`.${state} .eye-iris`, 'opacity') === '0'
    && value(`.${state} .eye-crescent`, 'opacity') === '1' && animation(`.${state} .eyes-blink`) === 'none');
  check(`${state}: one 800ms double bounce, not infinite hops`, animation(`.${state} .robot-avatar`) === 'orb-double-bounce .8s ease-in-out both');
}
const jumpFrames = keyframes('orb-double-bounce');
check('double bounce: exactly two peaks with grounded landings', jumpFrames.length === 6
  && [0, 40, 80, 100].every((at) => transformAt(jumpFrames, at) === 'translateY(0)')
  && transformAt(jumpFrames, 20) === 'translateY(-12px)' && transformAt(jumpFrames, 60) === 'translateY(-6px)');
check('offline: both eyes dim and droop equally, preserving tall capsules', value('.is-offline', '--eye-sy') === '.9'
  && value('.is-offline .robot-eye', 'opacity') === '.5' && left.h * .9 > left.w);
check('offline: slow lateral sway never tilts the eyes', animation('.is-offline .robot-avatar') === 'orb-sad-sway 4s ease-in-out infinite'
  && keyframes('orb-sad-sway').length && keyframes('orb-sad-sway').every(({ body }) => !/rotate|skew/.test(body)));

// ---------------------------------------------------------------- coupled sizing, including compact heights
check('ring uses the visible 222/280 orb plus clearance, not SVG box width', value('.listen-ring', 'width') === 'calc(var(--avatar-size) * 222 / 280 + 26px)'
  && value('.listen-ring', 'height') === value('.listen-ring', 'width'));
check('backlight scales with the same avatar size', value('.avatar-backlight', 'width') === 'calc(var(--avatar-size) * 1.71875)'
  && value('.avatar-backlight', 'height') === value('.avatar-backlight', 'width'));
const sizes = styleRules.filter(({ selectors }) => selectors.includes('.avatar-container'))
  .map(({ body }) => parseFloat(property(body, '--avatar-size'))).filter(Number.isFinite);
check('compact sizes reuse the coupled variable, no stale SVG width overrides', sizes.join(' ') === '160 108 92'
  && styleRules.filter(({ selectors, body }) => selectors.includes('.robot-avatar') && property(body, 'width')).length === 1);
for (const size of sizes) {
  const orb = size * 222 / 280, ring = orb + 26, glow = size * 1.71875;
  check(`${size}px: ring clears jump travel and the 104% speaking bounce`, (ring - orb) / 2 > 12 && (ring - orb * 1.04) / 2 > 3 * 1.04,
    `orb ${orb.toFixed(2)}px, ring ${ring.toFixed(2)}px`);
  check(`${size}px: glow is wider than the ring`, glow >= ring, `${glow.toFixed(2)}px glow`);
}

// ---------------------------------------------------------------- reduced motion & hygiene
const reduced = cssCode.slice(cssCode.indexOf('@media (prefers-reduced-motion: reduce)'));
check('reduced motion disables float, gaze and blink, not just their durations', /\.robot-avatar, \.eyes-gaze, \.eyes-blink\s*\{[^}]*animation: none !important; transform: none;/.test(reduced));
check('reduced motion suppresses rotation, word swell, brightness and rings', /--figure-scale: 1 !important; --figure-y: 0deg !important/.test(reduced)
  && /\.eyes-voice\s*\{\s*filter: none !important;/.test(reduced) && /\.listen-ring\s*\{[^}]*opacity: 0;/.test(reduced));
check('no mouth selectors or obsolete eye animations remain', !/\.mouth-|\.orb-smile|mouth-(?:glow|light)-pulse|orb-wobble|orb-happy-hop|eye-drift|eye-tilt/.test(cssCode));

// ---------------------------------------------------------------- real-CSS state sheet
const STATES = [
  ['idle', 'IDLE', '28×42px capsules · 4s blink / 200ms · 3s float'],
  ['is-listening', 'LISTENING', '115% · #222 · rotateY(5°) · 1.5s orange ring'],
  ['is-thinking', 'THINKING', 'shared ±6px gaze · 800ms holds · 97% sway'],
  ['is-speaking', 'SPEAKING', 'shared word light · 100–104% · gentle quick bounce'],
  ['is-happy', 'HAPPY', 'matching wide crescents · one double jump'],
  ['is-listening is-waking', 'WAKE', '800ms double jump · crescents → listening'],
  ['is-offline', 'OFFLINE', 'equal droop · half brightness · lateral sway'],
];
// Per-cell SVG IDs matter: otherwise url(#eyeWell) in every cell resolves to the
// first cell's gradient, so listening's local colors never reach its own eyes.
const cellMarkup = (label) => markup.replace(/id="([^"]+)"/g, (_, id) => `id="${id}-${label.toLowerCase()}"`)
  .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${id}-${label.toLowerCase()})`);
const sheet = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NOVA — avatar states</title>
    <style>
${css}
      body { margin: 0; padding: 34px 26px 44px; background: #050300; }
      .sheet-head { max-width: 1080px; margin: 0 auto 26px; }
      .sheet-head h1 { margin: 0; color: #fff7ef; font-size: 20px; font-weight: 600; letter-spacing: -.02em; }
      .sheet-head p { margin: 7px 0 0; color: #a38a72; font-size: 11px; line-height: 1.6; }
      .sheet-head button { margin-top: 10px; padding: 7px 12px; color: #f2d6b8; background: transparent; border: 1px solid #5e4733; border-radius: 6px; cursor: pointer; }
      .sheet { display: grid; gap: 14px; max-width: 1080px; margin: 0 auto; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
      .cell { display: flex; flex-direction: column; align-items: center; padding: 18px 12px 16px; border: 1px solid rgba(245, 201, 154, .12); border-radius: 10px; background: rgba(255, 247, 239, .015); }
      .cell .avatar-container { animation: none; }
      .cell-label { margin-top: 12px; color: #f2d6b8; font: 10px var(--mono); letter-spacing: .16em; }
      .cell-note { margin-top: 6px; color: #8f775f; font-size: 10px; line-height: 1.5; text-align: center; }
    </style>
  </head>
  <body>
    <div class="sheet-head">
      <h1>NOVA — avatar states</h1>
      <p>Real stylesheet and React-rendered SVG. No microphone, model or audio is used here.
      Speaking holds a sample pulse of .8; real NOVA receives word-boundary events instead.
      Happy and wake jump once. Wake then settles into listening after 800ms.
      Dimensions are at the default 160px size; compact heights scale proportionally.</p>
      <button type="button" id="replay">Replay happy / wake</button>
    </div>
    <div class="sheet">
${STATES.map(([className, label, note]) => `      <div class="cell">
        <div class="avatar-container ${className}"${label === 'SPEAKING' ? ' style="--audio-pulse: .8"' : ''}${label === 'WAKE' ? ' id="wake-preview"' : ''}>
          <div class="avatar-backlight" aria-hidden="true"></div>
          <div class="listen-ring" aria-hidden="true"></div>
          <div class="avatar-figure">${cellMarkup(label)}</div>
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
const sheetIDs = [...sheet.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
check('state sheet has unique SVG gradient/filter IDs for every state', sheetIDs.length === new Set(sheetIDs).size);
check('state sheet URL references resolve to their own cell definitions', STATES.every(([, label]) => {
  const cell = cellMarkup(label);
  const ownIDs = new Set([...cell.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  return [...cell.matchAll(/url\(#([^)]+)\)/g)].every((m) => ownIDs.has(m[1]));
}));

for (const { label, ok, detail } of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
const failed = checks.filter(({ ok }) => !ok).length;
console.log(failed ? `\n${failed} check(s) failed.` : `\nAll ${checks.length} checks passed.`);
if (failed) process.exitCode = 1;
else {
  await writeFile(resolve(root, 'avatar-states.html'), sheet, 'utf8');
  console.log('Wrote avatar-states.html — open it to review the states and replay happy / wake.');
}
