import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import pako from 'pako';
import type { Clip } from './store';
import { DEVICE_ZONES, glyphButtonForZone, glyphButtonsForGroup, glyphClipZoneWeights, glyphGroupForZone, glyphLightAnimationState, isVisibleGlyphZone, type GlyphLightDirection, type GlyphLightMode } from './devices';

const devices: Record<string, { composer: string; zones: number; custom2: string }> = {
  NP1: { composer: 'v1-Spacewar Glyph Composer', zones: 5, custom2: '5cols' },
  NP1_15: { composer: 'v1-Spacewar Glyph Composer', zones: 15, custom2: '5cols' },
  NP2: { composer: 'v1-Pong Glyph Composer', zones: 33, custom2: '33cols' },
  NP2a: { composer: 'v1-Pacman Glyph Composer', zones: 26, custom2: '26cols' },
  NP2aPlus: { composer: 'v1-PacmanPro Glyph Composer', zones: 26, custom2: '26cols' },
  NP3a: { composer: 'v1-Asteroids Glyph Composer', zones: 36, custom2: '36cols' },
  NP3: { composer: 'v1-Metroid Glyph Composer', zones: 625, custom2: '625cols' },
};

type ExportClip = Clip & { effect?: string; effectSpeed?: number; lightMode?: GlyphLightMode; direction?: GlyphLightDirection; tailLength?: number; fillAmount?: number; selectedZones?: number[]; flickerGap?: number; animationSpeed?: number; animationTime?: number; loopAnimation?: boolean };

const FRAME_RATE = 60;
const EMPTY_CUSTOM1 = 'eNoDAAAAAAE=';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function encodeCustom1(clips: ExportClip[], model: string, grouped: boolean, rangeStart: number, rangeEnd: number): string {
  const events = new Set<string>();
  for (const clip of clips) {
    if (clip.track < 0 || clip.brightness <= 0 || clip.duration <= 0 || clip.start >= rangeEnd || clip.start + clip.duration <= rangeStart) continue;
    const buttons = grouped
      ? glyphButtonsForGroup(model, clip.track)
      : [glyphButtonForZone(model, clip.track)].filter((button): button is number => button !== null);
    const timestamp = Math.max(0, Math.round((Math.max(rangeStart, clip.start) - rangeStart) * 1000));
    for (const button of buttons) events.add(`${timestamp}-${button}`);
  }
  if (!events.size) return EMPTY_CUSTOM1;
  const csv = `${[...events].map(event => {
    const [time, button] = event.split('-');
    return [Number(time), Number(button)] as const;
  }).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([time, button]) => `${time}-${button}`).join(',')},`;
  return bytesToBase64(pako.deflate(csv, { level: 9 }));
}

function encodeGlyphCsv(clips: ExportClip[], model: string, grouped: boolean, duration: number, master: number, rangeStart: number) {
  const zoneCount = DEVICE_ZONES[model as keyof typeof DEVICE_ZONES];
  const frames = Math.ceil(duration * FRAME_RATE);
  if (frames < 1) throw new Error('The audio duration is too short to export.');

  const frameOffset = Math.floor(rangeStart * FRAME_RATE);
  const starts = clips.map(c => Math.max(0, Math.floor(c.start * FRAME_RATE)));
  const ends = clips.map((c, i) => Math.max(starts[i], Math.floor((c.start + c.duration) * FRAME_RATE)));
  const compressor = new pako.Deflate({ level: 9 });
  const compressed: Uint8Array[] = [];
  compressor.onData = chunk => compressed.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer));
  const encoder = new TextEncoder();
  let pending: string[] = [];
  let pendingSize = 0;

  for (let frame = 0; frame < frames; frame += 1) {
    const sourceFrame = frame + frameOffset;
    const row = new Uint16Array(zoneCount);
    for (let i = 0; i < clips.length; i += 1) {
      const clip = clips[i];
      if (clip.track < 0 || sourceFrame < starts[i] || sourceFrame >= ends[i]) continue;
      const elapsed = sourceFrame - starts[i];
      const total = Math.max(1, ends[i] - starts[i]);
      const progress = elapsed / total;
      const effectAnimation = glyphLightAnimationState(elapsed / FRAME_RATE, total / FRAME_RATE, clip.effectSpeed, clip.effect === 'Pulse');
      const effectProgress = clip.effectSpeed === undefined ? progress : effectAnimation.progress;
      const clipDuration = total / FRAME_RATE;
      const animationSpeed = clip.animationSpeed ?? (clip.animationTime ? clipDuration / clip.animationTime : undefined);
      const lightAnimation = glyphLightAnimationState(elapsed / FRAME_RATE, clipDuration, animationSpeed, clip.loopAnimation);
      const base = clip.brightness * 40.95 * master / 100;
      let brightness = base;
      if (clip.effect === 'Fade in') brightness *= effectProgress;
      else if (clip.effect === 'Fade out') brightness *= 1 - effectProgress;
      else if (clip.effect === 'Pulse') brightness *= .35 + .65 * (.5 + .5 * Math.sin(effectProgress * Math.PI * 4));
      else if (clip.effect === 'Strobe') brightness = Math.floor(elapsed * (clip.effectSpeed ?? 1) / 12) % 2 === 0 ? base : 0;
      const encoded = Math.max(0, Math.min(4095, Math.round(brightness)));
      for (const [zone, weight] of glyphClipZoneWeights(model, clip.track, grouped, clip.lightMode, clip.direction, lightAnimation.progress, clip.tailLength, clip.fillAmount, clip.selectedZones, lightAnimation.holdAtEnd, clip.flickerGap)) {
        if (zone >= 0 && zone < zoneCount && isVisibleGlyphZone(model, zone)) row[zone] = Math.max(row[zone], Math.round(encoded * weight));
      }
    }
    const text = `${Array.from(row).join(',')},\r\n`;
    pending.push(text); pendingSize += text.length;
    if (pendingSize >= 65536) {
      compressor.push(encoder.encode(pending.join('')), false);
      pending = []; pendingSize = 0;
    }
  }
  if (pending.length) compressor.push(encoder.encode(pending.join('')), false);
  compressor.push(new Uint8Array(), true);
  if (compressor.err) throw new Error(compressor.msg || 'Could not compress Glyph data.');

  const totalBytes = compressed.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const part of compressed) { merged.set(part, offset); offset += part.length; }
  return bytesToBase64(merged);
}

export async function exportGlyphOga(
  audio: File,
  clips: ExportClip[],
  device: string,
  duration: number,
  title: string,
  master = 100,
  author = '',
  deviceMode: 'Grouped' | 'Individual' = 'Grouped',
  onProgress?: (progress: number) => void,
  cropStart = 0,
  cropEnd = duration,
  fadeInSeconds = 0,
  fadeOutSeconds = 0,
) {
  const config = devices[device];
  if (!config) throw new Error('Unsupported device.');
  if (!audio.size) throw new Error('The selected audio file is empty.');
  if (!Number.isFinite(duration) || duration <= 0 || duration > 600) {
    throw new Error('Audio duration must be between 0 and 600 seconds.');
  }
  const start = Math.max(0, Math.min(duration, cropStart));
  const end = Math.max(start, Math.min(duration, cropEnd));
  const outputDuration = end - start;
  if (outputDuration <= 0) throw new Error('The export range is empty. Set the loop range to at least one frame.');
  const glyphData = encodeGlyphCsv(clips, device, deviceMode === 'Grouped', outputDuration, master, start);
  const fadeIn = Math.max(0, Math.min(outputDuration, Number.isFinite(fadeInSeconds) ? fadeInSeconds : 0));
  const fadeOut = Math.max(0, Math.min(outputDuration, Number.isFinite(fadeOutSeconds) ? fadeOutSeconds : 0));
  const audioFades = [
    ...(fadeIn > 0 ? [`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`] : []),
    ...(fadeOut > 0 ? [`afade=t=out:st=${Math.max(0, outputDuration - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`] : []),
  ];
  const ffmpeg = new FFmpeg();
  ffmpeg.on('progress', ({ progress }) => onProgress?.(Math.max(0, Math.min(1, progress))));
  const ffmpegLogs: string[] = [];
  ffmpeg.on('log', ({ message }) => { ffmpegLogs.push(message); if (ffmpegLogs.length > 30) ffmpegLogs.shift(); });
  // Keep the WASM core in lockstep with @ffmpeg/ffmpeg in package-lock.json.
  // Vite apps need the ESM core build; FFmpeg's usage guide calls this out.
  const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

  try {
    await ffmpeg.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    const ext = audio.name.split('.').pop()?.toLowerCase() || 'mp3';
    const input = `glyph-input.${ext}`;
    const output = 'glyph-output.ogg';
    await ffmpeg.writeFile(input, await fetchFile(audio));
    try {
      await ffmpeg.exec([
        ...(start > 0 ? ['-ss', String(start)] : []),
        '-i', input,
        '-t', String(outputDuration),
        '-map', '0:a:0',
        '-map_metadata', '-1',
        '-strict', '-2',
        '-metadata', `AUTHOR=${glyphData}`,
        '-metadata', `TITLE=${title}`,
        ...(author ? ['-metadata', `ARTIST=${author}`, '-metadata', `COMMENT=Created by ${author} - Glyph DAW`] : []),
        '-metadata', `COMPOSER=${config.composer}`,
        '-metadata', 'ALBUM=BNGC v1',
        '-metadata', `CUSTOM1=${encodeCustom1(clips, device, deviceMode === 'Grouped', start, end)}`,
        '-metadata', `CUSTOM2=${config.custom2}`,
        ...(audioFades.length ? ['-af', audioFades.join(',')] : []),
        // This FFmpeg.wasm configuration previously produced a complete file;
        // the 24 kHz input avoids the earlier WASM resampler memory error.
        '-ar', '24000', '-c:a', 'libopus', '-b:a', '48k', '-vn', '-sn', '-dn', '-f', 'ogg', output,
      ]);
    } catch (error) {
      const detail = ffmpegLogs.slice(-8).join('\n');
      throw new Error(`${error instanceof Error ? error.message : String(error)}${detail ? `\n${detail}` : ''}`);
    }
    const result = await ffmpeg.readFile(output);
    if (!(result instanceof Uint8Array) || result.byteLength === 0) {
      throw new Error(`FFmpeg created an empty OGG file.${ffmpegLogs.length ? ` ${ffmpegLogs.slice(-5).join(' | ')}` : ''}`);
    }
    // The reference Glyph Composer workflow imports .ogg files.
    const blob = new Blob([result as Uint8Array<ArrayBuffer>], { type: 'audio/ogg' });
    if (blob.size === 0) throw new Error('The generated OGG download is empty.');
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${title.replace(/[^a-z0-9_-]/gi, '_') || 'glyph-tone'}.ogg`;
    anchor.click();
    // Allow time for browser/OS Save dialogs to finish consuming the Blob URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } finally {
    try { await ffmpeg.terminate(); } catch { /* FFmpeg may not have finished loading. */ }
  }
}
