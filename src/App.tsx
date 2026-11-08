import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowDownToLine, CircleHelp, Copy, Grid2X2,
  Maximize2, MoreHorizontal, Pause, Play, Plus, Redo2,
  RotateCcw, Search, SkipBack, SlidersHorizontal, Square, Undo2,
  Upload, Volume2, AudioWaveform, Workflow, ZoomIn, ZoomOut, Scissors,
  Trash2, Save, FolderOpen, WandSparkles, Repeat2, Lock, LockOpen,
} from 'lucide-react';
import { useDaw, type Clip } from './store';
import { exportGlyphOga } from './oga';
import { DEVICE_NAMES, DEVICE_ZONES, GLYPH_STEP_MS, glyphClipZoneWeights, glyphGroupForZone, glyphGroupIds, glyphStripForTrack, glyphZonesForTrack, type GlyphLightDirection, type GlyphLightMode } from './devices';
import { PhonePreview } from './PhonePreview';

const COLORS = ['#f5f5f5', '#83e5d8', '#ff765f', '#c49bff', '#7bb8ff', '#f6c76c'];
const EFFECTS = ['Steady', 'Fade in', 'Fade out', 'Pulse', 'Strobe'];
const TRACK_LABELS = ['Main arc', 'Upper bar', 'Lower bar', 'Camera ring', 'Side strip', 'Lower dot', 'Battery lower-left', 'Left vertical', 'Lower-right arc'];
const MAX_TIMELINE_ZOOM = 10;
const SNAP_OPTIONS = ['Off', '10 ms', '50 ms', '100 ms', '1/32', '1/16', '1/8', '1/4', '1/2'];
type GlyphEffect = 'Steady' | 'Fade in' | 'Fade out' | 'Pulse' | 'Strobe';
type ExtendedClip = Clip & { effect?: GlyphEffect; lightMode?: GlyphLightMode; direction?: GlyphLightDirection; tailLength?: number; fillAmount?: number; selectedZones?: number[]; locked?: boolean };
type Project = { version: number; title: string; device: string; duration: number; clips: ExtendedClip[]; audioName?: string; audioData?: string; audioType?: string; brightness?: number; tempo?: number; snap?: string; deviceMode?: 'Grouped' | 'Individual'; author?: string };
const LEGACY_LIME_CLIP_COLORS = new Set(['#d9ff5a', '#e5ff83', '#a7df70', '#a6c743', '#a8ce4a', '#a3c65b', '#9fbf67']);
function normalizeClipColor(color: string): string {
  return LEGACY_LIME_CLIP_COLORS.has(color.toLowerCase()) ? '#f5f5f5' : color;
}

function nearestFreeStart(_clips: Clip[], _track: number, desired: number, _duration: number, _excludeId?: string) {
  // Clips are independent Glyph events and may overlap on the same light lane.
  return Math.max(0, desired);
}

function durationBeforeNextClip(_clips: Clip[], _track: number, _start: number, desired: number, _excludeId?: string) {
  return Math.max(.05, desired);
}

function moveClipGroup(clips: Clip[], ids: string[], primaryId: string, primaryStart: number, primaryTrack: number, trackOrder: number[]) {
  const primary = clips.find(c => c.id === primaryId);
  if (!primary) return clips;
  const moving = clips.filter(c => ids.includes(c.id) && !(c as ExtendedClip).locked).sort((a, b) => a.track - b.track || a.start - b.start);
  const movingIds = new Set(moving.map(c => c.id));
  const occupied = clips.filter(c => !movingIds.has(c.id));
  const placed: Clip[] = [];
  const delta = primaryStart - primary.start;
  const originalTrackIndex = trackOrder.indexOf(primary.track);
  const destinationTrackIndex = trackOrder.indexOf(primaryTrack);
  const trackDelta = originalTrackIndex < 0 || destinationTrackIndex < 0 ? 0 : destinationTrackIndex - originalTrackIndex;
  const destinationFor = (track: number) => {
    const index = trackOrder.indexOf(track);
    return trackOrder[Math.max(0, Math.min(trackOrder.length - 1, index + trackDelta))] ?? track;
  };
  for (const item of moving) {
    const track = item.id === primaryId ? primaryTrack : destinationFor(item.track);
    const start = item.id === primaryId ? primaryStart : item.start + delta;
    placed.push({ ...item, track, start: nearestFreeStart([...occupied, ...placed], track, start, item.duration, item.id) });
  }
  return [...occupied, ...placed];
}

type WaveformBin = { min: number; max: number };

function useAudioPeaks(file: File | null) {
  const [peaks, setPeaks] = useState<WaveformBin[]>([]);
  const [analysis, setAnalysis] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!file) { setPeaks([]); setAnalysis([]); setLoading(false); setError(false); return; }
    setLoading(true); setError(false); setPeaks([]); setAnalysis([]);
    void (async () => {
      let context: AudioContext | null = null;
      try {
        const data = await file.arrayBuffer();
        context = new AudioContext();
        const audio = await context.decodeAudioData(data);
        const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));
        // Keep enough waveform detail to follow transients at normal timeline
        // zoom levels, while capping work for very long recordings.
        const bins = Math.max(320, Math.min(8192, Math.ceil(audio.duration * 80)));
        const sampleCount = channels[0]?.length ?? 0;
        const result = Array.from({ length: bins }, (): WaveformBin => ({ min: 1, max: -1 }));
        // Keep a 100 Hz RMS envelope for generation/BPM analysis. The display
        // waveform and analysis are both calculated in this single sample pass.
        const hop = Math.max(1, Math.floor(audio.sampleRate / 100));
        const envelope: number[] = [];
        let energy = 0;
        let energyCount = 0;
        const analysisChannel = channels[0];
        for (let j = 0; j < sampleCount; j += 1) {
          let sample = 0;
          for (const channel of channels) sample += channel[j] / channels.length;
          const bin = result[Math.min(bins - 1, Math.floor(j * bins / sampleCount))];
          bin.min = Math.min(bin.min, sample);
          bin.max = Math.max(bin.max, sample);

          const analysisSample = analysisChannel[j];
          energy += analysisSample * analysisSample;
          energyCount += 1;
          if (energyCount === hop || j === sampleCount - 1) {
            envelope.push(Math.sqrt(energy / energyCount));
            energy = 0;
            energyCount = 0;
          }
        }
        if (!cancelled) { setPeaks(result); setAnalysis(envelope); }
      } catch {
        if (!cancelled) { setPeaks([]); setAnalysis([]); setError(true); }
      } finally {
        if (context) await context.close();
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [file]);
  return { peaks, analysis, loading, error };
}

const WaveBars = memo(function WaveBars({ peaks, base, amplitude, limit = Infinity, stride = 1 }: { peaks: number[]; base: number; amplitude: number; limit?: number; stride?: number }) {
  return <>{peaks.filter((_, i) => i % stride === 0).slice(0, limit).map((peak, i) => <i key={i} style={{ height: `${base + peak * amplitude}px` }}/>)}</>;
});

const WaveformCanvas = memo(function WaveformCanvas({ peaks }: { peaks: WaveformBin[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    // Draw in sample-bin coordinates; CSS scales this bitmap with the timeline.
    // This avoids rebuilding a very wide backing canvas during zoom gestures.
    const height = 56;
    const middle = height / 2;
    canvas.width = Math.max(1, peaks.length);
    canvas.height = height;
    context.clearRect(0, 0, canvas.width, height);
    context.fillStyle = '#8dc8b155';
    context.fillRect(0, middle, canvas.width, 1);
    context.fillStyle = '#70b9a8';
    for (let i = 0; i < peaks.length; i += 1) {
      const bin = peaks[i];
      if (!Number.isFinite(bin.min) || !Number.isFinite(bin.max) || bin.min > bin.max) continue;
      const top = middle * (1 - bin.max);
      const bottom = middle * (1 - bin.min);
      context.fillRect(i, top, 1, Math.max(1, bottom - top));
    }
  }, [peaks]);
  return <canvas ref={canvasRef} className="audioWave" aria-label="Audio waveform"/>;
});

function App() {
  const { clips, playhead, playing, device, zoom, selected, set } = useDaw();
  const [mode, setMode] = useState<'Arrange' | 'Draw'>('Arrange');
  const [mobileTab, setMobileTab] = useState<'arrangement' | 'monitor' | 'inspector'>('arrangement');
  const [desktopAsideView, setDesktopAsideView] = useState<'inspector' | 'monitor'>('monitor');
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 1023px)').matches);
  const [viewportWidth, setViewportWidth] = useState(800);
  const [deviceMode, setDeviceMode] = useState<'Grouped' | 'Individual'>('Grouped');
  const [projectName, setProjectName] = useState('Untitled Glyph Project');
  const [audioName, setAudioName] = useState('No audio loaded');
  const [duration, setDuration] = useState(18);
  const [tempo, setTempo] = useState(124);
  const [tempoInput, setTempoInput] = useState('124');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [snap, setSnap] = useState('1/8');
  const [showHelp, setShowHelp] = useState(false);
  const [query, setQuery] = useState('');
  const [masterBrightness, setMasterBrightness] = useState(86);
  const [siteVolume, setSiteVolume] = useState(70);
  const [generationPreset, setGenerationPreset] = useState<'Subtle' | 'Rhythmic' | 'Aggressive'>('Rhythmic');
  const [copied, setCopied] = useState<ExtendedClip[]>([]);
  const [looping, setLooping] = useState(false);
  const [metronome, setMetronome] = useState(false);
  const [loopA, setLoopA] = useState(0);
  const [loopB, setLoopB] = useState(18);
  const loopRangeRef = useRef({ enabled: false, start: 0, end: 18 });
  const [exporting, setExporting] = useState(false);
  const [showExportSettings, setShowExportSettings] = useState(false);
  const [fadeEdges, setFadeEdges] = useState(false);
  const [fadeInSeconds, setFadeInSeconds] = useState(0.5);
  const [fadeOutSeconds, setFadeOutSeconds] = useState(0.75);
  const [message, setMessage] = useState('Saved locally');
  const [muted, setMuted] = useState<number[]>([]);
  const [solo, setSolo] = useState<number[]>([]);
  const [scrollX, setScrollX] = useState(0);
  const [trackHeight, setTrackHeight] = useState(65);
  const [trackScroll, setTrackScroll] = useState(0);
  const [mirrored, setMirrored] = useState(false);
  useEffect(() => setTempoInput(String(tempo)), [tempo]);
  useEffect(() => { if (audioEl.current) audioEl.current.volume = siteVolume / 100; }, [siteVolume, audioUrl]);
  const commitTempoInput = () => {
    const parsed = Number(tempoInput);
    if (!Number.isFinite(parsed) || tempoInput.trim() === '') {
      setTempoInput(String(tempo));
      return;
    }
    if (parsed < 10 || parsed > 300) {
      setTempoInput(String(tempo));
      return;
    }
    setTempo(Math.round(parsed));
  };
  const [author, setAuthor] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; clipId: string } | null>(null);
  const [selectionIds, setSelectionIds] = useState<string[]>([]);
  const selectionIdsRef = useRef<string[]>([]);
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const headersRef = useRef<HTMLDivElement>(null);
  const suppressTimelineClick = useRef(false);
  const touchPoints = useRef(new Map<number, { x: number; y: number }>());
  const touchPan = useRef<{ pointerId: number; x: number; y: number; scrollLeft: number; scrollTop: number; moved: boolean } | null>(null);
  const touchPinch = useRef<{ startDistance: number; startZoom: number; anchorTime: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [restored, setRestored] = useState(false);
  const { peaks, analysis, loading: waveformLoading, error: waveformError } = useAudioPeaks(audioFile);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const update = () => {
      setIsMobile(media.matches);
      if (!media.matches) setMobileTab('arrangement');
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const scroller = laneRef.current;
    if (!scroller) return;
    const updateWidth = () => {
      const width = scroller.clientWidth;
      if (width > 0) setViewportWidth(width);
    };
    updateWidth();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateWidth);
      observer.observe(scroller);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);
  const history = useDaw.temporal.getState();
  const zoneCount = DEVICE_ZONES[device as keyof typeof DEVICE_ZONES] ?? 6;
  const groupedTracks = useMemo(() => {
    const labels = device === 'NP2a' || device === 'NP2aPlus' || device === 'NP3a'
      ? ['Top left', 'Middle right', 'Bottom left']
      : TRACK_LABELS;
    return glyphGroupIds(device).map((id, i) => ({ id, label: labels[id] ?? TRACK_LABELS[id] ?? `Glyph ${id + 1}`, color: COLORS[i % COLORS.length] }));
  }, [device]);
  const tracks = useMemo(() => {
    if (deviceMode === 'Grouped') return groupedTracks;
    return Array.from({ length: zoneCount }, (_, i) => ({ id: i, label: `LED ${String(i + 1).padStart(3, '0')}`, color: COLORS[i % COLORS.length] }));
  }, [deviceMode, groupedTracks, zoneCount]);
  const visibleTracks = tracks.filter(t => t.label.toLowerCase().includes(query.toLowerCase()));
  const visibleTrackIds = visibleTracks.map(t => t.id);
  const clipsByTrack = useMemo(() => {
    const grouped = new Map<number, Clip[]>();
    for (const clip of clips) {
      if (muted.includes(clip.track) || (solo.length && !solo.includes(clip.track))) continue;
      const laneClips = grouped.get(clip.track);
      if (laneClips) laneClips.push(clip); else grouped.set(clip.track, [clip]);
    }
    return grouped;
  }, [clips, muted, solo]);
  const trackStart = Math.max(0, Math.floor(Math.max(0, trackScroll - 84) / trackHeight) - 4);
  const trackEnd = Math.min(visibleTracks.length, trackStart + Math.ceil((laneRef.current?.clientHeight ?? 520) / trackHeight) + 8);
  const renderedTracks = visibleTracks.slice(trackStart, trackEnd);
  const mobileArrangementVisible = !isMobile || mobileTab === 'arrangement';
  useEffect(() => { setTrackScroll(0); if (laneRef.current) laneRef.current.scrollTop = 0; }, [deviceMode, query, zoneCount]);
  const pxPerSecond = 44 * zoom;
  loopRangeRef.current = { enabled: looping, start: loopA, end: loopB };
  const projectWidth = Math.max(viewportWidth, duration * pxPerSecond);
  function fitTimeline() {
    set(s => ({ zoom: Math.max(.05, Math.min(MAX_TIMELINE_ZOOM, viewportWidth / Math.max(1, duration * 44))) }));
    laneRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
  }

  useEffect(() => {
    const normalized: ExtendedClip[] = [];
    let changed = false;
    for (const clip of [...clips].sort((a, b) => a.track - b.track || a.start - b.start)) {
      const start = nearestFreeStart(normalized, clip.track, clip.start, clip.duration);
      normalized.push(start === clip.start ? clip : { ...clip, start });
      if (start !== clip.start) changed = true;
    }
    if (changed) {
      const temporal = useDaw.temporal.getState();
      temporal.pause();
      set(() => ({ clips: normalized }));
      temporal.clear();
      temporal.resume();
    }
  }, [clips, set]);
  function beginTimelinePan(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 1 || (e.target as HTMLElement).closest('button, input, select')) return;
    e.preventDefault();
    const scroller = e.currentTarget;
    const startX = e.clientX;
    const startScroll = scroller.scrollLeft;
    let moved = false;
    const move = (event: PointerEvent) => {
      const delta = event.clientX - startX;
      if (!moved && Math.abs(delta) < 4) return;
      moved = true;
      suppressTimelineClick.current = true;
      setIsPanning(true);
      event.preventDefault();
      scroller.scrollLeft = startScroll - delta;
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      setIsPanning(false);
      if (moved) requestAnimationFrame(() => { suppressTimelineClick.current = false; });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }
  function beginTouchTimelineGesture(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'touch') return;
    const target = e.target as HTMLElement;
    if (target.closest('.clip, input, select, .loopRegion, .playhead, button:not(.audioEmpty)')) return;
    const scroller = e.currentTarget;
    touchPoints.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchPoints.current.size === 1) {
      touchPan.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, scrollLeft: scroller.scrollLeft, scrollTop: scroller.scrollTop, moved: false };
      return;
    }
    if (touchPoints.current.size >= 2) {
      const [a, b] = [...touchPoints.current.values()];
      const midpointX = (a.x + b.x) / 2;
      const rect = scroller.getBoundingClientRect();
      touchPinch.current = {
        startDistance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        startZoom: zoom,
        anchorTime: Math.max(0, (midpointX - rect.left + scroller.scrollLeft) / pxPerSecond),
      };
      touchPan.current = null;
      scroller.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  }
  function moveTouchTimelineGesture(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'touch' || !touchPoints.current.has(e.pointerId)) return;
    const scroller = e.currentTarget;
    touchPoints.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchPinch.current && touchPoints.current.size >= 2) {
      const [a, b] = [...touchPoints.current.values()];
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const nextZoom = Math.max(.05, Math.min(MAX_TIMELINE_ZOOM, touchPinch.current.startZoom * distance / touchPinch.current.startDistance));
      const rect = scroller.getBoundingClientRect();
      const midpointX = (a.x + b.x) / 2;
      const midpointInView = midpointX - rect.left;
      const targetScrollLeft = Math.max(0, touchPinch.current.anchorTime * 44 * nextZoom - midpointInView);
      set(s => s.zoom === nextZoom ? {} : { zoom: nextZoom });
      requestAnimationFrame(() => { scroller.scrollLeft = targetScrollLeft; });
      suppressTimelineClick.current = true;
      setIsPanning(true);
      e.preventDefault();
      return;
    }
    const pan = touchPan.current;
    if (!pan || pan.pointerId !== e.pointerId) return;
    const dx = e.clientX - pan.x;
    const dy = e.clientY - pan.y;
    if (!pan.moved && Math.hypot(dx, dy) < 4) return;
    pan.moved = true;
    scroller.scrollLeft = Math.max(0, pan.scrollLeft - dx);
    scroller.scrollTop = Math.max(0, pan.scrollTop - dy);
    suppressTimelineClick.current = true;
    setIsPanning(true);
    e.preventDefault();
  }
  function finishTouchTimelineGesture(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'touch' || !touchPoints.current.has(e.pointerId)) return;
    touchPoints.current.delete(e.pointerId);
    const scroller = e.currentTarget;
    if (touchPoints.current.size >= 2) {
      const [remaining] = [...touchPoints.current.entries()];
      touchPinch.current = null;
      touchPan.current = { pointerId: remaining[0], x: remaining[1].x, y: remaining[1].y, scrollLeft: scroller.scrollLeft, scrollTop: scroller.scrollTop, moved: true };
    } else if (touchPoints.current.size === 1) {
      const [remaining] = [...touchPoints.current.entries()];
      touchPinch.current = null;
      touchPan.current = { pointerId: remaining[0], x: remaining[1].x, y: remaining[1].y, scrollLeft: scroller.scrollLeft, scrollTop: scroller.scrollTop, moved: true };
    } else {
      touchPinch.current = null;
      touchPan.current = null;
      setIsPanning(false);
      if (suppressTimelineClick.current) requestAnimationFrame(() => { suppressTimelineClick.current = false; });
    }
  }
  function beginRubberBand(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || e.pointerType === 'touch' || !(e.target as HTMLElement).closest('.lane')) return;
    const scroller = e.currentTarget;
    const timeline = scroller.querySelector<HTMLElement>('.timeline');
    if (!timeline) return;
    const rect = timeline.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;
    const additiveSelection = e.shiftKey || e.ctrlKey || e.metaKey;
    let moved = false;
    const move = (event: PointerEvent) => {
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (!moved && Math.hypot(x - startX, y - startY) < 4) return;
      moved = true;
      suppressTimelineClick.current = true;
      event.preventDefault();
      setMarquee({ x: Math.min(startX, x), y: Math.min(startY, y), width: Math.abs(x - startX), height: Math.abs(y - startY) });
    };
    const currentPointer = { x: e.clientX, y: e.clientY };
    const trackPointer = (event: PointerEvent) => { currentPointer.x = event.clientX; currentPointer.y = event.clientY; };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointermove', trackPointer);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (moved) {
        const lastX = currentPointer.x - rect.left;
        const lastY = currentPointer.y - rect.top;
        const left = Math.min(startX, lastX), right = Math.max(startX, lastX);
        const top = Math.min(startY, lastY), bottom = Math.max(startY, lastY);
        const ids = clips.filter(clip => {
          const trackIndex = visibleTracks.findIndex(track => track.id === clip.track);
          if (trackIndex < 0 || muted.includes(clip.track) || (solo.length && !solo.includes(clip.track))) return false;
          const clipLeft = clip.start * pxPerSecond;
          const clipRight = clipLeft + clip.duration * pxPerSecond;
          const clipTop = 84 + trackIndex * trackHeight + 9;
          const clipBottom = clipTop + 45;
          return clipRight >= left && clipLeft <= right && clipBottom >= top && clipTop <= bottom;
        }).map(clip => clip.id);
        const nextIds = additiveSelection ? [...new Set([...selectionIdsRef.current, ...ids])] : ids;
        selectionIdsRef.current = nextIds; setSelectionIds(nextIds);
        set(s => ({ selected: nextIds[nextIds.length - 1] ?? null }));
        requestAnimationFrame(() => { suppressTimelineClick.current = false; });
      }
      setMarquee(null);
    };
    window.addEventListener('pointermove', trackPointer);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  }
  function beginPlayheadDrag(e: React.PointerEvent<HTMLSpanElement>) {
    e.stopPropagation(); e.preventDefault();
    const update = (clientX: number) => {
      const lane = laneRef.current; if (!lane) return;
      const rect = lane.getBoundingClientRect();
      setPlayhead((clientX - rect.left + lane.scrollLeft) / pxPerSecond);
    };
    update(e.clientX);
    const move = (event: PointerEvent) => update(event.clientX);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true });
  }

  useEffect(() => {
    const audio = audioEl.current;
    if (!audio) return;
    if (playing) void audio.play().catch(() => { set(s => ({ playing: false })); setMessage('Audio playback was blocked. Click play again.'); });
    else audio.pause();
  }, [playing]);

  useEffect(() => {
    const scroller = laneRef.current;
    if (!scroller) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const currentZoom = useDaw.getState().zoom;
      const delta = event.deltaY || event.deltaX;
      const nextZoom = Math.max(.05, Math.min(MAX_TIMELINE_ZOOM, currentZoom * Math.exp(-delta * .002)));
      if (nextZoom === currentZoom) return;
      const bounds = scroller.getBoundingClientRect();
      const pointerX = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
      const anchoredTime = (scroller.scrollLeft + pointerX) / (44 * currentZoom);
      set(s => ({ zoom: nextZoom }));
      requestAnimationFrame(() => {
        if (laneRef.current) laneRef.current.scrollLeft = Math.max(0, anchoredTime * 44 * nextZoom - pointerX);
      });
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  }, [set]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('glyph-daw-autosave');
      if (!raw) { setRestored(true); return; }
      const saved = JSON.parse(raw) as Project;
      if (!Array.isArray(saved.clips)) { setRestored(true); return; }
      const normalized: ExtendedClip[] = [];
      for (const clip of [...saved.clips].sort((a, b) => a.track - b.track || a.start - b.start)) {
        normalized.push({ ...clip, color: normalizeClipColor(clip.color), start: nearestFreeStart(normalized, clip.track, clip.start, clip.duration) });
      }
      set(s => ({ clips: normalized, device: saved.device || s.device, selected: null }));
      setProjectName(saved.title || 'Untitled project');
      setDuration(saved.duration || 18);
      if (saved.brightness !== undefined) setMasterBrightness(saved.brightness);
      if (saved.tempo) setTempo(Math.max(10, Math.min(300, saved.tempo)));
      if (saved.snap) setSnap(saved.snap);
      if (saved.deviceMode) setDeviceMode(saved.deviceMode);
      if (saved.audioName) setAudioName(saved.audioName);
    } catch { /* ignore a corrupt autosave */ }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previousTime = performance.now();
    const tick = (now: number) => {
      const elapsed = Math.max(0, Math.min(.1, (now - previousTime) / 1000));
      previousTime = now;
      const el = audioUrl ? audioEl.current : null;
      if (el) {
        const range = loopRangeRef.current;
        if (range.enabled && el.currentTime >= Math.min(range.end, duration)) el.currentTime = Math.min(range.start, duration);
        set(s => ({ playhead: el.currentTime }));
      } else {
        set(s => {
          const range = loopRangeRef.current;
          const next = range.enabled && s.playhead + elapsed >= range.end ? range.start : s.playhead + elapsed;
          return { playhead: next, playing: next >= duration && !range.enabled ? false : s.playing };
        });
      }
      if (useDaw.getState().playing) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, audioUrl, duration, set]);

  useEffect(() => {
    if (!playing || !metronome) return;
    const context = new AudioContext();
    void context.resume();
    const beat = () => {
      const oscillator = context.createOscillator(); const gain = context.createGain();
      oscillator.frequency.value = 1100; gain.gain.setValueAtTime(.04, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .035);
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .04);
    };
    beat(); const timer = window.setInterval(beat, 60000 / tempo);
    return () => { window.clearInterval(timer); void context.close(); };
  }, [playing, metronome, tempo]);

  useEffect(() => {
    if (!restored) return;
    const timer = window.setTimeout(() => {
      const project: Project = { version: 1, title: projectName, device, duration, clips: clips as ExtendedClip[], audioName: 'No audio loaded', brightness: masterBrightness, tempo, snap, deviceMode, author };
      try { localStorage.setItem('glyph-daw-autosave', JSON.stringify(project)); setMessage('Autosaved'); }
      catch { setMessage('Autosave unavailable'); }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [clips, device, duration, projectName, audioName, masterBrightness, tempo, snap, deviceMode, author, restored]);

  const align = useCallback((time: number) => {
    const subdivisions: Record<string, number> = { '1/32': 8, '1/16': 4, '1/8': 2, '1/4': 1, '1/2': .5 };
    const step = snap.endsWith(' ms') ? Number(snap.slice(0, -3)) / 1000 : subdivisions[snap] ? 60 / tempo / subdivisions[snap] : 0;
    return step ? Math.max(0, Math.round(time / step) * step) : Math.max(0, time);
  }, [snap, tempo]);

  function onAudio(file?: File) {
    if (!file) return;
    audioEl.current?.pause();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    const url = URL.createObjectURL(file);
    const media = new Audio(url);
    media.preload = 'auto';
    media.oncanplay = () => { if (useDaw.getState().playing) void media.play().catch(() => { set(s => ({ playing: false })); setMessage('Audio playback was blocked. Click play again.'); }); };
    media.onloadedmetadata = () => {
      if (Number.isFinite(media.duration) && media.duration > 0) {
        const audioDuration = Math.min(600, media.duration);
        setDuration(audioDuration);
        setLoopA(0);
        setLoopB(audioDuration);
        media.currentTime = Math.min(useDaw.getState().playhead, media.duration);
        if (useDaw.getState().playing) void media.play().catch(() => setMessage('Click play to start audio'));
      }
      else setMessage('Audio duration unavailable');
    };
    media.onerror = () => setMessage(`Could not decode ${file.name}. Try WAV, MP3, or OGG.`);
    media.onended = () => set(s => ({ playing: false }));
    audioEl.current = media;
    setAudioFile(file); setAudioUrl(url); setAudioName(file.name); setPlayhead(0);
  }
  function clearAudio(resetDuration = true) {
    audioEl.current?.pause(); audioEl.current = null;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(''); setAudioFile(null); setAudioName('No audio loaded'); if (resetDuration) { setDuration(18); setLoopA(0); setLoopB(18); } setPlayhead(0);
  }
  function newProject() {
    if ((clips.length || audioFile) && !window.confirm('Start a new project? Your current arrangement and audio will be replaced. Save a copy first if you want to keep them.')) return;
    audioEl.current?.pause();
    set(s => ({ clips: [], device: 'NP2', selected: null, playing: false, playhead: 0, zoom: 1 }));
    useDaw.temporal.getState().clear();
    clearAudio();
    setProjectName('Untitled Glyph Project');
    setMasterBrightness(86);
    setTempo(124); setTempoInput('124'); setSnap('1/8');
    setDeviceMode('Grouped'); setLooping(false);
    setMuted([]); setSolo([]); setCopied([]);
    setSelectionIds([]); selectionIdsRef.current = [];
    setContextMenu(null); setMarquee(null); setShowExportSettings(false);
    setScrollX(0); setTrackScroll(0);
    requestAnimationFrame(() => { laneRef.current?.scrollTo({ left: 0, top: 0 }); });
    setMessage('New project');
  }
  function setPlayhead(time: number) {
    const next = Math.max(0, Math.min(Number.isFinite(time) ? time : 0, duration));
    set(() => ({ playhead: next }));
    if (audioEl.current?.readyState && Number.isFinite(audioEl.current.duration)) audioEl.current.currentTime = Math.min(next, audioEl.current.duration);
  }
  function toggleLoop() {
    const enabled = !looping;
    setLooping(enabled);
    const current = audioEl.current?.currentTime ?? useDaw.getState().playhead;
    if (enabled && playing && current >= loopB) setPlayhead(loopA);
  }
  function moveLoopRange(start: number, end: number) {
    setLoopA(start); setLoopB(end);
    const current = audioEl.current?.currentTime ?? useDaw.getState().playhead;
    if (looping && playing && current >= end) setPlayhead(start);
  }
  function beginLoopResize(e: React.PointerEvent<HTMLSpanElement>, edge: 'start' | 'end') {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const originX = e.clientX, originA = loopA, originB = loopB;
    const move = (event: PointerEvent) => {
      const delta = (event.clientX - originX) / pxPerSecond;
      if (edge === 'start') moveLoopRange(Math.max(0, Math.min(originB - .1, originA + delta)), originB);
      else moveLoopRange(originA, Math.max(originA + .1, Math.min(duration, originB + delta)));
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  }
  function clearSelection() {
    selectionIdsRef.current = [];
    setSelectionIds([]);
    set(s => ({ selected: null }));
  }
  function togglePlayback() {
    const next = !useDaw.getState().playing;
    if (next && audioEl.current) {
      audioEl.current.currentTime = useDaw.getState().playhead;
      void audioEl.current.play().catch(() => { set(s => ({ playing: false })); setMessage('Audio playback was blocked. Click play again.'); });
    } else audioEl.current?.pause();
    set(() => ({ playing: next }));
  }
  function beginLaneLongPressCreate(e: React.PointerEvent<HTMLDivElement>, track: number) {
    if (e.pointerType !== 'touch') return;
    const lane = e.currentTarget;
    const x = e.clientX;
    const y = e.clientY;
    let timer = window.setTimeout(() => {
      cleanup();
      const rect = lane.getBoundingClientRect();
      createClip(track, (x - rect.left) / pxPerSecond);
    }, 520);
    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
    };
    const move = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - x, event.clientY - y) > 12) cleanup();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', cleanup, { once: true });
    window.addEventListener('pointercancel', cleanup, { once: true });
  }
  function createClip(track: number, time: number) {
    const start = nearestFreeStart(clips, track, align(time), 1);
    const clip: ExtendedClip = { id: crypto.randomUUID(), track, start, duration: 1, name: 'Glyph clip', color: COLORS[track % COLORS.length], brightness: 84, effect: 'Steady' };
    set(s => ({ clips: [...s.clips, clip] }));
    set(s => ({ selected: clip.id }));
    selectionIdsRef.current = [clip.id];
    setSelectionIds([clip.id]);
  }
  function handleLaneClick(e: React.MouseEvent<HTMLDivElement>, track: number) {
    if ((e.target as HTMLElement).closest('.clip')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const time = (e.clientX - rect.left + e.currentTarget.scrollLeft) / pxPerSecond;
    if (mode === 'Draw') createClip(track, time);
    else { clearSelection(); setPlayhead(time); }
  }
  function duplicateSelected() {
    const ids = selectionIds.length ? selectionIds : selected ? [selected] : [];
    const selectedClips = clips.filter(c => ids.includes(c.id)) as ExtendedClip[];
    if (!selectedClips.length) return;
    const occupied = [...clips] as ExtendedClip[];
    const clones = selectedClips.map(c => {
      const clone = { ...c, id: crypto.randomUUID(), start: nearestFreeStart(occupied, c.track, align(c.start + c.duration + .1), c.duration), name: `${c.name} copy` };
      occupied.push(clone); return clone;
    });
    set(s => ({ clips: occupied, selected: clones[0].id }));
    selectionIdsRef.current = clones.map(c => c.id);
    setSelectionIds(clones.map(c => c.id));
  }
  function duplicateClipById(id: string) {
    const source = clips.find(c => c.id === id) as ExtendedClip | undefined;
    if (!source) return;
    const clone = { ...source, id: crypto.randomUUID(), start: nearestFreeStart(clips, source.track, align(source.start + source.duration + .1), source.duration), name: `${source.name} copy` };
    set(s => ({ clips: [...s.clips, clone], selected: clone.id }));
    selectionIdsRef.current = [clone.id]; setSelectionIds([clone.id]);
  }
  function splitSelected() {
    const c = clips.find(x => x.id === selected) as ExtendedClip | undefined;
    if (!c || playhead <= c.start || playhead >= c.start + c.duration || c.locked) return;
    const first = { ...c, duration: playhead - c.start };
    const second = { ...c, id: crypto.randomUUID(), start: playhead, duration: c.start + c.duration - playhead, name: `${c.name} B` };
    set(s => ({ clips: s.clips.flatMap(x => x.id === c.id ? [first, second] : [x]), selected: second.id }));
    selectionIdsRef.current = [second.id]; setSelectionIds([second.id]);
  }
  function deleteSelected() { const ids = selectionIdsRef.current.length ? selectionIdsRef.current : selected ? [selected] : []; if (ids.length) { set(s => ({ clips: s.clips.filter(c => !ids.includes(c.id)), selected: null })); selectionIdsRef.current = []; setSelectionIds([]); } }
  function copySelection() { const ids = selectionIds.length ? selectionIds : selected ? [selected] : []; setCopied(clips.filter(c => ids.includes(c.id)) as ExtendedClip[]); }
  function pasteSelection() {
    if (!copied.length) return;
    const origin = copied[0].start;
    const occupied = [...clips] as ExtendedClip[];
    const pasted = copied.map(c => {
      const clip = { ...c, id: crypto.randomUUID(), start: nearestFreeStart(occupied, c.track, align(playhead + c.start - origin), c.duration), name: `${c.name} copy` };
      occupied.push(clip); return clip;
    });
    set(s => ({ clips: occupied, selected: pasted[0].id }));
    selectionIdsRef.current = pasted.map(c => c.id);
    setSelectionIds(pasted.map(c => c.id));
  }
  function quantize() { const clip = clips.find(c => c.id === selected); if (clip) setClip({ start: nearestFreeStart(clips, clip.track, align(clip.start), clip.duration, clip.id) }); }
  function fillSelected() {
    const clip = clips.find(c => c.id === selected) as ExtendedClip | undefined;
    if (!clip) return;
    const start = clip.start + clip.duration;
    const nextStart = clips.filter(c => c.track === clip.track && c.start >= start).reduce((min, c) => Math.min(min, c.start), duration);
    const end = Math.min(duration, nextStart);
    if (end - start < .05) { setMessage('No gap after this clip to fill'); return; }
    const additions: ExtendedClip[] = [];
    for (let at = start; at + .049 < end; at += clip.duration) {
      const length = Math.min(clip.duration, end - at);
      additions.push({ ...clip, id: crypto.randomUUID(), start: at, duration: length, name: 'Fill' });
    }
    if (!additions.length) { setMessage('The gap is too short for a clip'); return; }
    set(s => ({ clips: [...s.clips, ...additions], selected: additions[0].id }));
    setMessage(`Filled ${additions.length} gap(s)`);
  }
  function generateFromAudio() {
    if (!audioFile) { setMessage('Import audio before generating a pattern'); fileInput.current?.click(); return; }
    if (waveformLoading) { setMessage('Analyzing waveform...'); return; }
    if (waveformError || !analysis.length) { setMessage('Audio analysis failed'); return; }
    const maxLevel = Math.max(...analysis);
    if (!maxLevel) { setMessage('No audio energy detected'); return; }
    const normalized = analysis.map(v => v / maxLevel);
    const threshold = generationPreset === 'Subtle' ? .38 : generationPreset === 'Aggressive' ? .18 : .27;
    const gap = generationPreset === 'Subtle' ? 45 : generationPreset === 'Aggressive' ? 12 : 25;
    const generated: ExtendedClip[] = []; const occupied = [...clips] as ExtendedClip[]; let last = -gap;
    for (let i = 2; i < normalized.length - 2; i += 1) {
      const rise = normalized[i] - normalized[i - 2];
      if (normalized[i] < threshold || rise < .08 || normalized[i] < normalized[i - 1] || normalized[i] < normalized[i + 1] || i - last < gap) continue;
      const time = i / 100;
      const lane = Math.min(tracks.length - 1, Math.floor((1 - normalized[i]) * tracks.length));
      const track = tracks[lane]?.id ?? 0;
      const clipDuration = generationPreset === 'Aggressive' ? .18 : .3;
      const start = nearestFreeStart(occupied, track, align(time), clipDuration);
      if (start > duration) continue;
      const clip: ExtendedClip = { id: crypto.randomUUID(), track, start, duration: clipDuration, name: 'Audio accent', color: COLORS[lane % COLORS.length], brightness: Math.round(42 + normalized[i] * 58), effect: generationPreset === 'Subtle' ? 'Fade in' : 'Pulse' };
      generated.push(clip); occupied.push(clip);
      last = i;
    }
    if (!generated.length) { setMessage('No strong accents found. Try Aggressive or another section.'); return; }
    set(s => ({ clips: [...s.clips, ...generated], selected: generated[0].id }));
    setMessage(`Generated ${generated.length} clips from audio`);
  }
  function detectTempo() {
    if (!audioFile) { fileInput.current?.click(); return; }
    if (waveformLoading) { setMessage('Analyzing waveform...'); return; }
    if (waveformError || analysis.length < 200) { setMessage('Could not analyze this audio'); return; }
    const flux = analysis.map((v, i) => Math.max(0, v - (analysis[i - 1] ?? 0)));
    const mean = flux.reduce((a, b) => a + b, 0) / flux.length;
    const centered = flux.map(v => Math.max(0, v - mean));
    const secondsPerBin = 0.01;
    let bestLag = 0, bestScore = -1;
    for (let bpm = 60; bpm <= 180; bpm += 1) {
      const lag = Math.max(1, Math.round(60 / bpm / secondsPerBin)); let score = 0;
      for (let i = lag; i < centered.length; i += 1) score += centered[i] * centered[i - lag];
      // Prefer a fundamental over a high-scoring double/half-time harmonic.
      score /= Math.sqrt(Math.max(1, centered.length - lag));
      if (score > bestScore) { bestScore = score; bestLag = lag; }
    }
    let detected = Math.round(60 / (bestLag * secondsPerBin));
    if (detected > 120) detected = Math.round(detected / 2);
    setTempo(Math.max(10, Math.min(300, detected)));
    setMessage(`Estimated ${detected} BPM - verify by ear`);
  }
  async function saveProject() {
    setMessage('Saving project...');
    try {
    const audioData = audioFile ? await audioFile.arrayBuffer().then(buffer => {
      const bytes = new Uint8Array(buffer); let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    }) : undefined;
    const project: Project = { version: 1, title: projectName, device, duration, clips: clips as ExtendedClip[], audioName, audioData, audioType: audioFile?.type, brightness: masterBrightness, tempo, snap, deviceMode, author };
    download(JSON.stringify(project, null, 2), `${projectName.replace(/[^a-z0-9_-]/gi, '_')}.glyphdaw`, 'application/json');
    setMessage('Project saved');
    } catch (err) { setMessage('Save failed'); alert(err instanceof Error ? err.message : 'Could not save project'); }
  }
  async function openProject(file?: File) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as Project;
      if (!Array.isArray(data.clips) || data.clips.length > 10000) throw new Error('Project file has an invalid clip list.');
      const validClips = data.clips.every(c => c && typeof c.id === 'string' && typeof c.name === 'string' && typeof c.color === 'string' && Number.isInteger(c.track) && c.track >= 0 && c.track < 625 && Number.isFinite(c.start) && c.start >= 0 && Number.isFinite(c.duration) && c.duration > 0 && Number.isFinite(c.brightness) && c.brightness >= 0 && c.brightness <= 100);
      if (!validClips) throw new Error('Project contains an invalid Glyph clip.');
      if (!Number.isFinite(data.duration) || data.duration <= 0 || data.duration > 600) throw new Error('Project duration must be between 0 and 600 seconds.');
      if (data.brightness !== undefined && (!Number.isFinite(data.brightness) || data.brightness < 0 || data.brightness > 100)) throw new Error('Project brightness is outside the supported range.');
      if (data.audioData !== undefined && typeof data.audioData !== 'string') throw new Error('Project audio data is invalid.');
      const loadedAudio = data.audioData ? (() => {
        const binary = atob(data.audioData!); const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
        return new File([bytes], data.audioName || 'project-audio.oga', { type: data.audioType || 'audio/ogg' });
      })() : null;
      const normalized: ExtendedClip[] = [];
      for (const clip of [...data.clips].sort((a, b) => a.track - b.track || a.start - b.start)) {
        normalized.push({ ...clip, color: normalizeClipColor(clip.color), start: nearestFreeStart(normalized, clip.track, clip.start, clip.duration) });
      }
      set(s => ({ clips: normalized, selected: null, device: data.device && data.device in DEVICE_ZONES ? data.device : s.device, playhead: 0, playing: false }));
      selectionIdsRef.current = []; setSelectionIds([]);
      setProjectName(data.title || 'Untitled project'); setDuration(data.duration); setLoopA(0); setLoopB(data.duration); setAudioName(data.audioName || 'No audio loaded');
      setAuthor(data.author || '');
      if (data.brightness !== undefined) setMasterBrightness(data.brightness);
      if (data.tempo && Number.isFinite(data.tempo)) setTempo(Math.max(10, Math.min(300, data.tempo)));
      if (data.snap && SNAP_OPTIONS.includes(data.snap)) setSnap(data.snap);
      if (data.deviceMode === 'Grouped' || data.deviceMode === 'Individual') setDeviceMode(data.deviceMode);
      if (loadedAudio) onAudio(loadedAudio); else clearAudio(false);
      setMessage('Project opened');
    } catch (err) { alert(err instanceof Error ? err.message : 'Could not open project'); }
  }
  function exportJson() {
    const effectIds: Record<string, number> = { Steady: 0, 'Fade in': 2, 'Fade out': 3, Pulse: 7, Strobe: 5 };
    const payload = { version: 1, device, tempo, duration, clips: clips.map(c => ({ ...c, startTimeMilis: Math.round(c.start * 1000), durationMilis: Math.round(c.duration * 1000), glyphId: c.track + 1, startingBrightness: Math.round(c.brightness * 40.95), effectId: effectIds[(c as ExtendedClip).effect || 'Steady'] ?? 0, effectData: [] })) };
    download(JSON.stringify(payload, null, 2), `${projectName}.nglyph.json`, 'application/json');
  }
  function download(data: string, name: string, type: string) {
    const href = URL.createObjectURL(new Blob([data], { type })); const a = document.createElement('a'); a.href = href; a.download = name; a.click(); window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  async function exportOga() {
    if (!audioFile) { setMessage('Load an audio file first using the audio lane, then download your OGG.'); return; }
    const allowedGroupedTracks = new Set(glyphGroupIds(device));
    const isValidTrack = (track: number) => deviceMode === 'Grouped' ? allowedGroupedTracks.has(track) : track >= 0 && track < zoneCount;
    const exportClips = clips.filter(c => isValidTrack(c.track) && !muted.includes(c.track) && (!solo.length || solo.includes(c.track))) as ExtendedClip[];
    const omitted = clips.filter(c => !isValidTrack(c.track)).length;
    if (omitted) setMessage(`${omitted} clip(s) outside this device's zones will be skipped`);
    try {
      setExporting(true);
      const cropStart = Math.max(0, Math.min(duration, loopA));
      const cropEnd = Math.max(cropStart, Math.min(duration, loopB));
      const isCropped = cropStart > 0 || cropEnd < duration;
      setMessage(isCropped ? `Cropping ${cropStart.toFixed(2)}–${cropEnd.toFixed(2)}s range and encoding Glyph data...` : fadeEdges ? 'Applying audio fades and encoding Glyph data...' : 'Preparing Glyph metadata and audio...');
      await exportGlyphOga(audioFile, exportClips, device, duration, projectName, masterBrightness, author, deviceMode,
        progress => setMessage(`Encoding audio ${Math.round(progress * 100)}%`), cropStart, cropEnd,
        fadeEdges ? fadeInSeconds : 0, fadeEdges ? fadeOutSeconds : 0);
      const rangeNote = isCropped ? ` Cropped ${cropStart.toFixed(2)}–${cropEnd.toFixed(2)}s.` : '';
      const fadeNote = fadeEdges ? ` Audio fades ${fadeInSeconds.toFixed(1)}s in / ${fadeOutSeconds.toFixed(1)}s out.` : '';
      setMessage(`${omitted ? `Skipped ${omitted} out-of-range clip(s). ` : ''}OGG downloaded.${rangeNote}${fadeNote} Import in Glyph Composer Library → ⋮ → Import`);
    }
    catch (err) { alert(`OGG export failed: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setExporting(false); }
  }
  function setClip(patch: Partial<ExtendedClip>) {
    if (!selected) return;
    set(s => ({ clips: s.clips.map(c => {
      if (c.id !== selected) return c;
      const next = { ...c, ...patch };
      if (patch.start !== undefined || patch.duration !== undefined) next.start = nearestFreeStart(s.clips, next.track, next.start, next.duration, c.id);
      return next;
    }) }));
  }
  function setClipLightMode(clipId: string, mode: GlyphLightMode) {
    set(s => ({ clips: s.clips.map(raw => {
      if (raw.id !== clipId) return raw;
      const c = raw as ExtendedClip;
      const stripLength = glyphStripForTrack(device, c.track, deviceMode === 'Grouped').length;
      const trackZones = glyphZonesForTrack(device, c.track, deviceMode === 'Grouped');
      return { ...c, lightMode: mode, direction: c.direction ?? 'forward', tailLength: c.tailLength ?? 3, fillAmount: c.fillAmount ?? stripLength, selectedZones: c.selectedZones ?? trackZones };
    }) }));
  }
  function changeTrackFlag(kind: 'mute' | 'solo', track: number) {
    const state = kind === 'mute' ? muted : solo; const setter = kind === 'mute' ? setMuted : setSolo;
    setter(state.includes(track) ? state.filter(x => x !== track) : [...state, track]);
  }
  function nudgeSelectionTrack(direction: -1 | 1) {
    const ids = selectionIdsRef.current.length ? selectionIdsRef.current : selected ? [selected] : [];
    const primaryId = selected && ids.includes(selected) ? selected : ids[ids.length - 1];
    const primary = clips.find(clip => clip.id === primaryId && !(clip as ExtendedClip).locked);
    const trackOrder = tracks.map(track => track.id);
    if (!primary || !trackOrder.length) return;
    const currentIndex = trackOrder.indexOf(primary.track);
    if (currentIndex < 0) return;
    const targetIndex = Math.max(0, Math.min(trackOrder.length - 1, currentIndex + direction));
    if (targetIndex === currentIndex) return;
    const targetTrack = trackOrder[targetIndex];
    set(state => ({ clips: moveClipGroup(state.clips, ids, primaryId, primary.start, targetTrack, trackOrder) }));
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && contextMenu) { setContextMenu(null); return; }
    if (e.key === 'Escape' && showHelp) { setShowHelp(false); return; }
    const target = e.target as HTMLElement;
    if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      const ids = clips.map(clip => clip.id);
      selectionIdsRef.current = ids;
      setSelectionIds(ids);
      set(s => ({ selected: ids[ids.length - 1] ?? null }));
      return;
    }
    if (e.shiftKey && e.key === 'ArrowUp') { e.preventDefault(); nudgeSelectionTrack(-1); return; }
    if (e.shiftKey && e.key === 'ArrowDown') { e.preventDefault(); nudgeSelectionTrack(1); return; }
    if (e.code === 'Space') { e.preventDefault(); togglePlayback(); }
    if (e.shiftKey && e.key === '?') setShowHelp(x => !x);
    if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) splitSelected();
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); deleteSelected(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteSelection(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? history.redo : history.undo)(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void saveProject(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); projectInput.current?.click(); }
  }
  useEffect(() => { window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); });

  const activeClip = clips.find(c => c.id === selected) as ExtendedClip | undefined;
  const activeClipStrip = activeClip ? glyphStripForTrack(device, activeClip.track, deviceMode === 'Grouped') : [];
  const activeClipZones = activeClip ? glyphZonesForTrack(device, activeClip.track, deviceMode === 'Grouped') : [];
  const contextClip = contextMenu ? clips.find(c => c.id === contextMenu.clipId) as ExtendedClip | undefined : undefined;
  const contextClipStrip = contextClip ? glyphStripForTrack(device, contextClip.track, deviceMode === 'Grouped') : [];
  const activeLevels = useMemo(() => {
    const levels = new Float32Array(zoneCount);
    const grouped = deviceMode === 'Grouped';
    const validTracks = grouped ? new Set(groupedTracks.map(track => track.id)) : null;
    for (const raw of clips) {
      const clip = raw as ExtendedClip;
      if (clip.track < 0 || (grouped ? !validTracks?.has(clip.track) : clip.track >= zoneCount) || muted.includes(clip.track) || (solo.length && !solo.includes(clip.track)) || playhead < clip.start || playhead >= clip.start + clip.duration) continue;
      const progress = (playhead - clip.start) / clip.duration;
      const pulse = clip.effect === 'Pulse' ? .35 + .65 * (.5 + .5 * Math.sin(progress * Math.PI * 4)) : 1;
      const fade = clip.effect === 'Fade in' ? progress : clip.effect === 'Fade out' ? 1 - progress : 1;
      const strobe = clip.effect === 'Strobe' && Math.floor((playhead - clip.start) * 60 / 12) % 2 ? 0 : 1;
      const intensity = clip.brightness * pulse * fade * strobe;
      for (const [zone, weight] of glyphClipZoneWeights(device, clip.track, grouped, clip.lightMode, clip.direction, progress, clip.tailLength, clip.fillAmount, clip.selectedZones)) {
        if (zone < levels.length) levels[zone] = Math.max(levels[zone], intensity * weight);
      }
    }
    return levels;
  }, [clips, device, deviceMode, groupedTracks, muted, playhead, solo, zoneCount]);
  const zoneLevel = (track: number) => {
    const level = deviceMode === 'Grouped'
      ? (device === 'NP2' && track === 6 ? activeLevels[21] ?? 0 : activeLevels.reduce((max, value, zone) => glyphGroupForZone(device, zone) === track ? Math.max(max, value) : max, 0))
      : activeLevels[track] ?? 0;
    return level * masterBrightness / 100;
  };
  const actualWaveform = audioFile && peaks.length ? peaks : [];
  const timeAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect(); return Math.max(0, (e.clientX - rect.left + e.currentTarget.scrollLeft) / pxPerSecond);
  };

  return <div className="app">
    <input ref={fileInput} type="file" accept="audio/*" hidden onChange={e => { onAudio(e.target.files?.[0]); e.currentTarget.value = ''; }} />
    <input ref={projectInput} type="file" accept=".glyphdaw,.json,application/json" hidden onChange={e => { void openProject(e.target.files?.[0]); e.currentTarget.value = ''; }} />
    <header className="top">
      <div className="brand"><span className="brandmark">{'\u2733'}</span><b>GLYPH</b><i>DAW</i><span className="vline"/><input className="projectName" value={projectName} onChange={e => setProjectName(e.target.value)} aria-label="Project name"/><span className="saved"><span/>{message}</span></div>
      <div className="transport"><button className="icon" title="Jump to start" onClick={() => setPlayhead(0)}><SkipBack/></button><button className="stop" title="Stop and return to loop start" onClick={() => { set(s => ({ playing: false })); audioEl.current?.pause(); setPlayhead(loopA); }}><Square size={14} fill="currentColor"/></button><button className="play" onClick={togglePlayback}>{playing ? <Pause fill="currentColor"/> : <Play fill="currentColor"/>}</button><button className="icon" title="Restart" onClick={() => setPlayhead(0)}><RotateCcw/></button><div className="siteVolume" title="Playback volume"><Volume2 size={14}/><input aria-label="Site playback volume" type="range" min="0" max="100" value={siteVolume} onChange={e => setSiteVolume(Number(e.target.value))}/><span>{siteVolume}%</span></div><span className="vline"/><div className="tempo"><small>BPM</small><input aria-label="Tempo" type="text" inputMode="numeric" value={tempoInput} onFocus={e => e.currentTarget.select()} onChange={e => setTempoInput(e.target.value.replace(/\D/g, ''))} onBlur={commitTempoInput} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/></div><button className={metronome ? 'metronome active' : 'metronome'} title="Metronome" onClick={() => setMetronome(v => !v)}><Activity size={15}/></button><button className={looping ? 'loop active' : 'loop'} title="Loop" onClick={toggleLoop}><Repeat2 size={15}/></button></div>
      <div className="tools"><button className="icon" disabled={!history.pastStates.length} onClick={() => history.undo()} title="Undo"><Undo2/></button><button className="icon" disabled={!history.futureStates.length} onClick={() => history.redo()} title="Redo"><Redo2/></button><span className="vline"/><select className="snap" value={snap} onChange={e => setSnap(e.target.value)}>{SNAP_OPTIONS.map(x => <option key={x}>{x}</option>)}</select><span className="vline"/><select value={device} onChange={e => { const next = e.target.value; set(s => ({ device: next })); setMessage(clips.some(c => c.track >= (DEVICE_ZONES[next as keyof typeof DEVICE_ZONES] ?? 0)) ? 'Device changed; out-of-range clips are preserved but hidden' : `Device set to ${DEVICE_NAMES[next as keyof typeof DEVICE_NAMES]}`); }}>{Object.entries(DEVICE_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><button className="icon" title="New project" aria-label="New project" onClick={newProject}><Plus size={15}/></button><button className="icon" title="Save project" onClick={() => void saveProject()}><Save size={15}/></button><button className="icon" title="Open project" onClick={() => projectInput.current?.click()}><FolderOpen size={15}/></button><div className="exportOptionsWrap"><button className={fadeEdges ? 'icon active' : 'icon'} title="Audio fade settings" aria-expanded={showExportSettings} onClick={() => setShowExportSettings(open => !open)}><SlidersHorizontal size={15}/></button>{showExportSettings && <div className="exportOptions"><b>Audio fades</b><small>Fade the ringtone audio edges. Glyph lights stay unchanged.</small><label><input type="checkbox" checked={fadeEdges} onChange={e => setFadeEdges(e.target.checked)}/> Enable fade in / fade out</label><label>Fade in <span><input type="number" min="0" max="10" step="0.1" value={fadeInSeconds} disabled={!fadeEdges} onChange={e => setFadeInSeconds(Math.max(0, Math.min(10, Number(e.target.value) || 0)))}/> s</span></label><label>Fade out <span><input type="number" min="0" max="10" step="0.1" value={fadeOutSeconds} disabled={!fadeEdges} onChange={e => setFadeOutSeconds(Math.max(0, Math.min(10, Number(e.target.value) || 0)))}/> s</span></label></div>}</div><button className="export" disabled={exporting} onClick={() => void exportOga()}><ArrowDownToLine size={14}/>{exporting ? 'Encoding...' : 'Download OGG'}</button></div>
    </header>
      <main className={`main mobile-${mobileTab}`}>
      <aside className="rail"><div className="railLogo">G.</div><button className="railBtn active"><Workflow/></button><div className="railBottom"><button className="railBtn" onClick={() => setShowHelp(true)}><CircleHelp/></button></div></aside>
      <section className="workspace">
        <div className="toolbar"><div className="tabs"><button className={mode === 'Arrange' ? 'tab active' : 'tab'} onClick={() => setMode('Arrange')}>Arrangement</button><button className={mode === 'Draw' ? 'tab active' : 'tab'} onClick={() => setMode('Draw')}>Draw</button><button className="tab" onClick={() => setDeviceMode(v => v === 'Grouped' ? 'Individual' : 'Grouped')}>{deviceMode} zones</button></div><div className="toolbuttons"><select className="preset" value={generationPreset} onChange={e => setGenerationPreset(e.target.value as typeof generationPreset)}><option>Subtle</option><option>Rhythmic</option><option>Aggressive</option></select><button className="tool" onClick={generateFromAudio}><WandSparkles size={14}/> Generate</button><button className="tool" onClick={detectTempo}>Detect BPM</button><button className="tool" onClick={duplicateSelected}><Copy size={14}/> Duplicate</button><button className="tool" onClick={splitSelected}><Scissors size={14}/> Split</button><button className="tool" onClick={quantize}><Grid2X2 size={14}/> Quantize</button><button className="tool" onClick={fillSelected}><WandSparkles size={14}/> Fill</button><span className="vline"/><button className="icon small" title="Zoom out" onClick={() => set(s => ({ zoom: Math.max(.05, s.zoom / 1.25) }))}><ZoomOut/></button><span className="zoomnum">{Math.round(zoom * 100)}%</span><button className="icon small" title="Zoom in" disabled={zoom >= MAX_TIMELINE_ZOOM} onClick={() => set(s => ({ zoom: Math.min(MAX_TIMELINE_ZOOM, s.zoom * 1.25) }))}><ZoomIn/></button><button className="icon small" title="Fit timeline" onClick={fitTimeline}><Maximize2/></button></div></div>
        <div className="trackhead"><div className="tracklabel">TRACKS <span>{deviceMode === 'Grouped' ? tracks.length : zoneCount}</span><button title="Cycle track height" onClick={() => setTrackHeight(h => h >= 81 ? 49 : h + 8)}><Plus size={13}/></button><button onClick={() => document.getElementById('track-search')?.focus()}><Search size={13}/></button></div><div className="audiohead" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onAudio(e.dataTransfer.files[0]); }}><div className="audioTitle"><span className="audioIcon"><AudioWaveform size={15}/></span><button className="audioFileName" onClick={() => fileInput.current?.click()}>{audioName} <Upload size={12}/></button><span className="tag">AUDIO</span><button className="icon tiny" title="Import audio" onClick={() => fileInput.current?.click()}><MoreHorizontal/></button></div><div className="headWave">{Array.from({ length: Math.min(170, actualWaveform.length) }, (_, i) => { const bin = actualWaveform[Math.floor(i * actualWaveform.length / Math.min(170, actualWaveform.length))]; return <i key={i} style={{ height: `${5 + Math.max(Math.abs(bin.min), Math.abs(bin.max)) * 18}px` }}/>; })}</div></div></div>
        <div className="timelineArea"><div className="headers" ref={headersRef} onScroll={e => { if (laneRef.current) laneRef.current.scrollTop = e.currentTarget.scrollTop; }}><div className="trackSearch"><Search size={12}/><input id="track-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter tracks"/><select value={deviceMode} onChange={e => setDeviceMode(e.target.value as 'Grouped' | 'Individual')}><option>Grouped</option><option>Individual</option></select></div><div className="trackheadSpacer"/>{trackStart > 0 && <div style={{ height: trackStart * trackHeight }} />} {renderedTracks.map((t, i) => <div className="track" key={t.id} style={{ "--track-height": `${trackHeight}px` } as React.CSSProperties}><span className="trackNum">{String(trackStart + i + 1).padStart(2, '0')}</span><span className="led" style={{ background: t.color, boxShadow: `0 0 9px ${t.color}77` }}/><span className="trackName">{t.label}</span><div className="trackOps"><button className={muted.includes(t.id) ? 'flag active' : 'flag'} onClick={() => changeTrackFlag('mute', t.id)}>M</button><button className={solo.includes(t.id) ? 'flag active' : 'flag'} onClick={() => changeTrackFlag('solo', t.id)}>S</button></div><div className="meter"><span style={{ background: t.color, width: `${Math.max(4, zoneLevel(t.id))}%` }}/></div></div>)} {trackEnd < visibleTracks.length && <div style={{ height: (visibleTracks.length - trackEnd) * trackHeight }} />}</div>
          <div className={`scroller ${isPanning ? 'panning' : ''}`} ref={laneRef} onPointerDownCapture={beginTouchTimelineGesture} onPointerMoveCapture={moveTouchTimelineGesture} onPointerUpCapture={finishTouchTimelineGesture} onPointerCancelCapture={finishTouchTimelineGesture} onPointerDown={e => { if (e.button === 1) beginTimelinePan(e); else if (e.button === 0) beginRubberBand(e); }} onClickCapture={e => { if (suppressTimelineClick.current) { e.preventDefault(); e.stopPropagation(); suppressTimelineClick.current = false; } }} onScroll={e => { if (headersRef.current) headersRef.current.scrollTop = e.currentTarget.scrollTop; setScrollX(e.currentTarget.scrollLeft); setTrackScroll(e.currentTarget.scrollTop); }}><div className="timeline" style={{ width: `${projectWidth}px`, '--z': zoom, '--timeline-scroll-x': `${scrollX}px`, '--timeline-viewport-width': `${viewportWidth}px` } as React.CSSProperties} onClick={e => { if (e.target === e.currentTarget) { clearSelection(); setPlayhead(timeAt(e)); } }}><div className="ruler">{Array.from({ length: Math.ceil(duration) + 1 }, (_, i) => <div key={i} className="tick" style={{ left: `${i * pxPerSecond}px` }} onClick={e => { e.stopPropagation(); clearSelection(); setPlayhead(i); }}><b>{String(Math.floor(i / 60)).padStart(2, '0')}:{String(i % 60).padStart(2, '0')}</b><span/></div>)}</div><div className="audioLane" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onAudio(e.dataTransfer.files[0]); }} onClick={e => { clearSelection(); setPlayhead(timeAt(e)); }}>{actualWaveform.length ? (mobileArrangementVisible ? <WaveformCanvas peaks={actualWaveform}/> : null) : <button className="audioEmpty" onClick={e => { e.stopPropagation(); fileInput.current?.click(); }}><Upload size={14}/>{waveformLoading ? 'Analyzing waveform...' : waveformError ? 'Waveform unavailable - choose another file' : isMobile ? 'Tap to import audio' : 'Drop audio here or click to import'}</button>}<div className="audioFade"/></div>
          {!clips.length && <div className="quickTutorial"><b>QUICK START</b><span><kbd>{isMobile ? 'Double-tap' : 'Double-click'}</kbd> a track to add a light clip</span><span><kbd>{isMobile ? 'Swipe' : 'Middle-click + drag'}</kbd> to move the timeline</span><span><kbd>{isMobile ? 'Pinch' : 'Ctrl + scroll'}</kbd> to zoom the timeline</span>{!isMobile && <button type="button" onClick={() => setShowHelp(true)}><kbd>Shift + ?</kbd> to see keybinds</button>}</div>}
          {trackStart > 0 && <div style={{ height: trackStart * trackHeight }} />} {mobileArrangementVisible && renderedTracks.map(t => <div className="lane" key={t.id} style={{ '--z': zoom, '--track-height': `${trackHeight}px` } as React.CSSProperties} onPointerDown={e => beginLaneLongPressCreate(e, t.id)} onDoubleClick={e => { const rect = e.currentTarget.getBoundingClientRect(); createClip(t.id, (e.clientX - rect.left) / pxPerSecond); }} onClick={e => handleLaneClick(e, t.id)}>{clips.filter(c => c.track === t.id && !muted.includes(t.id) && (!solo.length || solo.includes(t.id))).map(c => <ClipView key={c.id} clip={c as ExtendedClip} allClips={clips as ExtendedClip[]} selected={selectionIds.includes(c.id)} selectedIds={selectionIds} trackOrder={visibleTrackIds} trackHeight={trackHeight} zoom={zoom} snap={align} onSelect={modifier => { const current = selectionIdsRef.current; const next = modifier ? (current.includes(c.id) ? current.filter(id => id !== c.id) : [...current, c.id]) : [c.id]; selectionIdsRef.current = next; setSelectionIds(next); set(s => ({ selected: next.includes(c.id) ? c.id : next[next.length - 1] ?? null })); }} onContextMenu={(x, y) => { set(s => ({ selected: c.id })); selectionIdsRef.current = [c.id]; setSelectionIds([c.id]); setContextMenu({ x, y, clipId: c.id }); }} onMove={(start, destinationTrack) => set(s => ({ clips: moveClipGroup(s.clips, selectionIdsRef.current.includes(c.id) ? selectionIdsRef.current : [c.id], c.id, start, destinationTrack, visibleTrackIds) }))} onMovePreview={(delta, deltaY) => { const movingIds = new Set([...selectionIdsRef.current, c.id]); for (const id of movingIds) { const movingClip = laneRef.current?.querySelector<HTMLElement>(`.clip[data-clip-id="${id}"]`); if (movingClip && !movingClip.classList.contains('locked')) { const previewing = Boolean(delta || deltaY); movingClip.style.transform = previewing ? `translate3d(${delta * pxPerSecond}px, ${deltaY}px, 0)` : ''; movingClip.classList.toggle('dragging-preview', previewing); movingClip.parentElement?.classList.toggle('dragging-lane', previewing); } } }} onResize={(start, duration) => set(s => ({ clips: s.clips.map(x => { if (x.id !== c.id) return x; if (Math.abs(start - c.start) < .0001) return { ...x, duration: durationBeforeNextClip(s.clips, x.track, start, duration, x.id) }; const freeStart = nearestFreeStart(s.clips, x.track, start, duration, x.id); return { ...x, start: freeStart, duration }; }) }))} onDelete={() => set(s => ({ clips: s.clips.filter(x => x.id !== c.id), selected: null }))}/>)}</div>)} {trackEnd < visibleTracks.length && <div style={{ height: (visibleTracks.length - trackEnd) * trackHeight }} />}
          <div className="loopRegion" style={{ left: loopA * pxPerSecond, width: (loopB - loopA) * pxPerSecond }} onPointerDown={e => { if (e.button !== 0) return; const el = e.currentTarget; const startX = e.clientX; const origA = loopA, origB = loopB; el.setPointerCapture(e.pointerId); const move = (v: PointerEvent) => { const d = (v.clientX - startX) / pxPerSecond; const a = Math.max(0, Math.min(duration - .1, origA + d)); moveLoopRange(a, Math.min(duration, Math.max(a + .1, origB + d))); }; const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); }; el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); }}><b>A</b><b>B</b><span className="loopHandle left" title="Drag to set loop start" onPointerDown={e => beginLoopResize(e, 'start')}/><span className="loopHandle right" title="Drag to set loop end" onPointerDown={e => beginLoopResize(e, 'end')}/></div>{marquee && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}/>}<div className="playhead" style={{ left: playhead * pxPerSecond }}><span onPointerDown={beginPlayheadDrag} title="Drag to seek"/><i/></div></div></div>
        </div>
        <div className="bottom"><div className="mini"><span>OVERVIEW</span><div className="miniWave" onClick={e => { if (!actualWaveform.length) { fileInput.current?.click(); return; } const rect = e.currentTarget.getBoundingClientRect(); const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)); laneRef.current?.scrollTo({ left: Math.max(0, ratio * projectWidth - viewportWidth / 2), behavior: 'smooth' }); setPlayhead(ratio * duration); }}>{actualWaveform.length ? actualWaveform.filter((_, i) => i % Math.max(1, Math.ceil(actualWaveform.length / 320)) === 0).map((bin, i) => <i key={i} style={{ height: `${3 + Math.max(Math.abs(bin.min), Math.abs(bin.max)) * 18}px` }}/>) : <small>{waveformLoading ? 'Analyzing audio...' : waveformError ? 'Waveform unavailable' : 'Load audio to view waveform'}</small>}{audioFile && <div className="miniView" style={{ left: `${scrollX / projectWidth * 100}%`, width: `${Math.min(100, viewportWidth / projectWidth * 100)}%` }}/>}</div></div><div className="auto"><div><span className="autoDot"/> MASTER BRIGHTNESS </div><input className="brightnessRange" aria-label="Master brightness" type="range" min="0" max="100" value={masterBrightness} onChange={e => setMasterBrightness(Number(e.target.value))}/><b>{masterBrightness}%</b></div><div className="status"><span><span className="liveDot"/> {playing ? 'PLAYING' : 'READY'}</span><span>{duration.toFixed(1)}s</span><span>{GLYPH_STEP_MS} ms</span></div></div>
      </section>
      <aside className="inspector"><div className="inspectHeader"><span>{activeClip && (isMobile ? mobileTab !== 'monitor' : desktopAsideView === 'inspector') ? 'CLIP INSPECTOR' : 'GLYPH MONITOR'}</span><div className="desktopInspectorTabs"><button type="button" className={desktopAsideView === 'inspector' ? 'active' : ''} onClick={() => setDesktopAsideView('inspector')}>Inspector</button><button type="button" className={desktopAsideView === 'monitor' ? 'active' : ''} onClick={() => setDesktopAsideView('monitor')}>Monitor</button></div><button className="icon tiny" onClick={() => setShowHelp(true)}><MoreHorizontal/></button></div>{((isMobile && mobileTab !== 'monitor') || (!isMobile && desktopAsideView === 'inspector')) && activeClip ? <div className="clipInspector"><label>NAME<input value={activeClip.name} onChange={e => setClip({ name: e.target.value })}/></label><label>BRIGHTNESS <b>{activeClip.brightness}%</b><input type="range" min="0" max="100" value={activeClip.brightness} onChange={e => setClip({ brightness: Number(e.target.value) })}/></label><label>EFFECT<select value={activeClip.effect || 'Steady'} onChange={e => setClip({ effect: e.target.value as GlyphEffect })}>{EFFECTS.map(x => <option key={x}>{x}</option>)}</select></label>{activeClipZones.length > 1 && <><label>LIGHT MODE<select value={activeClip.lightMode || 'Normal'} onChange={e => setClip({ lightMode: e.target.value as GlyphLightMode, direction: activeClip.direction || 'forward', tailLength: activeClip.tailLength || 3, fillAmount: activeClip.fillAmount || activeClipStrip.length, selectedZones: activeClip.selectedZones || activeClipZones })}><option>Normal</option>{activeClipStrip.length > 1 && <><option>Fill</option><option>Sweep</option></>}<option>Zones</option></select></label>{(activeClip.lightMode === 'Fill' || activeClip.lightMode === 'Sweep') && <label>DIRECTION<select value={activeClip.direction || 'forward'} onChange={e => setClip({ direction: e.target.value as GlyphLightDirection })}><option value="forward">Start → End</option><option value="reverse">End → Start</option><option value="forward-instant">Start → End (instant)</option><option value="reverse-instant">End → Start (instant)</option></select></label>}{activeClip.lightMode === 'Sweep' && <label>SWEEP TAIL · {activeClip.tailLength || 3} ZONES<input type="range" min="1" max={activeClipStrip.length} value={Math.min(activeClipStrip.length, activeClip.tailLength || 3)} onChange={e => setClip({ tailLength: Number(e.target.value) })}/></label>}{activeClip.lightMode === 'Fill' && <label>FILL LENGTH · {Math.min(activeClipStrip.length, activeClip.fillAmount || activeClipStrip.length)} ZONES<input type="range" min="1" max={activeClipStrip.length} value={Math.min(activeClipStrip.length, activeClip.fillAmount || activeClipStrip.length)} onChange={e => setClip({ fillAmount: Number(e.target.value) })}/></label>}{activeClip.lightMode === 'Zones' && <><div className="zonePickerTools"><button type="button" className="tool" onClick={() => setClip({ selectedZones: activeClipZones })}>All</button><button type="button" className="tool" onClick={() => setClip({ selectedZones: [] })}>None</button></div><div className="zonePicker" aria-label="Glyph zones">{activeClipZones.map(zone => <label key={zone}><input type="checkbox" checked={(activeClip.selectedZones ?? activeClipZones).includes(zone)} onChange={e => { const current = activeClip.selectedZones ?? activeClipZones; const next = e.target.checked ? [...new Set([...current, zone])] : current.filter(selectedZone => selectedZone !== zone); setClip({ selectedZones: next }); }}/><span>LED {String(zone + 1).padStart(3, '0')}</span></label>)}</div></>}</>}<div className="clipColorControl"><span>CLIP COLOR</span><div className="clipColorOptions">{COLORS.map(color => <button key={color} type="button" className={`clipColorSwatch ${normalizeClipColor(activeClip.color).toLowerCase() === color.toLowerCase() ? 'active' : ''}`} style={{ '--swatch': color } as React.CSSProperties} aria-label={`Set clip color ${color}`} title={color} onClick={() => setClip({ color })}/>)}<label className="customColor" title="Choose a custom color"><input type="color" aria-label="Choose custom clip color" value={normalizeClipColor(activeClip.color)} onChange={e => setClip({ color: e.target.value })}/><span>+</span></label></div></div><div className="clipFields"><label>START (s)<input type="number" step=".01" value={activeClip.start.toFixed(2)} onChange={e => setClip({ start: Number(e.target.value) })}/></label><label>LENGTH (s)<input type="number" min=".05" step=".05" value={activeClip.duration.toFixed(2)} onChange={e => setClip({ duration: Math.max(.05, Number(e.target.value)) })}/></label></div><button className="tool" onClick={() => setClip({ locked: !activeClip.locked })}>{activeClip.locked ? <Lock size={14}/> : <LockOpen size={14}/>} {activeClip.locked ? 'Unlock clip' : 'Lock clip'}</button><button className="tool danger" onClick={deleteSelected}><Trash2 size={14}/> Delete clip</button><button className="tool" onClick={duplicateSelected}><Copy size={14}/> Duplicate clip</button></div> : ((isMobile && mobileTab === 'inspector') || (!isMobile && desktopAsideView === 'inspector')) ? <div className="emptyInspector">Select a clip to inspect.</div> : <><div className="deviceCard"><div className="deviceCaption"><span>PREVIEW</span><button className="mirror" onClick={() => setMirrored(v => !v)}>{mirrored ? 'NORMAL' : 'MIRROR'}</button></div>{(!isMobile || mobileTab === 'monitor') && <PhonePreview model={device} deviceMode={deviceMode} activeLevels={activeLevels} globalBrightness={masterBrightness / 100} mirrored={mirrored}/>}<div className="phoneInfo"><span>NOTHING <b>{DEVICE_NAMES[device as keyof typeof DEVICE_NAMES]}</b></span><span className="online">LIVE</span></div><a className="sourceCodeLink" href={`${import.meta.env.BASE_URL}glyph-daw-source.zip`} download>Source code · GPL-3.0</a></div><div className="sectionTitle">MASTER OUTPUT</div><div className="master"><div className="masterIcon"><Volume2 size={15}/></div><div className="masterText"><b>Glyph brightness</b><small>All zones scaled output</small></div><input type="range" min="0" max="100" value={masterBrightness} onChange={e => setMasterBrightness(Number(e.target.value))}/><b className="pct">{masterBrightness}%</b></div><div className="sectionTitle zoneTitle">ACTIVE ZONES <span>{tracks.filter(t => zoneLevel(t.id) > 0).length} / {zoneCount}</span></div>{tracks.slice(0, 6).map(t => <div className="zone" key={t.id}><span className="zoneLed" style={{ background: t.color, boxShadow: `0 0 8px ${t.color}77` }}/><span>{t.label}</span><div className="zoneMeter"><i style={{ width: `${Math.max(4, zoneLevel(t.id))}%`, background: t.color }}/></div></div>)}</>}
        <div className="inspectorFooter"><button className="icon tiny inspectorOgaExport" aria-label="Download OGG" title={exporting ? 'Encoding OGG…' : 'Download OGG'} disabled={exporting} onClick={() => void exportOga()}><ArrowDownToLine/></button></div>
      </aside>
    </main>
    <nav className="mobileNav" role="tablist" aria-label="Main views"><button role="tab" aria-selected={mobileTab === 'arrangement'} className={mobileTab === 'arrangement' ? 'active' : ''} onClick={() => setMobileTab('arrangement')}>Arrangement</button><button role="tab" aria-selected={mobileTab === 'monitor'} className={mobileTab === 'monitor' ? 'active' : ''} onClick={() => setMobileTab('monitor')}>Monitor</button><button role="tab" aria-selected={mobileTab === 'inspector'} className={mobileTab === 'inspector' ? 'active' : ''} onClick={() => setMobileTab('inspector')}>Inspector</button></nav>
    {contextMenu && <><div className="contextDismiss" onPointerDown={() => setContextMenu(null)}/><div className="clipContextMenu" style={{ left: Math.min(contextMenu.x, window.innerWidth - 180), top: Math.min(contextMenu.y, window.innerHeight - 250) }} onPointerDown={e => e.stopPropagation()}>{contextClipStrip.length > 1 && <><span className="clipContextHeading">Effect</span><button onClick={() => { setClipLightMode(contextMenu.clipId, 'Normal'); setContextMenu(null); }}>Normal</button><button onClick={() => { setClipLightMode(contextMenu.clipId, 'Fill'); setContextMenu(null); }}>Fill</button><button onClick={() => { setClipLightMode(contextMenu.clipId, 'Sweep'); setContextMenu(null); }}>Sweep</button></>}<button onClick={() => { duplicateClipById(contextMenu.clipId); setContextMenu(null); }}>Duplicate</button><button onClick={() => { set(s => ({ clips: s.clips.filter(c => c.id !== contextMenu.clipId), selected: null })); selectionIdsRef.current = []; setSelectionIds([]); setContextMenu(null); }}>Delete</button><button onClick={() => { set(s => ({ clips: s.clips.map(c => c.id === contextMenu.clipId ? { ...c, locked: !(c as ExtendedClip).locked } : c), selected: contextMenu.clipId })); selectionIdsRef.current = [contextMenu.clipId]; setSelectionIds([contextMenu.clipId]); setContextMenu(null); }}>Toggle lock</button></div></>}
    {showHelp && <div className="modalBg" onClick={() => setShowHelp(false)}><div className="help" onClick={e => e.stopPropagation()}><div><b>Keyboard shortcuts</b><button onClick={() => setShowHelp(false)}>Close</button></div><p><kbd>Space</kbd><span>Play / pause</span></p><p><kbd>Ctrl/Cmd A</kbd><span>Select all clips</span></p><p><kbd>Ctrl/Cmd Z</kbd><span>Undo</span></p><p><kbd>Ctrl/Cmd D</kbd><span>Duplicate clip</span></p><p><kbd>Shift ↑ / ↓</kbd><span>Move selected clips between tracks</span></p><p><kbd>S</kbd><span>Split selected clip at playhead</span></p><p><kbd>Ctrl/Cmd C / V</kbd><span>Copy / paste clip</span></p><p><kbd>Ctrl/Cmd S / O</kbd><span>Save / open project</span></p><p><kbd>Delete</kbd><span>Delete selected clip</span></p><p><kbd>Esc</kbd><span>Close this panel</span></p><button className="export" onClick={exportJson}><ArrowDownToLine size={14}/> Export NGlyph JSON</button></div></div>}
  </div>;
}

function ClipView({ clip, allClips, selected, selectedIds, trackOrder, trackHeight, zoom, snap, onSelect, onContextMenu, onMove, onMovePreview, onResize, onDelete }: { clip: ExtendedClip; allClips: ExtendedClip[]; selected: boolean; selectedIds: string[]; trackOrder: number[]; trackHeight: number; zoom: number; snap: (v: number) => number; onSelect: (modifier: boolean) => void; onContextMenu: (x: number, y: number) => void; onMove: (start: number, destinationTrack: number) => void; onMovePreview: (deltaSeconds: number, deltaY: number) => void; onResize: (start: number, duration: number) => void; onDelete: () => void }) {
  const clipColor = normalizeClipColor(clip.color);
  function drag(e: React.PointerEvent<HTMLElement>, edge: 'move' | 'left' | 'right') {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (clip.locked) return;
    const el = e.currentTarget.closest<HTMLElement>('.clip');
    if (!el) return;
    const pointerX = e.clientX;
    const pointerY = e.clientY;
    const start = clip.start;
    const duration = clip.duration;
    const movingIds = selected && selectedIds.includes(clip.id) ? selectedIds : [clip.id];
    const collisionClips = edge === 'move' ? allClips.filter(item => !movingIds.includes(item.id)) : allClips;
    let delta = 0;
    let rowDelta = 0;
    el.setPointerCapture(e.pointerId);
    const trackAtRow = (rows: number) => {
      if (!trackOrder.length) return clip.track;
      const currentIndex = trackOrder.indexOf(clip.track);
      const from = currentIndex < 0 ? 0 : currentIndex;
      const targetIndex = Math.max(0, Math.min(trackOrder.length - 1, from + rows));
      return trackOrder[targetIndex] ?? clip.track;
    };
    const getGeometry = (offset: number, rows: number) => {
      const destinationTrack = edge === 'move' ? trackAtRow(rows) : clip.track;
      if (edge === 'move') return { start: nearestFreeStart(collisionClips, destinationTrack, snap(start + offset), duration, clip.id), duration, track: destinationTrack };
      if (edge === 'left') {
        const requestedStart = Math.max(0, Math.min(start + duration - .05, snap(start + offset)));
        const requestedDuration = start + duration - requestedStart;
        return { start: nearestFreeStart(allClips, clip.track, requestedStart, requestedDuration, clip.id), duration: requestedDuration, track: clip.track };
      }
      const requestedDuration = Math.max(.05, snap(duration + offset));
      return { start, duration: durationBeforeNextClip(allClips, clip.track, start, requestedDuration, clip.id), track: clip.track };
    };
    const move = (ev: PointerEvent) => {
      delta = (ev.clientX - pointerX) / (44 * zoom);
      rowDelta = edge === 'move' ? Math.round((ev.clientY - pointerY) / trackHeight) : 0;
      if (edge === 'move' && trackOrder.length) {
        const currentIndex = trackOrder.indexOf(clip.track);
        const from = currentIndex < 0 ? 0 : currentIndex;
        rowDelta = Math.max(0, Math.min(trackOrder.length - 1, from + rowDelta)) - from;
      }
      const next = getGeometry(delta, rowDelta);
      if (edge === 'move') {
        // Group preview translates every selected clip, including this one.
        // Updating its left position as well would apply the drag twice.
        onMovePreview(next.start - start, rowDelta * trackHeight);
      } else {
        el.style.left = `${next.start * 44 * zoom}px`;
        el.style.width = `${next.duration * 44 * zoom}px`;
      }
    };
    const finish = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', finish);
      el.removeEventListener('pointercancel', finish);
      if (edge === 'move') onMovePreview(0, 0);
      if (ev.type === 'pointerup' && (Math.abs(delta) > .015 || rowDelta !== 0)) {
        const next = getGeometry(delta, rowDelta);
        if (edge === 'move') onMove(next.start, next.track);
        else onResize(next.start, next.duration);
      } else {
        el.style.left = `${start * 44 * zoom}px`;
        el.style.width = `${duration * 44 * zoom}px`;
        el.style.transform = '';
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
  }
  return <div data-clip-id={clip.id} className={`clip ${selected ? 'selected' : ''} ${clip.locked ? 'locked' : ''}`} onClick={e => e.stopPropagation()} onDoubleClick={e => { e.stopPropagation(); onSelect(e.shiftKey || e.ctrlKey || e.metaKey); }} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onContextMenu(e.clientX, e.clientY); }} onPointerDown={e => { if (e.button !== 0) return; const modifier = e.shiftKey || e.ctrlKey || e.metaKey; if (modifier || !selected) onSelect(modifier); drag(e, 'move'); }} style={{ left: `${clip.start * 44 * zoom}px`, width: `${clip.duration * 44 * zoom}px`, background: `linear-gradient(100deg,${clipColor}22,${clipColor}0d)`, borderColor: `${clipColor}88`, '--clip': clipColor } as React.CSSProperties}><span className="clipStripe"/><span className="clipName">{clip.name}</span><span className="clipBrightness">{clip.lightMode && clip.lightMode !== 'Normal' ? `${clip.lightMode} · ` : ''}{clip.effect || 'Steady'} / {clip.brightness}%</span><span className="handle left" onPointerDown={e => drag(e, 'left')}/><span className="handle right" onPointerDown={e => drag(e, 'right')}/></div>;
}
export default App;






