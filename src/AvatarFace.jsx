// One set of facial geometry for both characters. Paint and placement belong
// to the skin: the Orb stays charcoal/amber; the Bot stays ice-blue/navy.
export function AvatarFaceDefinitions({ id, palette = 'ink' }) {
  return (
    <>
      {palette === 'ice' ? (
        <linearGradient id={id('eye')} x1="0" y1="-40" x2="8" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#D0F0FF" />
          <stop offset=".55" stopColor="#B7E6FF" />
          <stop offset="1" stopColor="#A8DBFA" />
        </linearGradient>
      ) : (
        <radialGradient id={id('eye')} cx=".5" cy=".5" r=".5">
          <stop className="avatar-eye-shade" offset="0" stopColor="#161616" />
          <stop className="avatar-eye-surface" offset="1" stopColor="#1a1a1a" />
        </radialGradient>
      )}
      {palette === 'ice' && (
        <filter id={id('eye-glow')} x="-100%" y="-50%" width="300%" height="200%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="bloom" />
          <feComponentTransfer in="bloom" result="soft"><feFuncA type="linear" slope=".32" /></feComponentTransfer>
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="edge" />
          <feMerge><feMergeNode in="soft" /><feMergeNode in="edge" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      )}
      <filter id={id('ring-glow')} x="-70%" y="-30%" width="240%" height="160%" colorInterpolationFilters="sRGB">
        <feGaussianBlur stdDeviation="3" result="glow" />
        <feMerge><feMergeNode in="glow" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </>
  );
}

export function AvatarEyes({ eyes, paint, roll = 0, scale = 1, glow = false, eyeShift }) {
  const bloom = glow ? paint('eye-glow') : undefined;
  return (
    <g className="avatar-eyes" style={eyeShift ? { '--eye-shift': eyeShift } : undefined}>
      <g className="avatar-eye-voice">
        {eyes.map(({ side, x, y }) => (
          <g className="avatar-eye-position" transform={`translate(${x} ${y})${roll ? ` rotate(${roll})` : ''}${scale !== 1 ? ` scale(${scale})` : ''}`} key={side}>
            <g className="avatar-eye-reveal">
              <g className="avatar-eye-blink">
                <g className={`avatar-eye avatar-eye-${side}`}>
                  <rect className="avatar-eye-open" x="-15.5" y="-39" width="31" height="78" rx="15.5" fill={paint('eye')} filter={bloom} />
                  <path className="avatar-eye-smile" d="M-20 7C-20-21 20-21 20 7" fill="none" stroke="var(--avatar-eye-line)" strokeWidth="7" strokeLinecap="round" filter={bloom} />
                  <path className="avatar-eye-wink" d="M-18 6L18-6" fill="none" stroke="var(--avatar-eye-line)" strokeWidth="7" strokeLinecap="round" filter={bloom} />
                  <path className="avatar-eye-sleep" d="M-21-4C-21 23 21 23 21-4" fill="none" stroke="var(--avatar-eye-line)" strokeWidth="7" strokeLinecap="round" filter={bloom} />
                  <path className="avatar-eye-thought" d="M-21-6C-8-4 4-4 16-7V18C16 37-12 38-14 20L-16 2H-21Z" fill={paint('eye')} filter={bloom} />
                </g>
              </g>
            </g>
          </g>
        ))}
      </g>
    </g>
  );
}

export function AvatarWaveform({ transform, paint, glow = false }) {
  return (
    <g className="avatar-waveform" transform={transform} fill="var(--avatar-wave-color)">
      <g className="avatar-wave-energy" filter={glow ? paint('eye-glow') : undefined}>
        {[28, 52, 78, 102, 74, 48, 26].map((height, index) => (
          <g className="avatar-wave-bar" transform={`translate(${(index - 3) * 18} 0)`} key={index}>
            <rect x="-3.5" y={-height / 2} width="7" height={height} rx="3.5" />
          </g>
        ))}
      </g>
    </g>
  );
}

export function AvatarIndicators({ contour, paint, ringWidth = 3, surpriseTransform, sleepTransform }) {
  return (
    <>
      <path className="avatar-idle-glow" d={contour} stroke="var(--avatar-face-accent)" strokeWidth={ringWidth + 1} filter={paint('ring-glow')} />
      <path className="avatar-listen-ring" d={contour} stroke="var(--avatar-face-accent)" strokeWidth={ringWidth} filter={paint('ring-glow')} />
      <g className="avatar-surprise-marks" transform={surpriseTransform} stroke="var(--avatar-surprise-color)" strokeWidth="5" strokeLinecap="round">
        <path d="m-29 5-10-18M0 0v-24M29 5l10-18" />
      </g>
      <g className="avatar-sleep-marks" transform={sleepTransform} stroke="var(--avatar-face-accent)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M0 0h12l-12 14h12" />
        <path d="M17-25h15l-15 18h15" />
        <path d="M37-53h18l-18 22h18" />
      </g>
    </>
  );
}
