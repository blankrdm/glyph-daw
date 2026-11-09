export const DEVICE_ZONES={NP1:5,NP1_15:15,NP2:33,NP2a:26,NP2aPlus:26,NP3a:36,NP3:625} as const;
export const DEVICE_NAMES={NP1:'Phone (1)',NP1_15:'Phone (1) · Experimental 15 zone',NP2:'Phone (2)',NP2a:'Phone (2a)',NP2aPlus:'Phone (2a Plus)',NP3a:'Phone (3a / 3a Pro)',NP3:'Phone (3)'} as const;
export const GLYPH_STEP_MS=16.666;
export const MAX_BRIGHTNESS=4095;

export type GlyphLightMode = 'Normal' | 'Fill' | 'Sweep' | 'Zones' | 'Flicker' | 'Random Flicker';
export type GlyphLightDirection = 'forward' | 'reverse' | 'forward-instant' | 'reverse-instant';

export function glyphLightAnimationState(elapsedSeconds: number, clipDuration: number, customSpeed?: number, loop = false) {
  const animationDuration = customSpeed && customSpeed > 0 ? clipDuration / customSpeed : clipDuration;
  const rawProgress = Math.max(0, elapsedSeconds) / Math.max(.001, animationDuration);
  if (customSpeed && loop) return { progress: rawProgress % 1, holdAtEnd: false };
  return { progress: Math.min(1, rawProgress), holdAtEnd: Boolean(customSpeed && rawProgress >= 1) };
}

/** Physical LED zones controlled by a grouped or individual track. */
export function glyphZonesForTrack(model: string, track: number, grouped: boolean): number[] {
  const zoneCount = DEVICE_ZONES[model as keyof typeof DEVICE_ZONES] ?? 0;
  if (!grouped) return track >= 0 && track < zoneCount && isVisibleGlyphZone(model, track) ? [track] : [];
  if (model === 'NP2' && track === 6) return [21];
  return Array.from({ length: zoneCount }, (_, zone) => zone)
    .filter(zone => glyphGroupForZone(model, zone) === track && isVisibleGlyphZone(model, zone));
}

/** Hardware-zone order for Glyph paths that can be animated as a strip. */
export function glyphStripZoneOrder(model: string, group: number): number[] {
  // Keep these in the device's documented progress order, not screen-coordinate order.
  if (model === 'NP2' && group === 0) return Array.from({ length: 16 }, (_, i) => i + 3);
  if (model === 'NP2' && group === 2) return Array.from({ length: 8 }, (_, i) => i + 25);
  if ((model === 'NP2a' || model === 'NP2aPlus') && group === 0) return Array.from({ length: 24 }, (_, i) => i);
  if (model === 'NP3a' && group === 0) return Array.from({ length: 20 }, (_, i) => i);
  if (model === 'NP3a' && group === 1) return Array.from({ length: 11 }, (_, i) => i + 20);
  if (model === 'NP3a' && group === 2) return Array.from({ length: 5 }, (_, i) => i + 31);
  if (model === 'NP1_15' && group === 0) return [2, 3, 4, 5];
  return [];
}

export function glyphStripForTrack(model: string, track: number, grouped: boolean): number[] {
  const strip = glyphStripZoneOrder(model, grouped ? track : glyphGroupForZone(model, track));
  return grouped || strip.includes(track) ? strip : [];
}

/** Resolve the physical zones lit by one clip at normalized clip progress. */
export function glyphClipZoneWeights(
  model: string,
  track: number,
  grouped: boolean,
  mode: GlyphLightMode | undefined,
  direction: GlyphLightDirection | undefined,
  progress: number,
  sweepWidth = 3,
  fillAmount?: number,
  selectedZones?: number[],
  holdAtEnd = false,
  flickerGap?: number,
): Array<[zone: number, weight: number]> {
  const normalZones = glyphZonesForTrack(model, track, grouped);
  if (mode === 'Zones') {
    const selected = selectedZones ? new Set(selectedZones) : null;
    return normalZones.filter(zone => !selected || selected.has(zone)).map(zone => [zone, 1] as [number, number]);
  }
  if (mode === 'Flicker') {
    const frame = Math.floor(Math.max(0, Math.min(1, progress)) * 60);
    const pulse = Math.floor(frame / 3);
    const level = flickerLevel(pulse, 0);
    return normalZones.filter(zone => isVisibleGlyphZone(model, zone)).map(zone => [zone, level]);
  }
  if (mode === 'Random Flicker') {
    const frame = Math.floor(Math.max(0, Math.min(1, progress)) * 60);
    const pulse = Math.floor(frame / 3);
    const zones = normalZones.filter(zone => isVisibleGlyphZone(model, zone));
    const candidates = zones.map((zone, index) => ({ zone, index, weight: flickerLevel(pulse, zone + 1), rank: flickerHash(pulse, zone + 1) }))
      .filter(candidate => candidate.weight > 0)
      .sort((a, b) => (a.rank >>> 0) - (b.rank >>> 0));
    const selected: typeof candidates = [];
    const gap = Math.max(0, Math.round(flickerGap ?? 0));
    for (const candidate of candidates) {
      if (flickerGap === undefined || selected.every(other => Math.abs(other.index - candidate.index) > gap)) selected.push(candidate);
    }
    const weights = new Map(selected.map(candidate => [candidate.zone, candidate.weight]));
    return zones.map(zone => [zone, weights.get(zone) ?? 0]);
  }
  if (mode !== 'Fill' && mode !== 'Sweep') return normalZones.filter(zone => isVisibleGlyphZone(model, zone)).map(zone => [zone, 1]);

  let strip = glyphStripForTrack(model, track, grouped);
  if (strip.length < 2) return normalZones.filter(zone => isVisibleGlyphZone(model, zone)).map(zone => [zone, 1]);
  const reverse = direction === 'reverse' || direction === 'reverse-instant';
  const instant = direction === 'forward-instant' || direction === 'reverse-instant';
  if (reverse) strip = strip.reverse();
  const position = Math.max(0, Math.min(1, progress));
  if (mode === 'Fill') {
    const fillLength = Math.max(1, Math.min(strip.length, Math.round(fillAmount ?? strip.length) || strip.length));
    if (instant) {
      return strip.slice(0, fillLength).filter(zone => isVisibleGlyphZone(model, zone)).map(zone => [zone, 1]);
    }
    const filledPosition = position * (fillLength - 1) + 1;
    return strip.map((zone, index) => [zone, Math.max(0, Math.min(1, filledPosition - index))] as [number, number])
      .filter(([zone, weight]) => weight > 0 && isVisibleGlyphZone(model, zone));
  }
  if (instant) return strip.filter(zone => isVisibleGlyphZone(model, zone)).map(zone => [zone, 1]);
  const width = Math.max(1, Math.min(strip.length, Math.round(sweepWidth) || 1));
  const headPosition = position * (strip.length - 1);
  const head = Math.floor(headPosition);
  const fraction = headPosition - head;
  const endFade = holdAtEnd ? 1 : Math.min(1, (1 - position) / .18);
  const zones: Array<[zone: number, weight: number]> = [];
  for (let index = 0; index < strip.length; index += 1) {
    const atHead = index <= head && index >= head - width + 1 ? 1 : 0;
    const nextHead = Math.min(strip.length - 1, head + 1);
    const atNextHead = index <= nextHead && index >= nextHead - width + 1 ? 1 : 0;
    const weight = (atHead * (1 - fraction) + atNextHead * fraction) * endFade;
    const zone = strip[index];
    if (weight > 0 && isVisibleGlyphZone(model, zone)) zones.push([zone, weight]);
  }
  return zones;
}

function flickerLevel(pulse: number, salt: number): number {
  if (pulse === 0) return 1;
  const hash = flickerHash(pulse, salt);
  const level = (hash >>> 0) % 10;
  return level < 6 ? 1 : level < 8 ? .35 : 0;
}

function flickerHash(pulse: number, salt: number): number {
  let hash = Math.imul(pulse + 1, 0x45d9f3b) ^ Math.imul(salt + 1, 0x27d4eb2d);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x45d9f3b);
  hash ^= hash >>> 16;
  return hash;
}

/** Keep in sync with PhonePreview's grouped-zone mapping so exported patterns
 * light the same physical Glyphs that the grouped monitor displays. */
export function glyphGroupForZone(model: string, index: number): number {
  if (model === 'NP1') return [3, 1, 0, 2, 5][index] ?? 0;
  if (model === 'NP1_15') {
    if (index === 0) return 3;
    if (index === 1) return 1;
    if (index >= 2 && index <= 5) return 0;
    if (index === 6) return 5;
    return 2;
  }
  if (model === 'NP2') {
    if (index === 0) return 3;
    if (index === 1) return 9;
    if (index === 2) return 1;
    if (index === 19) return 10;
    if (index === 20) return 7;
    if (index === 21) return 6;
    if (index === 22) return 8;
    if (index >= 3 && index <= 18) return 0;
    if (index === 23) return 4;
    if (index === 24) return 5;
    if (index >= 25) return 2;
    return 0;
  }
  if (model === 'NP2a' || model === 'NP2aPlus') return index < 24 ? 0 : index === 24 ? 1 : 2;
  if (model === 'NP3a') return index < 20 ? 0 : index < 31 ? 1 : 2;
  // The Phone (3) monitor treats the matrix as one grouped control (Dot matrix).
  return model === 'NP3' ? 5 : 0;
}

export function glyphGroupIds(model: string): number[] {
  const zoneCount = DEVICE_ZONES[model as keyof typeof DEVICE_ZONES] ?? 0;
  const groups = [...new Set(Array.from({ length: zoneCount }, (_, zone) => glyphGroupForZone(model, zone)))];
  // Keep Phone (2)'s track order stable while exposing the side glyphs separately.
  return model === 'NP2' ? [3, 9, 1, 10, 0, 4, 6, 2, 5, 7, 8] : groups;
}

/** Button IDs used by the composer's CUSTOM1 timeline dots. */
export function glyphButtonForZone(model: string, zone: number): number | null {
  if (model === 'NP1') return zone >= 0 && zone < 5 ? zone : null;
  if (model === 'NP1_15') {
    if (zone === 0) return 0;
    if (zone === 1) return 1;
    if (zone >= 2 && zone <= 5) return 2;
    if (zone === 6) return 4;
    if (zone >= 7 && zone <= 14) return 3;
    return null;
  }
  if (model === 'NP2') {
    if (zone === 0 || zone === 1) return 0;
    if (zone === 2) return 1;
    if ((zone >= 3 && zone <= 23)) return 2;
    if (zone === 24) return 3;
    if (zone >= 25 && zone <= 32) return 4;
    return null;
  }
  if (model === 'NP2a' || model === 'NP2aPlus') {
    if (zone >= 0 && zone <= 23) return 0;
    if (zone === 24) return 1;
    if (zone === 25) return 2;
    return null;
  }
  if (model === 'NP3a') {
    if (zone >= 0 && zone <= 19) return 0;
    if (zone >= 20 && zone <= 30) return 1;
    if (zone >= 31 && zone <= 35) return 2;
  }
  return null;
}

export function glyphButtonsForGroup(model: string, group: number): number[] {
  if (model === 'NP2' && group === 6) return [2];
  const zoneCount = DEVICE_ZONES[model as keyof typeof DEVICE_ZONES] ?? 0;
  return [...new Set(Array.from({ length: zoneCount }, (_, zone) =>
    glyphGroupForZone(model, zone) === group ? glyphButtonForZone(model, zone) : null
  ).filter((button): button is number => button !== null))];
}

/** Only 489 cells in Phone (3)'s 25×25 matrix are physical LEDs. */
export function isVisibleGlyphZone(model: string, zone: number): boolean {
  if (model !== 'NP3') return true;
  const visibleRows: Array<[number, number]> = [
    [9, 15], [32, 42], [55, 69], [79, 95], [103, 121], [127, 147],
    [152, 172], [176, 198], [201, 223], [225, 399], [401, 423],
    [426, 448], [452, 472], [477, 497], [503, 521], [529, 545],
    [555, 569], [582, 592], [609, 615],
  ];
  return visibleRows.some(([first, last]) => zone >= first && zone <= last);
}
