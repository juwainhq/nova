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

async function renderAvatar(component = 'RobotAvatar', props = {}) {
  const result = await build({
    stdin: {
      contents: `
        import { createElement } from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import Avatar from './src/${component}.jsx';
        process.stdout.write(renderToStaticMarkup(createElement(Avatar, ${JSON.stringify(props)})));
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

const expressions = ['neutral', 'happy', 'wink', 'surprised', 'thinking', 'sleepy', 'speaking', 'listening', 'idle', 'waking'];
const models = { orb: 'RobotAvatar', bot: 'BotAvatar' };
const renders = Object.fromEntries(await Promise.all(Object.entries(models).map(async ([skin, component]) => [skin,
  Object.fromEntries(await Promise.all(expressions.map(async expression => [expression, await renderAvatar(component, { expression })]))),
])));
const css = await readFile(resolve(root, 'src/index.css'), 'utf8');
const faceCss = await readFile(resolve(root, 'src/avatar.css'), 'utf8');
const code = (css + '\n' + faceCss).replace(/\/\*[\s\S]*?\*\//g, '');

// Parse actual rendered SVG, not the source constants. The same geometry must
// survive every pose while the Orb's paint stays independent of the Bot's.
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
function tree(markup) {
  const root = { tag: 'root', attrs: {}, children: [] }, stack = [root];
  for (const [tag] of markup.matchAll(/<[^>]+>/g)) {
    if (tag.startsWith('</')) { stack.pop(); continue; }
    const node = { tag: /^<([\w]+)/.exec(tag)?.[1], attrs: attrs(tag), children: [] };
    stack.at(-1).children.push(node);
    if (!tag.endsWith('/>')) stack.push(node);
  }
  return root;
}
const all = node => [node, ...node.children.flatMap(all)];
const has = (node, name) => node.attrs.class?.split(' ').includes(name);
const nodes = Object.fromEntries(Object.keys(models).map(skin => [skin, Object.fromEntries(expressions.map(expression => [expression, all(tree(renders[skin][expression]))]))]));
const find = (skin, name, expression = 'neutral') => nodes[skin][expression].find(node => has(node, name));
const findAll = (skin, name, expression = 'neutral') => nodes[skin][expression].filter(node => has(node, name));
const ids = markup => [...markup.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const references = markup => [...markup.matchAll(/url\(#([^)]+)\)/g)].map(m => m[1]);

function blocks(source) {
  const result = [];
  for (let cursor = 0; cursor < source.length;) {
    const open = source.indexOf('{', cursor);
    if (open < 0) break;
    let end = open + 1, depth = 1;
    while (end < source.length && depth) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; end++; }
    result.push({ header: source.slice(cursor, open).trim(), body: source.slice(open + 1, end - 1) }); cursor = end;
  }
  return result;
}
const rules = [];
const cssBlocks = blocks(code);
function collect(items, conditional = false) {
  for (const { header, body } of items) {
    if (header.startsWith('@media')) collect(blocks(body), true);
    else if (!header.startsWith('@')) rules.push({ selectors: header.split(',').map(s => s.trim()), body, conditional });
  }
}
collect(cssBlocks);
const rule = selector => rules.filter(r => !r.conditional && r.selectors.includes(selector)).map(r => r.body).join(';');
const property = (body, name) => [...body.matchAll(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'g'))].at(-1)?.[1]?.trim() ?? '';
const value = (selector, name) => property(rule(selector), name);
const animation = selector => value(selector, 'animation');
const frames = name => blocks(cssBlocks.find(b => b.header === `@keyframes ${name}`)?.body ?? '').flatMap(b => b.header.split(',').map(at => ({ at: parseFloat(at), body: b.body })));
const transformAt = (name, at) => property(frames(name).find(f => f.at === at)?.body ?? '', 'transform');
const geometry = node => Object.fromEntries(['tag', 'd', 'x', 'y', 'width', 'height', 'rx', 'stroke-width', 'stroke-linecap'].map(key => [key, key === 'tag' ? node.tag : node.attrs[key]]).filter(([, v]) => v !== undefined));

// ------------------------------------------------------ shared shapes, NOT colors
for (const expression of expressions) {
  for (const skin of Object.keys(models)) {
    const markup = renders[skin][expression], ownIds = ids(markup), list = nodes[skin][expression];
    const label = list.find(n => n.attrs.role === 'img');
    check(`${skin}/${expression}: one accessible, correctly labelled local drawing`, list.filter(n => n.attrs.role === 'img').length === 1
      && label.attrs['aria-label'].startsWith(`NOVA ${skin === 'orb' ? 'Orb' : 'Bot'},`)
      && label.attrs['aria-label'].endsWith(`— ${expression}`) && label.attrs['data-expression'] === expression
      && !/<img|<image|<script|https?:/.test(markup));
    check(`${skin}/${expression}: every gradient/filter is unique and resolves locally`, ownIds.length === new Set(ownIds).size && references(markup).every(id => ownIds.includes(id)));
    check(`${skin}/${expression}: actual activity and expression have separate handles`, label.attrs['data-activity'] === expression
      && has(label, `expression-${expression}`) && has(label, `activity-${expression}`));
  }
  for (const shape of ['open', 'smile', 'wink', 'sleep', 'thought']) {
    const orb = findAll('orb', `avatar-eye-${shape}`, expression), bot = findAll('bot', `avatar-eye-${shape}`, expression);
    check(`${expression}: ${shape} eye geometry is exactly shared`, orb.length === 2 && bot.length === 2
      && JSON.stringify(orb.map(geometry)) === JSON.stringify(bot.map(geometry)));
  }
  check(`${expression}: both use the same seven-bar waveform`, JSON.stringify(findAll('orb', 'avatar-wave-bar', expression).map(n => geometry(n.children[0])))
    === JSON.stringify(findAll('bot', 'avatar-wave-bar', expression).map(n => geometry(n.children[0]))) && findAll('orb', 'avatar-wave-bar', expression).length === 7);
  check(`${expression}: the Orb's SVG contains no ice-blue paint or eye-glow filter`, !/#(?:D0F0FF|B7E6FF|A8DBFA|BAE7FF|80B8FF|76A7FF)|eye-glow/i.test(renders.orb[expression]));
}
const orbEyePaint = nodes.orb.neutral.find(n => n.attrs.id?.endsWith('-eye'));
const botEyePaint = nodes.bot.neutral.find(n => n.attrs.id?.endsWith('-eye'));
check('Orb keeps its original centered charcoal radial well', orbEyePaint.tag === 'radialGradient' && orbEyePaint.attrs.cx === '.5' && orbEyePaint.attrs.cy === '.5'
  && orbEyePaint.children.map(n => n.attrs['stop-color']).join(',') === '#161616,#1a1a1a');
check('Bot keeps its existing icy linear eye paint', botEyePaint.tag === 'linearGradient'
  && botEyePaint.children.map(n => n.attrs['stop-color']).join(',') === '#D0F0FF,#B7E6FF,#A8DBFA');
check('Orb curves and waveform stay charcoal, never inherit blue', value('.nova-orb', '--avatar-eye-line') === 'var(--eye-color, #1a1a1a)'
  && value('.nova-orb', '--avatar-wave-color') === 'var(--eye-color, #1a1a1a)');
check('Orb rays, Zs and rings keep their warm amber paint', value('.nova-orb', '--avatar-face-accent') === '#ff6a1a' && value('.nova-orb', '--avatar-surprise-color') === '#ff6a1a');
check('Bot curves, waveform and indicators retain their own blues', value('.nova-bot', '--avatar-eye-line') === '#bae7ff' && value('.nova-bot', '--avatar-wave-color') === '#b7e6ff'
  && value('.nova-bot', '--avatar-face-accent') === '#80b8ff' && value('.nova-bot', '--avatar-surprise-color') === '#76a7ff');
check('Orb eye shades retain existing listening-color variables', value('.avatar-eye-shade', 'stop-color') === 'var(--eye-shadow, #161616)'
  && value('.avatar-eye-surface', 'stop-color') === 'var(--eye-color, #1a1a1a)' && value('.is-listening', '--eye-color') === '#222');

// ------------------------------------------------------ original Orb body/layout
const orbSvg = find('orb', 'robot-avatar');
const orbPath = find('orb', 'blob-shape');
const orbSize = parseFloat(value('.avatar-container', '--avatar-size'));
const orbUnit = orbSize / 280;
const eyeScale = 42 * 280 / 160 / 78;
const orbEyes = findAll('orb', 'avatar-eye-position');
check('Orb keeps its original 280-square SVG and responsive 188px default', orbSvg.attrs.viewBox === '0 0 280 280' && orbSize === 188
  && value('.robot-avatar', 'width') === 'var(--avatar-size, 160px)' && value('.robot-avatar', 'height') === 'var(--avatar-size, 160px)');
check('Orb outline is unchanged, not replaced by the Bot helmet', orbPath.attrs.d === 'M141 29C202 29 251 77 251 139C251 199 207 247 146 251C83 254 31 208 29 146C27 84 74 32 134 29C136 29 139 29 141 29Z'
  && !find('orb', 'bot-head') && !find('orb', 'bot-face'));
const surface = nodes.orb.neutral.find(n => n.attrs.id?.endsWith('-orbSurface'));
check('Orb surface colors and lighting geometry are unchanged', surface.attrs.gradientTransform === 'matrix(145 164 -153 135 93 76)'
  && surface.children.map(n => n.attrs['stop-color']).join(',') === '#FFFDF9,#FFF8EF,#F2E5D5,#D8C4AE');
check('Orb retains its bloom, highlight and single white rim arc', find('orb', 'orb-bloom').attrs.r === '106'
  && find('orb', 'orb-sheen').attrs.opacity === '.72' && orbSvg.children.filter(n => n.attrs.stroke === '#FFFFFF' && n.tag === 'path').length === 1);
check('Orb height and eye centers stay familiar while capsules become slimmer', orbEyes.map(n => n.attrs.transform).join('|') === `translate(99.75 105) scale(${eyeScale})|translate(180.25 105) scale(${eyeScale})`
  && near(78 * eyeScale * orbUnit, 42 * orbSize / 160));
check('Orb uses the Bot 31:78 pill ratio with semicircular caps', findAll('orb', 'avatar-eye-open').every(n => n.attrs.width === '31' && n.attrs.height === '78' && n.attrs.rx === '15.5'));
check('Orb stays front-facing: no eye rotation, skew or perspective', orbEyes.every(n => !/rotate|skew|perspective/.test(n.attrs.transform)));
check('Orb eye pair stays horizontally centered and in the upper half', near((99.75 + 180.25) / 2, 140) && 105 < 140);
check('Orb eye margins still clear the blob edges', (99.75 - 15.5 * eyeScale - 29) * orbUnit > 20
  && near(99.75 - 15.5 * eyeScale - 29, 251 - (180.25 + 15.5 * eyeScale)));
check('Orb waveform stays centered and contains no eyes in its own layer', find('orb', 'avatar-waveform').attrs.transform === 'translate(140 130) scale(.85)'
  && !all(find('orb', 'avatar-waveform')).some(n => has(n, 'avatar-eye')));
check('Orb halo and listening ring use the original blob contour', find('orb', 'avatar-idle-glow').attrs.d === orbPath.attrs.d
  && find('orb', 'avatar-listen-ring').attrs.d === orbPath.attrs.d);
check('Orb hover target does not bob with the inner drawing', value('.nova-orb', 'position') === 'relative'
  && value('.nova-orb', 'width') === 'var(--avatar-size, 188px)' && !animation('.nova-orb'));
check('Main avatar layout and backlight keep their coupled dimensions', value('.avatar-container', 'width') === 'calc(var(--avatar-size) + 98px)'
  && value('.avatar-container', 'height') === 'calc(var(--avatar-size) + 46px)' && value('.avatar-backlight', 'width') === 'calc(var(--avatar-size) * 1.71875)');

// ------------------------------------------------------ preserved Bot silhouette
const botHead = find('bot', 'bot-head'), botFace = find('bot', 'bot-face');
check('Bot retains its wide reference helmet and curved glass', botHead.attrs.d.startsWith('M142 515C148 422') && botFace.attrs.d.startsWith('M267 406C305 382')
  && botHead.attrs.fill.endsWith('-ceramic)') && botFace.attrs.fill.endsWith('-glass)'));
check('Bot keeps its body, narrow neck, sparkle and subtle seam', ['bot-body', 'bot-neck', 'bot-sparkle', 'bot-body-seam'].every(name => find('bot', name)));
check('Bot eyes retain their exact reference positions and tilt', findAll('bot', 'avatar-eye-position').map(n => n.attrs.transform).join('|') === 'translate(327 523) rotate(-9)|translate(453 503) rotate(-9)');
check('Bot waveform retains its reference plane and placement', find('bot', 'avatar-waveform').attrs.transform === 'translate(390 513) rotate(-9)');
check('Bot near/far ear layering and recessed ring are unchanged', renders.bot.neutral.indexOf('bot-ear-right') < renders.bot.neutral.indexOf('class="bot-head"')
  && renders.bot.neutral.indexOf('bot-ear-left') > renders.bot.neutral.indexOf('class="bot-head"') && find('bot', 'bot-ear-ring').attrs.ry === '53');
check('Bot floor is a separate SVG plane, never carried up by its float', nodes.bot.neutral.filter(n => n.tag === 'svg').map(n => n.attrs.class).join(',') === 'bot-shadow-drawing,bot-drawing'
  && value('.bot-shadow-drawing', 'position') === 'absolute' && !animation('.bot-shadow-drawing'));

// ------------------------------------------------------ shared poses and layers
for (const skin of Object.keys(models)) {
  const eyes = findAll(skin, 'avatar-eye-position');
  check(`${skin}: independent pose/blink layers keep fixed local eye origins`, eyes.length === 2 && eyes.every(n => has(n.children[0], 'avatar-eye-reveal')
    && has(n.children[0].children[0], 'avatar-eye-blink') && has(n.children[0].children[0].children[0], 'avatar-eye'))
    && value('.avatar-eye', 'transform-origin') === '0 0' && value('.avatar-eye-blink', 'transform-origin') === '0 0');
  check(`${skin}: both eyes use one gaze and one speech-light layer`, findAll(skin, 'avatar-eyes').length === 1 && findAll(skin, 'avatar-eye-voice').length === 1);
  check(`${skin}: authored seven-bar heights match the reference`, findAll(skin, 'avatar-wave-bar').map(n => n.children[0].attrs.height).join(',') === '28,52,78,102,74,48,26');
}
check('Happy/waking use the same round-ended arches on either palette', value('.expression-happy .avatar-eye-open', 'opacity') === '0'
  && value('.expression-happy .avatar-eye-smile', 'opacity') === '1' && value('.expression-waking .avatar-eye-smile', 'opacity') === '1');
check('Wink changes only the right eye to the diagonal lid', value('.expression-wink .avatar-eye-right .avatar-eye-open', 'opacity') === '0'
  && value('.expression-wink .avatar-eye-right .avatar-eye-wink', 'opacity') === '1' && !rule('.expression-wink .avatar-eye-left .avatar-eye-open'));
check('Thinking folds the left eye, leaving the other open', value('.expression-thinking .avatar-eye-left .avatar-eye-open', 'opacity') === '0'
  && value('.expression-thinking .avatar-eye-left .avatar-eye-thought', 'opacity') === '1' && !rule('.expression-thinking .avatar-eye-right .avatar-eye-open'));
check('Sleepy shows closed curves and vector Zs on both characters', value('.expression-sleepy .avatar-eye-open', 'opacity') === '0'
  && value('.expression-sleepy .avatar-eye-sleep', 'opacity') === '1' && value('.expression-sleepy .avatar-sleep-marks', 'opacity') === '1');
check('Surprised enlarges eyes to 130% and exposes three rays', value('.expression-surprised .avatar-eye', 'transform') === 'scale(1.3)'
  && value('.expression-surprised .avatar-surprise-marks', 'opacity') === '1' && find('orb', 'avatar-surprise-marks').children[0].attrs.d === 'm-29 5-10-18M0 0v-24M29 5l10-18');
check('Speaking replaces the eye layer with the waveform on both models', value('.expression-speaking .avatar-eyes', 'opacity') === '0'
  && value('.expression-speaking .avatar-waveform', 'opacity') === '1');
check('Waveform energy and light consume the existing live speech pulse', value('.avatar-wave-energy', 'transform') === 'scaleY(calc(.6 + clamp(0, var(--audio-pulse, 0), 1) * .4))'
  && value('.expression-speaking .avatar-waveform', 'filter') === 'brightness(calc(1 + clamp(0, var(--audio-pulse, 0), 1) * .5))');
check('Listening and idle share their ring/eye rhythm, not their color', value('.expression-listening .avatar-eye', 'transform') === 'scale(1.15)'
  && animation('.expression-listening .avatar-listen-ring') === 'avatar-listening-ring 1.5s ease-in-out infinite'
  && animation('.expression-idle .avatar-idle-glow') === 'avatar-idle-glow 4.8s ease-in-out infinite');
check('Offline dimness cannot paint an extra capsule over wink/sleepy lids', value('.is-offline .avatar-eye', 'opacity') === '.5'
  && value('.is-offline .avatar-eye', 'transform') === 'scaleY(.9)' && !rule('.is-offline .avatar-eye-open'));

// ------------------------------------------------------ motion invariants
check('Idle float, breathing and Y turn are shared exactly', animation('.robot-avatar') === 'orb-float 3s ease-in-out infinite'
  && animation('.bot-drawing') === animation('.robot-avatar'));
check('Float rises ten pixels and breathes to 102%, with a seamless loop', transformAt('orb-float', 50) === 'translateY(-10px) scale(1, 1.02) rotateY(0deg)'
  && transformAt('orb-float', 0) === transformAt('orb-float', 100));
for (const name of ['orb-float', 'orb-sway', 'orb-word-bounce', 'orb-double-bounce', 'orb-sad-sway']) {
  check(`${name}: no sideways rotation, perspective or skew distorts either face`, frames(name).length > 0 && frames(name).every(f => !/rotate\(|rotateZ|skew|perspective/.test(f.body)));
}
for (const state of ['thinking', 'speaking', 'happy', 'waking', 'sleepy']) {
  check(`${state}: Orb and Bot use the same body rhythm`, animation(`.expression-${state} .robot-avatar`) === animation(`.expression-${state} .bot-drawing`)
    && Boolean(animation(`.expression-${state} .bot-drawing`)));
}
check('A post-reply wink cannot restart the happy body jump', animation('.activity-happy .robot-avatar') === 'orb-double-bounce .8s ease-in-out both'
  && animation('.activity-happy .bot-drawing') === animation('.activity-happy .robot-avatar'));
check('Happy/wake have exactly two peaks and finish grounded', transformAt('orb-double-bounce', 20) === 'translateY(-12px)'
  && transformAt('orb-double-bounce', 60) === 'translateY(-6px)' && [0,40,80,100].every(at => transformAt('orb-double-bounce', at) === 'translateY(0)'));
check('Speaking bounce adds no scale or rotation to the actual audio pulse', transformAt('orb-word-bounce', 50) === 'translateY(-3px)'
  && frames('orb-word-bounce').every(f => !/scale|rotate/.test(f.body)));
check('Shared figure pose retains the 400ms easing and 100–104% audio bound', value('.avatar-figure', 'transition') === 'transform 400ms ease-in-out'
  && value('.is-speaking .avatar-figure', '--figure-scale') === 'calc(1 + clamp(0, var(--audio-pulse, 0), 1) * .04)' && !animation('.avatar-figure'));
check('Listening lean and thinking/offline scale remain unchanged', value('.is-listening .avatar-figure', '--figure-y') === '5deg'
  && value('.is-thinking .avatar-figure', '--figure-scale') === '.97' && value('.is-offline .avatar-figure', '--figure-scale') === '.95');
check('Blink stays synchronized on a four-second, 200ms close/open cycle', animation('.avatar-eye-blink') === 'eye-blink 4s ease-in-out infinite'
  && transformAt('eye-blink', 95) === 'scaleY(1)' && transformAt('eye-blink', 97.5) === 'scaleY(.0952380952)' && transformAt('eye-blink', 100) === 'scaleY(1)');
for (const state of ['happy','waking','wink','sleepy','surprised','speaking']) {
  check(`${state}: blink never collapses the expression or waveform`, animation(`.expression-${state} .avatar-eye-blink`) === 'none');
}
check('Shared gaze retains the idle and thinking rhythms', animation('.avatar-eyes') === 'gaze-drift 9.5s ease-in-out infinite'
  && animation('.expression-thinking .avatar-eyes') === 'eyes-thinking 2.8s ease-in-out infinite');
const thinkFrames = frames('eyes-thinking');
const holdTimes = (sign) => thinkFrames.filter(f => property(f.body, 'transform') === (sign < 0 ? 'translateX(calc(-1 * var(--eye-shift)))' : 'translateX(var(--eye-shift))')).map(f => f.at).sort((a,b)=>a-b);
check('Thinking holds left and right for exactly 800ms each', [-1,1].every(sign => { const times=holdTimes(sign); return times.length===2 && near((times[1]-times[0])*28,800); }));
check('Orb gaze stays at its original six design-pixel travel', find('orb', 'avatar-eyes').attrs.style === '--eye-shift:10.5px');
check('Orb ambient surface clocks are still independent', animation('.orb-bloom') === 'bloom-breathe 5.4s ease-in-out infinite'
  && animation('.blob-shape') === 'orb-squirm 7.2s ease-in-out infinite' && animation('.orb-sheen') === 'sheen-drift 9.6s ease-in-out infinite'
  && animation('.avatar-backlight') === 'blob-morph 13s ease-in-out infinite, aura-turn 34s linear infinite');
for (const name of ['orb-squirm','bloom-breathe','sheen-drift','gaze-drift']) {
  check(`${name}: the loop returns to its rest frame`, frames(name).length > 0 && transformAt(name,0) === transformAt(name,100));
}
for (const [selector, origin] of [['.orb-bloom','140px 140px'],['.blob-shape','140px 140px'],['.orb-sheen','116px 83px']]) {
  check(`${selector}: fixed SVG origin preserves the Orb surface`, value(selector, 'transform-box') === 'view-box' && value(selector, 'transform-origin') === origin);
}
check('Body shadows never travel upward with a jumping Bot', value('.bot-ground-shadow', 'transform-origin') === '352px 909px'
  && cssBlocks.filter(b => b.header.startsWith('@keyframes bot-shadow-')).every(b => !/translate|rotate/.test(b.body)));

// ------------------------------------------------------ reduced motion / switching
const reducedBlocks = cssBlocks.filter(b => b.header === '@media (prefers-reduced-motion: reduce)').flatMap(b => blocks(b.body));
const reducedValue = (selector, name) => property(reducedBlocks.filter(b => b.header.split(',').map(s=>s.trim()).includes(selector)).map(b=>b.body).join(';'),name);
for (const selector of ['.robot-avatar','.bot-drawing','.avatar-eyes','.avatar-eye-blink','.avatar-eye-reveal','.avatar-eye-open','.avatar-idle-glow','.avatar-listen-ring','.avatar-wave-bar rect','.avatar-surprise-marks','.avatar-sleep-marks path']) {
  check(`${selector}: reduced motion explicitly disables animation`, reducedValue(selector,'animation') === 'none !important');
}
check('Reduced motion also disables real speech light and wave-energy transforms', reducedValue('.expression-speaking .avatar-waveform','filter') === 'none !important'
  && reducedValue('.avatar-wave-energy','transform') === 'none' && reducedValue('.avatar-container .avatar-figure','transform') === 'none');
check('Reduced motion still shows a static listening ring and readable waveform', reducedValue('.expression-listening .avatar-listen-ring','opacity') === '.4'
  && reducedValue('.expression-speaking .avatar-wave-bar:nth-child(4) rect','transform') === 'scaleY(1)');
for (const avatar of ['orb','bot']) {
  const picker = await renderAvatar('AvatarSwitcher', {avatar});
  check(`picker/${avatar}: one selected native button and two labelled choices`, (picker.match(/aria-pressed="true"/g)||[]).length === 1
    && (picker.match(/<button/g)||[]).length === 2 && picker.includes('role="group" aria-label="Avatar style"'));
}
check('The Orb preview icon remains charcoal while matching the slender ratio', (await renderAvatar('AvatarSwitcher', {avatar:'orb'})).includes('width="3" height="7.55" rx="1.5" fill="#1a1a1a"'));

// ------------------------------------------------------ actual-CSS review gallery
const pose = {neutral:'', happy:'is-happy', wink:'', surprised:'', thinking:'is-thinking', sleepy:'', speaking:'is-speaking', listening:'is-listening', idle:'', waking:'is-listening is-waking'};
const notes = {neutral:'tall capsules · float and blink',happy:'matching curved eyes · double jump',wink:'one pill · one diagonal lid',surprised:'130% eyes · three rays',thinking:'one folded eye · shared gaze',sleepy:'closed curves · drifting Zs',speaking:'seven bars · live speech energy',listening:'open eyes · pulsing ring',idle:'subtle glow · ready for you'};
const sheet = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NOVA — avatar expressions</title>
<style>
${css}
${faceCss}
body { margin:0; padding:32px 24px; background:#08080e; }
.review-head,.review-section { max-width:1080px; margin:0 auto 28px; }
.review-head h1 { font-size:24px; color:#f7f6fb; margin:0 0 10px; }
.review-head p { font-size:12px; line-height:1.6; color:#aab0bf; max-width:860px; }
.review-head button { border:1px solid #57617b; background:#161b2b; color:#e0e9fc; border-radius:7px; padding:8px 14px; cursor:pointer; }
.review-section { padding:24px; border:1px solid; border-radius:16px; }
.review-orb { background:#130b05; border-color:#694320; --review-ink:#fff7ed; --review-muted:#b4a38f; }
.review-bot { background:#0a0a2e; border-color:#28437b; --review-ink:#e0f2fe; --review-muted:#a5b8d6; }
.review-section h2 { color:var(--review-ink); font-size:20px; margin:0 0 8px; }
.review-section p,.review-section h3 { color:var(--review-muted); font-size:11px; line-height:1.6; }
.review-section h3 { text-transform:uppercase; letter-spacing:.18em; margin:26px 0 12px; }
.review-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
.cell { display:flex; flex-direction:column; align-items:center; border:1px solid rgba(160,166,192,.18); border-radius:12px; padding:16px 8px; background:rgba(255,255,255,.012); }
.cell .avatar-container { animation:none; }
.cell-label { color:var(--review-ink); font:10px var(--mono); letter-spacing:.16em; margin-top:12px; }
.cell-note { color:var(--review-muted); font-size:10px; text-align:center; margin-top:8px; }
@media(max-width:950px){.review-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:620px){.review-grid{grid-template-columns:1fr}body{padding:24px 12px}}
</style></head><body>
<header class="review-head"><h1>NOVA — shared expressions, individual colors</h1><p>Real React-rendered SVG and application CSS. Orb keeps its dark eyes, white blob and amber effects; Bot keeps its blue eyes and helmet. All nine shapes and states use the same face components and reaction clock. No microphone, model or audio is used here. Speaking holds a labelled sample audio pulse of .8.</p><button id="replay" type="button">Replay happy jumps</button></header>
${Object.keys(models).map(skin=>`<section class="review-section review-${skin}"><h2>${skin==='orb'?'Orb — charcoal eyes / amber theme':'NOVA Bot — ice-blue eyes / navy theme'}</h2><p>Same expressions, not a color swap. In the app: a brief idle wink at 12s, sleepy at 45s; hover/touch wakes only the drawing. Listening and speech always take priority.</p>
${[['Expressions',expressions.slice(0,6)],['States',expressions.slice(6,9)]].map(([title,list])=>`<h3>${title}</h3><div class="review-grid">
${list.map(expression=>`<div class="cell"><div class="avatar-container ${skin==='bot'?'avatar-container-bot ':''}${pose[expression]}"${expression==='speaking'?' style="--audio-pulse:.8"':''}>${skin==='orb'?'<div class="avatar-backlight" aria-hidden="true"></div>':''}<div class="avatar-figure">${renders[skin][expression]}</div></div><div class="cell-label">${expression.toUpperCase()}</div><div class="cell-note">${notes[expression]}</div></div>`).join('\n')}
</div>`).join('\n')}</section>`).join('\n')}
<script>
const happy = [...document.querySelectorAll('.expression-happy')].map(node=>[node,node.className]);
document.getElementById('replay').addEventListener('click',()=>{
  for(const [node] of happy){node.classList.remove('expression-happy','activity-happy');node.closest('.avatar-container').classList.remove('is-happy')}
  void document.body.offsetWidth;
  for(const [node,names] of happy){node.className=names;node.closest('.avatar-container').classList.add('is-happy')}
});
</script></body></html>`;
check('Gallery shows all nine poses on each avatar', (sheet.match(/data-expression="/g)||[]).length === 18);
check('Gallery definitions are unique across both avatars and every pose', ids(sheet).length === new Set(ids(sheet)).size);
check('Gallery references all resolve locally', references(sheet).every(id=>ids(sheet).includes(id)));
await writeFile(resolve(root,'avatar-states.html'),sheet,'utf8');
for (const {label,ok,detail} of checks) console.log(`  ${ok?'PASS':'FAIL'}  ${label}${detail?` — ${detail}`:''}`);
const failed=checks.filter(c=>!c.ok).length;
console.log(failed?`\n${failed} check(s) failed.`:`\nAll ${checks.length} checks passed.\nWrote avatar-states.html — both palettes, all expressions.`);
if(failed)process.exitCode=1;
