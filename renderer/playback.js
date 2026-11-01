// Playback engine built on Tone.js: one PolySynth per track, with a GM-ish
// instrument preset. Keeps a playhead callback the UI subscribes to.

const Tone = require('tone')

const INSTRUMENTS = {
  'Piano':         { oscillator: { type: 'triangle' }, envelope: { attack: 0.005, decay: 0.2, sustain: 0.25, release: 0.8 } },
  'Electric Piano':{ oscillator: { type: 'sine' },     envelope: { attack: 0.005, decay: 0.5, sustain: 0.3,  release: 1.0 } },
  'Guitar':        { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.01,  decay: 0.3, sustain: 0.1,  release: 0.6 } },
  'Bass':          { oscillator: { type: 'square' },   envelope: { attack: 0.005, decay: 0.4, sustain: 0.3,  release: 0.4 } },
  'Strings':       { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.2,   decay: 0.3, sustain: 0.8,  release: 1.4 } },
  'Pad':           { oscillator: { type: 'sine' },     envelope: { attack: 0.5,   decay: 0.5, sustain: 0.9,  release: 2.0 } },
  'Lead Synth':    { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.01,  decay: 0.2, sustain: 0.6,  release: 0.3 } },
  'Flute':         { oscillator: { type: 'sine' },     envelope: { attack: 0.08,  decay: 0.1, sustain: 0.7,  release: 0.4 } },
  'Brass':         { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.05,  decay: 0.2, sustain: 0.8,  release: 0.4 } },
  'Choir':         { oscillator: { type: 'sine' },     envelope: { attack: 0.3,   decay: 0.3, sustain: 0.9,  release: 1.2 } }
}

const INSTRUMENT_NAMES = Object.keys(INSTRUMENTS)

function midiToNoteName (m) {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
  return names[m % 12] + (Math.floor(m / 12) - 1)
}

class Playback {
  constructor () {
    this.master = new Tone.Gain(0.8).toDestination()
    this.synths = new Map()
    this.scheduled = []
    this.playing = false
    this.startAt = 0
    this.startOffset = 0
    this.onTick = null
    this._rafId = null
    this.duration = 0
  }

  setVolume (v) { this.master.gain.rampTo(v, 0.05) }

  _synthFor (track) {
    let s = this.synths.get(track.id)
    if (s) {
      s.releaseAll && s.releaseAll()
      s.dispose()
    }
    const preset = INSTRUMENTS[track.instrument] || INSTRUMENTS['Piano']
    s = new Tone.PolySynth(Tone.Synth, preset).connect(this.master)
    s.volume.value = -6
    this.synths.set(track.id, s)
    return s
  }

  async play (project, fromSec = 0) {
    await Tone.start()
    this.stop()
    this.duration = project.durationSec()
    const now = Tone.now() + 0.05
    this.startAt = now
    this.startOffset = fromSec
    for (const track of project.tracks) {
      if (track.muted) continue
      const synth = this._synthFor(track)
      for (const n of track.notes) {
        if (n.startSec + n.durationSec < fromSec) continue
        const localStart = Math.max(0, n.startSec - fromSec)
        const t = now + localStart
        const d = Math.max(0.05, n.durationSec - Math.max(0, fromSec - n.startSec))
        synth.triggerAttackRelease(midiToNoteName(n.pitch), d, t, n.velocity / 127)
      }
    }
    this.playing = true
    const tick = () => {
      if (!this.playing) return
      const t = Tone.now() - this.startAt + this.startOffset
      if (this.onTick) this.onTick(t)
      if (t >= this.duration + 0.5) { this.stop(); return }
      this._rafId = requestAnimationFrame(tick)
    }
    this._rafId = requestAnimationFrame(tick)
  }

  stop () {
    this.playing = false
    if (this._rafId) cancelAnimationFrame(this._rafId)
    this._rafId = null
    for (const s of this.synths.values()) {
      s.releaseAll && s.releaseAll()
    }
    if (this.onTick) this.onTick(0)
  }
}

module.exports = { Playback, INSTRUMENTS, INSTRUMENT_NAMES, midiToNoteName }
