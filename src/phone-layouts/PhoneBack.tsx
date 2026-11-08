type PhoneBackProps = { model: string };

/** Minimal device outline; device details are intentionally left out so the Glyph stays prominent. */
export function PhoneBack({ model }: PhoneBackProps) {
  const bounds = model === 'NP1' || model === 'NP1_15'
    ? { x: 16, y: -12, width: 458, height: 988, radius: 62 }
    : model === 'NP2'
      ? { x: 10, y: 8, width: 460, height: 958, radius: 60 }
      : model === 'NP2a' || model === 'NP2aPlus'
        ? { x: 216, y: -30, width: 388, height: 876, radius: 48 }
        : model === 'NP3a'
          ? { x: 9, y: 8, width: 1038, height: 1984, radius: 123 }
          : { x: 10, y: 8, width: 460, height: 958, radius: 60 };
  const inset = model === 'NP2a' || model === 'NP2aPlus' ? 11 : 12;
  return <g aria-hidden="true">
    <defs><linearGradient id="phoneGlass" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#242a2d"/><stop offset=".46" stopColor="#111517"/><stop offset="1" stopColor="#090b0d"/></linearGradient></defs>
    <rect x={bounds.x + inset} y={bounds.y + inset} width={bounds.width - inset * 2} height={bounds.height - inset * 2} rx={Math.max(12, bounds.radius - inset)} fill="url(#phoneGlass)" stroke="#5a6467" strokeOpacity=".58" strokeWidth={model === 'NP3a' ? 5 : 4}/>
  </g>;
}
