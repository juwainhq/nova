// Check the avatar still matches its specification after an edit.
//
// Verified two ways: the SVG is rendered to real markup through React (so the
// element structure is checked, not the source text), and index.css is checked for
// the eye and body behaviour each state is supposed to have.
//
//   node scripts/verify-avatar.mjs
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = process.cwd();

const problems = [];
const checks = [];
function check(label, ok, detail = '') {
  checks.push({ label, ok, detail });
  if (!ok) problems.push(label);
}

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
    // CJS, not ESM: react-dom/server requires node builtins, which an ESM bundle
    // cannot express. Bundling everything keeps the probe runnable from /tmp,
    // where bare imports would not resolve against this project's node_modules.
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'warning',
  });

  const directory = await mkdtemp(join(tmpdir(), 'nova-avatar-'));
  const file = join(directory, 'probe.cjs');
  try {
    await writeFile(file, result.outputFiles[0].text, 'utf8');
    const { stdout } = await run(process.execPath, [file], { cwd: root });
    return stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const markup = await renderAvatar();
const css = await readFile(resolve(root, 'src/index.css'), 'utf8');
// Comments explain the absence of a mouth, so strip them before searching.
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');

// ---------------------------------------------------------------- SVG structure
check('renders an svg', /^<svg class="robot-avatar"/.test(markup));
check('has no mouth element', !/mouth/i.test(markup), markup.match(/class="[^"]*mouth[^"]*"/g)?.join(', ') ?? '');
check('has no mouthBloom filter', !/mouthBloom/.test(markup));
check('keeps the orb body', markup.includes('class="blob-shape"'));
check('has exactly two eyes', (markup.match(/class="robot-eye robot-eye-/g) || []).length === 2);
check('has a left and a right eye', /robot-eye-left/.test(markup) && /robot-eye-right/.test(markup));
check('lays eyes out as drift > size > blink',
  (markup.match(/class="eye-drift"/g) || []).length === 2
  && (markup.match(/class="eye-scale"/g) || []).length === 2
  && (markup.match(/class="eye-lid"/g) || []).length === 2);
check('includes a crescent shape per eye', (markup.match(/class="eye-crescent"/g) || []).length === 2);
check('keeps an iris per eye', (markup.match(/class="eye-iris"/g) || []).length === 2);
// The highlight was removed deliberately: at this size a gleam reads as a pupil and
// makes the eye look like a ball. Depth comes from the well gradient instead.
check('has no pupil-like highlight', !/eye-spark/.test(markup));
// The crescent has to sit inside the drift layer, or it would not travel with the eye
// it replaces during the happy state.
check('crescent drifts with its eye', /class="eye-drift">[\s\S]{0,400}?class="eye-crescent"/.test(
  markup.split('robot-eye-right')[0]));

// ------------------------------------------------------------------- eye geometry
// Measured from the rendered rects, not the source constants, so a bad formula in the
// component cannot slip through. This is exactly the class of bug that made the eyes
// sit near the orb's edges: the centre offset had subtracted a full width rather than
// half a width, so the intended gap rendered four times too wide.
const irisRects = [...markup.matchAll(/class="eye-iris" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="([\d.]+)"/g)]
  .map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4], rx: +m[5] }));

check('both eyes are the same size',
  irisRects.length === 2 && irisRects[0].w === irisRects[1].w && irisRects[0].h === irisRects[1].h,
  `${irisRects.length} rects`);

const eye = irisRects[0] ?? { x: 0, y: 0, w: 0, h: 0, rx: 0 };
check('eyes are tall pills, not dots', eye.h > eye.w * 1.3, `h/w = ${(eye.h / eye.w).toFixed(2)}`);
// The pair should carry the face without becoming goggles. Measured against an orb
// spanning ~222 units, so this is roughly 19-24% of the width per eye.
const eyeShareOfOrb = eye.w / 222;
check('eyes are large enough to carry the face', eyeShareOfOrb >= .17,
  `${eye.w}/222 = ${(eyeShareOfOrb * 100).toFixed(1)}% of the orb width`);
check('eyes are not oversized', eyeShareOfOrb <= .24,
  `${eye.w}/222 = ${(eyeShareOfOrb * 100).toFixed(1)}% of the orb width`);

// A true capsule: corner radius is exactly half the width, so both ends are semicircles.
check('eyes are true capsules', eye.rx === eye.w / 2, `rx ${eye.rx} vs half-width ${eye.w / 2}`);

const [leftEye, rightEye] = irisRects;
const innerGap = rightEye.x - (leftEye.x + leftEye.w);
const gapRatio = innerGap / eye.w;
check('eyes are separated, not touching', gapRatio >= .3,
  `${innerGap} units = ${gapRatio.toFixed(2)}x eye width`);

// The spacing has been widened more than once on request, so a ratio ceiling here would
// just keep getting raised. Assert the thing that actually constrains it: the pair has
// to stay inside the orb with a visible margin of cheek. The orb spans x 29..251.
const ORB = { left: 29, right: 251 };
const leftMargin = leftEye.x - ORB.left;
const rightMargin = ORB.right - (rightEye.x + rightEye.w);
check('pair stays inside the orb', leftMargin > 0 && rightMargin > 0,
  `margins ${leftMargin.toFixed(0)} / ${rightMargin.toFixed(0)} units`);
check('eyes leave a margin of cheek, not crowding the rim',
  Math.min(leftMargin, rightMargin) >= (ORB.right - ORB.left) * .15,
  `${Math.min(leftMargin, rightMargin).toFixed(0)} units = ${(Math.min(leftMargin, rightMargin) / 222 * 100).toFixed(0)}% of the orb width`);
check('pair is centred inside the orb', Math.abs(leftMargin - rightMargin) < 1,
  `left ${leftMargin.toFixed(1)} vs right ${rightMargin.toFixed(1)}`);
check('eyes sit in the upper half', eye.y + eye.h / 2 < 140, `centre y = ${eye.y + eye.h / 2}`);
check('eyes are centred as a pair',
  Math.abs((leftEye.x + rightEye.x + eye.w) / 2 - 140) < 0.01,
  `midpoint ${(leftEye.x + rightEye.x + eye.w) / 2}`);

// The eyes must stand perfectly upright. An earlier version leaned both of them a few
// degrees the same way and it read as a squint, so no group carries a rotation and the
// base .robot-eye rule sets no transform for a state rule to inherit.
check('eyes are perfectly upright', !/rotate\(/.test(markup));
// `.is-happy .robot-eye` legitimately sets one, so only the bare rule is checked.
// `transform-box` and `transform-origin` do not count — they set the box, not the pose.
const baseRuleSetsTransform = [...cssCode.matchAll(/([^{}]+)\{([^{}]*)\}/g)].some(([, selector, body]) =>
  selector.split(',').map((part) => part.trim()).includes('.robot-eye')
  && /(^|[\s;])transform:/.test(body));
check('no state rule can tilt the eyes', !baseRuleSetsTransform);
check('no stale tilt layer in the stylesheet', !/\.eye-tilt/.test(cssCode));

// ------------------------------------------------------------- inner shadow
check('inner shadow gradient exists for the eye well', /id="eyeWell"/.test(markup));
const wellStops = [...markup.matchAll(/<stop offset="[\d.]+" stop-color="#([0-9A-Fa-f]{6})"/g)]
  .map((m) => m[1]);
const well = markup.slice(markup.indexOf('id="eyeWell"'), markup.indexOf('id="eyeWell"') + 320);
const wellShades = [...well.matchAll(/stop-color="#([0-9A-Fa-f]{6})"/g)].map((m) => +('0x' + m[1].slice(0, 2)));
check('eye well is dark inside', /id="eyeWell"/.test(markup) && wellShades.length >= 3
  && Math.max(...wellShades) < 0x40,
  `darkest-to-lightest red channels: ${wellShades.join(', ')}`);
check('eye well lightens toward the bottom, so it reads as depth not flat fill',
  wellShades.length >= 3 && wellShades[wellShades.length - 1] > wellShades[0],
  `${wellShades[0]} -> ${wellShades[wellShades.length - 1]}`);
void wellStops;

// ------------------------------------------------------------- motion plumbing
check('pose and rhythm use separate elements',
  /\.avatar-figure\s*\{[^}]*transform:/.test(cssCode) && /\.robot-avatar\s*\{[^}]*animation:/.test(cssCode));
check('eyes define all three motion layers',
  /\.eye-scale\s*\{[^}]*scale\(var\(--eye-sx/.test(cssCode) && /\.eye-lid\s*\{[^}]*animation: eye-blink/.test(cssCode));

const keyframes = (name) => new RegExp(`@keyframes\\s+${name}\\b`).test(cssCode);

function rulesFor(selector) {
  // Collect the bodies of every rule whose selector list contains `selector`.
  const bodies = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = pattern.exec(cssCode)) !== null) {
    const selectors = match[1].split(',').map((part) => part.trim());
    if (selectors.some((part) => part === selector || part.split(/\s+/).includes(selector)
      || part.startsWith(`${selector} `) || part.includes(`${selector}:`))) {
      bodies.push(match[2]);
    }
  }
  return bodies.join('\n');
}

const idle = rulesFor('.robot-avatar');
const idleEyes = rulesFor('.eye-lid');
const listening = rulesFor('.is-listening');
const thinking = rulesFor('.is-thinking');
const speaking = rulesFor('.is-speaking');
const happy = rulesFor('.is-happy');
const offline = rulesFor('.is-offline');

// ------------------------------ IDLE: steady glow, occasional blink, gentle float
check('idle: body floats up and down', keyframes('orb-float') && /animation: orb-float/.test(idle));
check('idle: eyes glow softly', /drop-shadow/.test(idleEyes));
check('idle: blinks every 4-5 seconds', keyframes('eye-blink') && /--eye-blink, 4\.6s/.test(idleEyes));
// The eyes must not ride the body rigidly, or the face reads as a decal.
check('idle: eyes drift slowly, independently of the body',
  keyframes('eye-drift') && /\.eye-drift\s*\{[^}]*animation: eye-drift/.test(cssCode));
// A blink needs a close, a partial re-open, then a full one; a single snap closed and
// open reads as an accordion rather than a lid.
const blinkFrames = (cssCode.match(/@keyframes eye-blink \{([\s\S]*?)\n\}/) || [])[1] ?? '';
const blinkSteps = [...blinkFrames.matchAll(/scaleY\((\d*\.?\d+)\)/g)].map((m) => +m[1]);
check('blink eases closed and open rather than snapping',
  blinkSteps.length >= 3 && blinkSteps.includes(1) && Math.min(...blinkSteps) < .1,
  `scaleY steps: ${blinkSteps.join(', ')}`);

// --------------------- LISTENING: bigger, brighter, lean in, 5 degree tilt, ring
check('listening: eyes grow bigger', /--eye-sx: 1\.1[6-9]/.test(listening));
const glowOf = (body) => {
  const found = body.match(/drop-shadow\(0 0 ([\d.]+)px/);
  return found ? +found[1] : 0;
};
check('listening: eyes get brighter', glowOf(listening) > glowOf(idleEyes),
  `idle ${glowOf(idleEyes)}px -> listening ${glowOf(listening)}px`);
check('listening: blinks a little more often than idle', /--eye-blink: 4\.4s/.test(listening));
check('listening: body tilts 5 degrees', /--figure-tilt: -5deg/.test(listening));
check('listening: leans in', /--figure-scale: 1\.0[0-9]/.test(listening));
check('listening: subtle pulse ring', /\.is-listening \.listen-ring\s*\{[^}]*animation: listen-pulse/.test(cssCode));

// ------------------ THINKING: gaze side to side, one squint, 3% smaller, wobble
check('thinking: gaze moves side to side', keyframes('eyes-thinking') && /animation: eyes-thinking/.test(thinking));
check('thinking: one eye squints', /\.is-thinking \.robot-eye-left \.eye-scale\s*\{[^}]*--eye-sy: \.8/.test(cssCode));
// Any state that squashes the eye vertically must leave it taller than it is wide.
// Nothing else stops a future tweak from flattening the pills into rounded squares.
const squashes = [
  ['squint', /\.is-thinking \.robot-eye-left \.eye-scale\s*\{[^}]*--eye-sy: ([\d.]+)/.exec(cssCode)?.[1]],
  ['droop', /\.is-offline \.eye-scale\s*\{[^}]*--eye-sy: ([\d.]+)/.exec(cssCode)?.[1]],
];
for (const [name, value] of squashes) {
  const ratio = (eye.h * Number(value)) / eye.w;
  check(`${name} keeps the pill shape`, value !== undefined && ratio > 1.25,
    `${name} scale ${value} -> h/w = ${ratio.toFixed(2)}`);
}
check('thinking: shrinks 3 percent', /--figure-scale: \.97/.test(thinking));
check('thinking: body wobbles', keyframes('orb-wobble') && /animation: orb-wobble/.test(thinking));

// ----------------- SPEAKING: wider, brighter, rapid blinks, 5% bigger, word beat
check('speaking: eyes wider', /--eye-sx: 1\.1/.test(speaking));
check('speaking: rapid blinking', keyframes('eye-blink-rapid') && /animation: eye-blink-rapid/.test(speaking));
check('speaking: grows 5 percent', /--figure-scale: calc\(1\.05/.test(speaking));
check('speaking: body bounces on each word', keyframes('orb-word-bounce')
  && /animation: orb-word-bounce/.test(speaking));
check('speaking: eyes brighten with the voice', /--audio-pulse/.test(speaking));

// ------------------------------ HAPPY: crescent eyes, quick jump, small bounces
check('happy: crescent eyes replace the iris', /\.is-happy \.eye-crescent\s*\{[^}]*opacity: 1/.test(cssCode)
  && /\.is-happy \.eye-lid\s*\{[^}]*opacity: 0/.test(cssCode));
check('happy: quick jump then small bounces', keyframes('orb-happy-hop') && /animation: orb-happy-hop/.test(happy));

// ------------------------------ OFFLINE: droop, half brightness, slow sad sway
check('offline: eyes droop', /--eye-sy: \.8/.test(offline));
check('offline: eyes dim to half brightness', /opacity: \.5;/.test(rulesFor('.is-offline .robot-eye')));
check('offline: slow sad sway', keyframes('orb-sad-sway') && /animation: orb-sad-sway/.test(offline));
check('offline rules come last', cssCode.indexOf('.is-offline .robot-eye') > cssCode.indexOf('.is-happy .robot-eye'));

// ------------------------------------------------------------ on-screen sizing
// The orb is drawn inside a 280-unit viewBox but only occupies the middle 222 units, so
// its on-screen diameter is a fraction of the CSS box. The ring and the glow are
// measured against that fraction: size the avatar without them and the ring ends up
// hidden behind the orb, which is invisible in the SVG and in the markup.
const cssPx = (selector, property) => {
  const found = new RegExp(`\\${selector}\\s*\\{[^}]*${property}:\\s*([\\d.]+)px`).exec(cssCode);
  return found ? Number(found[1]) : null;
};
const boxSize = cssPx('.robot-avatar', 'width');
const ringSize = cssPx('.listen-ring', 'width');
const glowSize = cssPx('.avatar-backlight', 'width');
const ORB_SHARE = 222 / 280;
const orbOnScreen = boxSize === null ? null : boxSize * ORB_SHARE;

check('avatar is sized in a sensible band', boxSize !== null && boxSize >= 128 && boxSize <= 176,
  `${boxSize}px box`);
check('listen ring clears the orb', ringSize !== null && orbOnScreen !== null && ringSize > orbOnScreen,
  `orb ${orbOnScreen?.toFixed(1)}px vs ring ${ringSize}px`);
check('glow is at least as wide as the ring', glowSize !== null && ringSize !== null && glowSize >= ringSize,
  `glow ${glowSize}px vs ring ${ringSize}px`);

// ------------------------------------------------------------------- hygiene
check('no mouth selectors remain in css', !/\.mouth-|\.orb-smile/.test(cssCode));
check('no mouth keyframes remain', !/mouth-glow-pulse|mouth-light-pulse/.test(cssCode));
check('reduced motion is still honoured', /@media \(prefers-reduced-motion: reduce\)/.test(cssCode));

// ------------------------------------------------------------- state sheet
// A sheet of every state, built from the real CSS and the real rendered markup, so
// the motion can be reviewed without a microphone, a model or a network.
const STATES = [
  ['idle', 'IDLE', 'float · upright eyes · drift · blink every 4.6s'],
  ['is-listening', 'LISTENING', 'bigger + brighter · 5° tilt · ring'],
  ['is-thinking', 'THINKING', 'side to side · one squint · −3% · wobble'],
  ['is-speaking', 'SPEAKING', 'wider · rapid blinks · +5% · word beat'],
  ['is-happy', 'HAPPY', 'crescents · jump then bounces'],
  ['is-offline', 'OFFLINE', 'droop · half brightness · sad sway'],
];

const sheet = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NOVA — avatar states</title>
    <style>
${css}
      body { margin: 0; padding: 34px 26px 44px; background: #0d0805; }
      .sheet-head { max-width: 1080px; margin: 0 auto 26px; }
      .sheet-head h1 { margin: 0; color: #fff7ef; font-size: 20px; font-weight: 600; letter-spacing: -.02em; }
      .sheet-head p { margin: 7px 0 0; color: #a38a72; font-size: 11px; line-height: 1.6; }
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
      <p>Generated by <code>scripts/verify-avatar.mjs</code> from the real stylesheet and the
      rendered avatar markup, so this sheet cannot drift from the app. No mouth: every state is
      expressed through the eyes and the body. Values for the audio-driven states are frozen here,
      since nothing is actually speaking.</p>
    </div>
    <div class="sheet">
${STATES.map(([className, label, note]) => `      <div class="cell">
        <div class="avatar-container ${className}">
          <div class="avatar-backlight"></div>
          <div class="listen-ring"></div>
          <div class="avatar-figure">${markup}</div>
        </div>
        <div class="cell-label">${label}</div>
        <div class="cell-note">${note}</div>
      </div>`).join('\n')}
    </div>
  </body>
</html>
`;

await writeFile(resolve(root, 'avatar-states.html'), sheet, 'utf8');

const failed = problems.length;
for (const { label, ok, detail } of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}
console.log(failed ? `\n${failed} check(s) failed.` : `\nAll ${checks.length} checks passed.`);
console.log('Wrote avatar-states.html — open it to review every state side by side.');
if (failed) process.exitCode = 1;
