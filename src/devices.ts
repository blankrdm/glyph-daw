export const DEVICE_ZONES={NP1:5,NP1_15:15,NP2:33,NP2a:26,NP2aPlus:26,NP3a:36,NP3:625} as const;
export const DEVICE_NAMES={NP1:'Phone (1)',NP1_15:'Phone (1) · Experimental 15 zone',NP2:'Phone (2)',NP2a:'Phone (2a)',NP2aPlus:'Phone (2a Plus)',NP3a:'Phone (3a / 3a Pro)',NP3:'Phone (3)'} as const;
export const GLYPH_STEP_MS=16.666;
export const MAX_BRIGHTNESS=4095;

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
    if (index <= 1) return 3;
    if (index === 2 || index === 19) return 1;
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
  return [...new Set(Array.from({ length: zoneCount }, (_, zone) => glyphGroupForZone(model, zone)))];
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
