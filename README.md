# ScoreForge

Best-shot audio-to-sheet-music with a full MIDI editor, playback, and
printable scores. **No AI anywhere in the pipeline** — pure classical DSP.

Ships as `.AppImage` (Linux), `.app` / `.dmg` (macOS), and `.exe` (Windows).

## What it does

- **Load** an audio file (mp3 / wav / flac / ogg / m4a / aac / opus / webm).
- **Vocal reduce** (karaoke-style L−R subtract) or **vocal isolate** (center emphasis).
- **Transcribe** a dominant melody line to MIDI notes using one of several
  pitch detectors (YIN, AMDF, Dynamic Wavelet, Autocorrelation).
- **Edit** everything in a canvas piano roll:
  - draw / erase / move / resize notes
  - add or remove tracks and swap instrument per track
  - change tempo, time signature, snap, key, zoom
  - keyboard: arrows nudge pitch/time, Shift+Up/Down jumps octaves,
    Ctrl/Cmd+A selects all, Delete removes
- **Play** the project back through a built-in Tone.js synth (one instrument
  preset per track).
- **Render sheet music** on screen with VexFlow — clef, key signature, time
  signature all configurable.
- **Export** MIDI, MusicXML, or print the sheet music to PDF.

## Honest limits

ScoreForge does its best shot. Here is what "best shot" means in practice.

- **Monophonic bias.** The transcription assumes one dominant melody line in
  each frame. Dense polyphony (full band mixes) will not come out
  "semi-perfect" — the detector will drift to whatever is loudest or clearest
  from frame to frame. The editor is what turns that first pass into a usable
  score.
- **Vocal reduction** is center-channel subtraction. It works when the vocal
  is panned center on a plain stereo mix; it fails on wide-stereo modern
  mixes and will also eat anything else sitting in the center (kick, snare,
  bass).
- **No AI stem separation**, by design.

For a cleaner first pass, start with a solo instrument or a vocal line, or
run **Vocal reduce** / **Vocal only** before Transcribe.

## Run from source

```
npm install
npm start
```

## Build native installers

```
npm run build:linux     # AppImage
npm run build:mac       # dmg
npm run build:win       # NSIS installer (.exe)
npm run build:all       # all three
```

Output lands in `dist/`.

## Keyboard shortcuts

| key                       | action                              |
|---------------------------|-------------------------------------|
| Arrow Up / Down           | nudge selected notes by 1 semitone  |
| Shift + Arrow Up / Down   | nudge by 1 octave                   |
| Arrow Left / Right        | nudge by one snap step              |
| Delete / Backspace        | delete selected notes               |
| Ctrl/Cmd + A              | select all notes in active track    |
| Ctrl/Cmd + wheel          | zoom                                |
| Shift + wheel             | horizontal scroll                   |
| wheel                     | vertical scroll                     |

## Project model

A project is a plain object held in memory:

```js
{
  tempo: 120,
  beatsPerBar: 4,
  unit: 4,
  tracks: [
    {
      id: 1,
      name: 'Melody',
      instrument: 'Piano',
      color: '#4ea1ff',
      muted: false,
      notes: [
        { pitch: 72, startSec: 0.0, durationSec: 0.5, velocity: 96 },
        ...
      ]
    }
  ]
}
```

MIDI export uses `@tonejs/midi`. MusicXML export is hand-rolled and loads in
MuseScore, Finale, Sibelius, Dorico, Flat.io and most notation software.

## Legal

Transcribing copyrighted recordings for private study is one thing;
distributing scores derived from them is another. This app is a tool —
what you do with its output is on you.

## License

MIT.
