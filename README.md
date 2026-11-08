# Glyph DAW

A desktop-first Glyph pattern editor for Nothing Phone devices. The UI is built with React 18, TypeScript, Vite, Zustand, zundo, FFmpeg.wasm, and Pako.

## Run locally

```sh
npm install
npm run dev
```

For a production build:

```sh
npm run build
npm run preview
```

## Publish with GitHub Pages

This repository is configured to build and deploy to GitHub Pages whenever changes are pushed to `main`. Create a public repository named `glyph-daw` under your account, push this project to its `main` branch, then set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. The workflow builds the Vite app and publishes `dist`.

## Current workflow

- Click the audio filename in the audio lane header to load a local audio file. The timeline derives duration from the audio metadata.
- Choose a device in the transport. Device identifiers and output zone counts follow Better Nothing Glyph Composer: Phone (1) = 5, experimental Phone (1) mode = 15, Phone (2) = 33, Phone (2a) = 26, Phone (2a Plus) = 26, Phone (3a/Pro) = 36, Phone (3) = 625.
- Double-click a Glyph lane to place a clip. Draw mode allows single-click placement. Drag clips to move them and drag either edge to trim. Right-click a clip for duplicate, delete, and lock actions.
- Shift-click clips to multi-select; drag the selection as a group, or copy, duplicate, and delete the selection together.
- Clips on the same lane may overlap. Moving, trimming, quantizing, duplicating, pasting, filling, generating, and loading projects preserve the requested clip positions.
- Drag empty timeline space horizontally to pan the view; a normal click still seeks or draws. Timeline text selection is disabled during this gesture.
- Select a clip to edit its name, brightness, effect, start, duration, or lock state in the inspector. Supported export effects are steady, fade in/out, pulse, and strobe.
- Choose grouped zones or individual LEDs, filter tracks, and use per-track mute/solo flags. The Phone (3) individual view contains 625 lanes.
- Set the tempo manually or estimate it from the imported audio. Snap supports milliseconds and 1/32 through 1/2 note values. Split at the playhead with `S`; duplicate with Ctrl/Cmd+D; copy/paste with Ctrl/Cmd+C/V; delete with Delete; undo/redo with Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z.
- Generate clips from audio energy/onset peaks with Subtle, Rhythmic, or Aggressive presets. This uses the decoded RMS envelope and is a starting point for editing. BPM detection uses the same higher-resolution onset envelope.
- The waveform is decoded from imported audio in the browser. Space toggles playback; loop can be enabled in the transport and its range moved in the timeline.
- Project autosave uses localStorage. Save/open `.glyphdaw` project files to bundle the source audio and arrangement. OGG export uses FFmpeg.wasm to create Opus audio with a 60 Hz CRLF Glyph CSV compressed into `AUTHOR`, device-specific `COMPOSER` and `CUSTOM2` tags, and compressed timeline-dot data in `CUSTOM1`. Grouped clips expand to the same physical zones shown in the monitor; individual mode writes one CSV column per LED zone. The `ALBUM` tag matches the reference composer's `BNGC v1` sound pack. The author/watermark field is added as an artist/comment tag. The first export downloads FFmpeg.wasm from jsDelivr, so an internet connection is needed. Raw NGlyph JSON export is in the inspector footer.
- To use the lights on your phone, import the file through the Nothing Glyph Composer app's Library menu (`⋮` → Import), then set the imported composition as your ringtone. A normal audio player or the Android “My sounds” picker can play the audio without registering its Glyph composition.
- The A–B range marked on the ruler controls export cropping independently of the playback Loop toggle. Set A to 0 and B to the audio end for a full-track export; both the audio and Glyph data are cropped and aligned to A otherwise.
- Export settings beside Download OGG can optionally apply an audio fade in and fade out. Set each duration independently; the Glyph light pattern remains unchanged.

## Current scope

The arrangement view, track and clip editing, transport, device selector, phone preview, history undo/redo, audio import and waveform, energy/onset clip generation, BPM estimate, OGG export, and project save/load are implemented. Individual LED mode virtualizes long track lists for scrolling. Each supported phone preview uses a device-specific SVG layout; Phone (3) uses a 25×25 circular matrix. Video export remains future work.

## Glyph compatibility reference

Device labels, zone counts, compressed CSV and Ogg metadata conventions were checked against [Better Nothing Glyph Composer](https://github.com/Krishnagopal-Sinha/better-nothing-glyph-composer), especially its `src/lib/consts.ts`, `src/lib/data_store.ts`, `src/logic/export_logic.ts`, and `src/logic/ffmpeg_service.ts`. Glyph DAW's OGG writer is a focused browser-side implementation using the same metadata conventions.

## Glyph SVG attribution and license

The Phone (1), Phone (1) 15-zone, Phone (2), Phone (2a), and Phone (3a) SVG Glyph path definitions in `src/phone-layouts` are adapted from [Better Nothing Glyph Composer](https://github.com/Krishnagopal-Sinha/better-nothing-glyph-composer), by Krishnagopal Sinha and contributors. That project identifies its license as GNU GPL version 3. The Phone (3) matrix layout and device backplates are Glyph DAW additions. This combined application is distributed under GPL-3.0-only; see `COPYING`. The deployed site provides a downloadable archive of its corresponding source at `glyph-daw-source.zip`.
