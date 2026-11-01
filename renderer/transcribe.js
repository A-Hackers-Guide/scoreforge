// Monophonic audio-to-notes transcription.
// Classical DSP: pitchfinder (YIN/AMDF/etc.) + median filter + note segmentation.
// Honest limits: assumes a dominant melody line. On dense polyphony it will
// drift to whatever is loudest/clearest in that frame.

const Pitchfinder = require('pitchfinder')

function hzToMidiFloat (hz) { return 69 + 12 * Math.log2(hz / 440) }
function midiToHz (m) { return 440 * Math.pow(2, (m - 69) / 12) }

function medianFilter (arr, k = 5) {
  const half = Math.floor(k / 2)
  const out = new Array(arr.length)
  for (let i = 0; i < arr.length; i++) {
    const w = []
    for (let j = -half; j <= half; j++) {
      const idx = i + j
      if (idx >= 0 && idx < arr.length && arr[idx] != null) w.push(arr[idx])
    }
    if (w.length < 3) { out[i] = null; continue }
    w.sort((a, b) => a - b)
    out[i] = w[Math.floor(w.length / 2)]
  }
  return out
}

function downmixMono (audioBuffer) {
  const ch = audioBuffer.numberOfChannels
  const n = audioBuffer.length
  const mono = new Float32Array(n)
  for (let c = 0; c < ch; c++) {
    const d = audioBuffer.getChannelData(c)
    for (let i = 0; i < n; i++) mono[i] += d[i] / ch
  }
  return mono
}

function frameRMS (frame) {
  let s = 0
  for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i]
  return Math.sqrt(s / frame.length)
}

async function transcribe (audioBuffer, opts = {}) {
  const {
    algorithm = 'YIN',
    tempo = 120,
    minNoteMs = 90,
    minHz = 55,
    maxHz = 1500,
    silenceRms = 0.01,
    onProgress = null
  } = opts

  const sampleRate = audioBuffer.sampleRate
  const mono = downmixMono(audioBuffer)
  const frameSize = 2048
  const hopSize = 512

  let detect
  switch (algorithm) {
    case 'AMDF': detect = Pitchfinder.AMDF({ sampleRate, minFrequency: minHz, maxFrequency: maxHz }); break
    case 'DynamicWavelet': detect = Pitchfinder.DynamicWavelet({ sampleRate }); break
    case 'ACF2PLUS': detect = Pitchfinder.ACF2PLUS({ sampleRate }); break
    default: detect = Pitchfinder.YIN({ sampleRate, threshold: 0.1 })
  }

  const nFrames = Math.max(0, Math.floor((mono.length - frameSize) / hopSize) + 1)
  const pitches = new Array(nFrames)
  const confident = new Array(nFrames)
  const batchSize = 256

  for (let i = 0; i < nFrames; i++) {
    const start = i * hopSize
    const frame = mono.subarray(start, start + frameSize)
    const rms = frameRMS(frame)
    if (rms < silenceRms) {
      pitches[i] = null
      confident[i] = false
    } else {
      const hz = detect(frame)
      if (hz && hz >= minHz && hz <= maxHz) {
        pitches[i] = hzToMidiFloat(hz)
        confident[i] = true
      } else {
        pitches[i] = null
        confident[i] = false
      }
    }
    if (onProgress && (i % batchSize === 0)) {
      onProgress(i / nFrames)
      // yield
      await new Promise(r => setTimeout(r, 0))
    }
  }

  // Round to semitones
  const rounded = pitches.map(p => p == null ? null : Math.round(p))
  // Smooth to kill flutter
  const smoothed = medianFilter(rounded, 5)

  // Segment into notes
  const frameDur = hopSize / sampleRate
  const notes = []
  let curPitch = null
  let curStartFrame = 0
  for (let i = 0; i < smoothed.length; i++) {
    const p = smoothed[i]
    if (p !== curPitch) {
      if (curPitch != null) {
        const startSec = curStartFrame * frameDur
        const durSec = (i - curStartFrame) * frameDur
        if (durSec * 1000 >= minNoteMs) {
          notes.push({ pitch: curPitch, startSec, durationSec: durSec, velocity: 96 })
        }
      }
      curPitch = p
      curStartFrame = i
    }
  }
  if (curPitch != null) {
    const startSec = curStartFrame * frameDur
    const durSec = (smoothed.length - curStartFrame) * frameDur
    if (durSec * 1000 >= minNoteMs) {
      notes.push({ pitch: curPitch, startSec, durationSec: durSec, velocity: 96 })
    }
  }

  if (onProgress) onProgress(1)

  return {
    notes,
    tempo,
    sampleRate,
    durationSec: audioBuffer.duration
  }
}

module.exports = { transcribe, hzToMidiFloat, midiToHz }
