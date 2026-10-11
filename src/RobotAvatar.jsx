// ARIA's avatar. Purely presentational: every expression is driven by state classes
// on `.avatar-container` from index.css, so all motion lives in one place.
//
// There is deliberately no mouth. Expression comes from the eyes and the body only,
// so the eye markup is layered to let each kind of motion compose without fighting:
//
//   .robot-eye   — gaze (look side to side), the outermost transform
//   .eye-scale   — size: grow, squint, droop; a transitioned static transform
//   .eye-lid     — blinking, the only animated scaleY, plus iris glow
//
// Separate elements keep a blink from overriding a size change: nested transforms
// multiply, whereas sharing one element would make the animation win outright.

const EYES = [
  { side: 'left', cx: 105, sparkX: 103.4, crescent: 'M98.2 130.6Q105 123.4 111.8 130.6' },
  { side: 'right', cx: 175, sparkX: 173.4, crescent: 'M168.2 130.6Q175 123.4 181.8 130.6' },
];

function Eye({ side, cx, sparkX, crescent }) {
  return (
    <g className={`robot-eye robot-eye-${side}`}>
      <g className="eye-scale">
        <g className="eye-lid">
          <ellipse className="eye-iris" cx={cx} cy="129" rx="5.2" ry="7.2" fill="#5C4636" />
          <ellipse className="eye-spark" cx={sparkX} cy="126.8" rx="1.5" ry="1.8" fill="#FFFDF8" opacity=".9" />
        </g>
      </g>
      {/* Closed, upward-curving eye used for the happy state. */}
      <path className="eye-crescent" d={crescent} stroke="#5C4636" strokeWidth="3.4" strokeLinecap="round" />
    </g>
  );
}

function RobotAvatar() {
  return (
    <svg className="robot-avatar" viewBox="0 0 280 280" fill="none" role="img" aria-label="ARIA, a softly glowing orb with expressive eyes">
      <defs>
        <radialGradient id="orbSurface" cx="0" cy="0" r="1" gradientTransform="matrix(145 164 -153 135 93 76)" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFDF9" />
          <stop offset=".48" stopColor="#FFF8EF" />
          <stop offset=".8" stopColor="#F2E5D5" />
          <stop offset="1" stopColor="#D8C4AE" />
        </radialGradient>
        <radialGradient id="orbHighlight" cx="0" cy="0" r="1" gradientTransform="matrix(48 54 -49 44 91 72)" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" stopOpacity=".9" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <filter id="orbBloom" x="-45%" y="-45%" width="190%" height="190%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="15" />
        </filter>
        <filter id="orbShadow" x="-35%" y="-25%" width="170%" height="180%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="11" stdDeviation="10" floodColor="#000000" floodOpacity=".28" />
        </filter>
      </defs>

      <circle className="orb-bloom" cx="140" cy="140" r="106" fill="#FFF0DB" filter="url(#orbBloom)" />
      <path className="blob-shape" d="M141 29C202 29 251 77 251 139C251 199 207 247 146 251C83 254 31 208 29 146C27 84 74 32 134 29C136 29 139 29 141 29Z" fill="url(#orbSurface)" stroke="#FFFDFC" strokeOpacity=".88" strokeWidth="2" filter="url(#orbShadow)" />
      <ellipse cx="116" cy="83" rx="52" ry="39" fill="url(#orbHighlight)" opacity=".72" />
      <path d="M63 171C73 215 108 237 146 237" stroke="#C6AD92" strokeOpacity=".22" strokeWidth="2" strokeLinecap="round" />
      <path d="M217 76C237 95 246 119 246 144" stroke="#FFFFFF" strokeOpacity=".58" strokeWidth="2" strokeLinecap="round" />

      {EYES.map((eye) => <Eye key={eye.side} {...eye} />)}
    </svg>
  );
}

export default RobotAvatar;
