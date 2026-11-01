// Canvas-based piano-roll editor.
// Model: project.tracks[i].notes = [{ pitch, startSec, durationSec, velocity }]
// Tool: 'select' | 'draw' | 'erase'

const KEY_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']

function midiName (n) {
  const name = KEY_NAMES[n % 12]
  const oct = Math.floor(n / 12) - 1
  return name + oct
}

function isBlackKey (n) {
  return [1,3,6,8,10].includes(n % 12)
}

class PianoRoll {
  constructor (canvas, project, options = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.project = project
    this.pxPerSec = options.pxPerSec || 120
    this.rowH = options.rowH || 14
    this.minPitch = 24   // C1
    this.maxPitch = 108  // C8
    this.tool = 'select'
    this.snap = 0.125    // sec; project will multiply by beat length for sensible snapping
    this.selection = new Set()
    this.scrollX = 0
    this.scrollY = (this.maxPitch - 72) * this.rowH // start near C4
    this.playhead = 0

    this._drag = null
    this._pointerMoved = false

    this._attach()
    this.resize()
  }

  rows () { return this.maxPitch - this.minPitch + 1 }
  pitchToY (p) { return (this.maxPitch - p) * this.rowH - this.scrollY }
  yToPitch (y) { return this.maxPitch - Math.floor((y + this.scrollY) / this.rowH) }
  timeToX (t) { return t * this.pxPerSec - this.scrollX + this._keyboardWidth() }
  xToTime (x) { return (x - this._keyboardWidth() + this.scrollX) / this.pxPerSec }
  _keyboardWidth () { return 56 }

  setTool (t) { this.tool = t }
  setZoom (px) { this.pxPerSec = px; this.render() }

  resize () {
    const r = this.canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    this.canvas.width = Math.max(300, Math.floor(r.width * dpr))
    this.canvas.height = Math.max(200, Math.floor(r.height * dpr))
    this.canvas.style.width = r.width + 'px'
    this.canvas.style.height = r.height + 'px'
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.render()
  }

  _attach () {
    const c = this.canvas
    c.addEventListener('wheel', e => {
      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY < 0 ? 1.1 : 0.9
        this.pxPerSec = Math.max(20, Math.min(800, this.pxPerSec * factor))
        e.preventDefault()
      } else if (e.shiftKey) {
        this.scrollX = Math.max(0, this.scrollX + e.deltaY)
      } else {
        this.scrollY = Math.max(0, Math.min(this.rows() * this.rowH - c.clientHeight + 20, this.scrollY + e.deltaY))
      }
      this.render()
    }, { passive: false })
    c.addEventListener('pointerdown', e => this._onDown(e))
    c.addEventListener('pointermove', e => this._onMove(e))
    c.addEventListener('pointerup', e => this._onUp(e))
    c.addEventListener('pointerleave', e => this._onUp(e))
    window.addEventListener('keydown', e => this._onKey(e))
    window.addEventListener('resize', () => this.resize())
  }

  _hitNote (x, y) {
    const track = this.project.activeTrack()
    if (!track) return null
    for (let i = track.notes.length - 1; i >= 0; i--) {
      const n = track.notes[i]
      const nx = this.timeToX(n.startSec)
      const nw = n.durationSec * this.pxPerSec
      const ny = this.pitchToY(n.pitch)
      if (x >= nx && x <= nx + nw && y >= ny && y <= ny + this.rowH) {
        const edge = Math.abs(x - (nx + nw)) < 5 ? 'right' : (Math.abs(x - nx) < 5 ? 'left' : 'body')
        return { note: n, index: i, edge }
      }
    }
    return null
  }

  _snapTime (t) {
    if (!this.snap || this.snap <= 0) return Math.max(0, t)
    const secPerBeat = 60 / this.project.tempo
    const snapSec = this.snap * secPerBeat * 4 // snap is in whole-notes
    return Math.max(0, Math.round(t / snapSec) * snapSec)
  }

  _onDown (e) {
    const r = this.canvas.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    this._pointerMoved = false
    if (x < this._keyboardWidth()) return
    const hit = this._hitNote(x, y)
    if (this.tool === 'erase') {
      if (hit) {
        this.project.activeTrack().notes.splice(hit.index, 1)
        this.project.touch()
        this.render()
      }
      return
    }
    if (this.tool === 'draw') {
      if (hit) {
        this._drag = { kind: 'move', note: hit.note, offsetX: x - this.timeToX(hit.note.startSec), startPitch: this.yToPitch(y), origStart: hit.note.startSec, origPitch: hit.note.pitch }
      } else {
        const start = this._snapTime(this.xToTime(x))
        const pitch = this.yToPitch(y)
        if (pitch < this.minPitch || pitch > this.maxPitch) return
        const secPerBeat = 60 / this.project.tempo
        const beat = secPerBeat
        const n = { pitch, startSec: start, durationSec: beat / 2, velocity: 96 }
        this.project.activeTrack().notes.push(n)
        this._drag = { kind: 'resize-right', note: n, origDur: n.durationSec, origStart: n.startSec }
        this.project.touch()
      }
    } else { // select
      if (hit) {
        if (!this.selection.has(hit.note)) {
          if (!e.shiftKey) this.selection.clear()
          this.selection.add(hit.note)
        }
        if (hit.edge === 'right') {
          this._drag = { kind: 'resize-right', note: hit.note, origDur: hit.note.durationSec }
        } else if (hit.edge === 'left') {
          this._drag = { kind: 'resize-left', note: hit.note, origStart: hit.note.startSec, origDur: hit.note.durationSec }
        } else {
          this._drag = { kind: 'move', note: hit.note, offsetX: x - this.timeToX(hit.note.startSec), origStart: hit.note.startSec, origPitch: hit.note.pitch }
        }
      } else {
        if (!e.shiftKey) this.selection.clear()
        this._drag = { kind: 'marquee', x0: x, y0: y, x1: x, y1: y }
      }
    }
    this.render()
  }

  _onMove (e) {
    if (!this._drag) {
      // live cursor; cheap
      return
    }
    const r = this.canvas.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    this._pointerMoved = true
    const d = this._drag
    if (d.kind === 'move') {
      const newStart = this._snapTime(this.xToTime(x - d.offsetX))
      const newPitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.yToPitch(y)))
      d.note.startSec = newStart
      d.note.pitch = newPitch
      this.project.touch()
    } else if (d.kind === 'resize-right') {
      const end = this._snapTime(this.xToTime(x))
      d.note.durationSec = Math.max(0.03, end - d.note.startSec)
      this.project.touch()
    } else if (d.kind === 'resize-left') {
      const newStart = this._snapTime(this.xToTime(x))
      const endSec = d.origStart + d.origDur
      d.note.startSec = Math.min(newStart, endSec - 0.03)
      d.note.durationSec = endSec - d.note.startSec
      this.project.touch()
    } else if (d.kind === 'marquee') {
      d.x1 = x; d.y1 = y
    }
    this.render()
  }

  _onUp (e) {
    if (this._drag && this._drag.kind === 'marquee' && this._pointerMoved) {
      const d = this._drag
      const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1)
      const y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1)
      const track = this.project.activeTrack()
      if (track) {
        for (const n of track.notes) {
          const nx = this.timeToX(n.startSec)
          const nw = n.durationSec * this.pxPerSec
          const ny = this.pitchToY(n.pitch)
          if (nx + nw >= x0 && nx <= x1 && ny + this.rowH >= y0 && ny <= y1) {
            this.selection.add(n)
          }
        }
      }
    }
    this._drag = null
    this.render()
  }

  _onKey (e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return
    const track = this.project.activeTrack()
    if (!track) return
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.selection.size) {
        track.notes = track.notes.filter(n => !this.selection.has(n))
        this.selection.clear()
        this.project.touch()
        this.render()
        e.preventDefault()
      }
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const delta = e.key === 'ArrowUp' ? 1 : -1
      const amount = e.shiftKey ? 12 : 1
      for (const n of this.selection) {
        n.pitch = Math.max(this.minPitch, Math.min(this.maxPitch, n.pitch + delta * amount))
      }
      this.project.touch()
      this.render()
      e.preventDefault()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const secPerBeat = 60 / this.project.tempo
      const step = (this.snap || 0.125) * secPerBeat * 4
      const delta = e.key === 'ArrowRight' ? step : -step
      for (const n of this.selection) {
        n.startSec = Math.max(0, n.startSec + delta)
      }
      this.project.touch()
      this.render()
      e.preventDefault()
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      for (const n of track.notes) this.selection.add(n)
      this.render()
      e.preventDefault()
    }
  }

  setPlayhead (t) {
    this.playhead = t
    this.render()
  }

  render () {
    const ctx = this.ctx
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    ctx.fillStyle = '#171b21'
    ctx.fillRect(0, 0, w, h)

    const kw = this._keyboardWidth()

    // Row backgrounds (black-key tint)
    for (let p = this.minPitch; p <= this.maxPitch; p++) {
      const y = this.pitchToY(p)
      if (y + this.rowH < 0 || y > h) continue
      ctx.fillStyle = isBlackKey(p) ? '#1b212a' : '#1f252d'
      ctx.fillRect(kw, y, w - kw, this.rowH)
      if ((p % 12) === 0) {
        ctx.fillStyle = '#262d38'
        ctx.fillRect(kw, y, w - kw, this.rowH)
      }
    }

    // Beat grid
    const secPerBeat = 60 / this.project.tempo
    const beatsPerBar = this.project.beatsPerBar
    const beatPx = secPerBeat * this.pxPerSec
    const firstBeatSec = Math.floor(this.scrollX / beatPx) * secPerBeat
    for (let t = firstBeatSec; t * this.pxPerSec - this.scrollX < w; t += secPerBeat) {
      const x = this.timeToX(t)
      if (x < kw) continue
      const beatIdx = Math.round(t / secPerBeat)
      ctx.strokeStyle = (beatIdx % beatsPerBar === 0) ? '#3a4150' : '#262d38'
      ctx.lineWidth = (beatIdx % beatsPerBar === 0) ? 1.5 : 1
      ctx.beginPath()
      ctx.moveTo(x + 0.5, 0)
      ctx.lineTo(x + 0.5, h)
      ctx.stroke()
    }

    // Keyboard
    ctx.fillStyle = '#101317'
    ctx.fillRect(0, 0, kw, h)
    for (let p = this.minPitch; p <= this.maxPitch; p++) {
      const y = this.pitchToY(p)
      if (y + this.rowH < 0 || y > h) continue
      ctx.fillStyle = isBlackKey(p) ? '#2a313b' : '#e6e9ef'
      ctx.fillRect(0, y + 1, kw - 2, this.rowH - 2)
      if ((p % 12) === 0) {
        ctx.fillStyle = isBlackKey(p) ? '#e6e9ef' : '#101317'
        ctx.font = '10px system-ui'
        ctx.fillText(midiName(p), 4, y + this.rowH - 3)
      }
    }

    // Notes
    const active = this.project.activeTrack()
    for (const track of this.project.tracks) {
      const dim = track !== active
      for (const n of track.notes) {
        const nx = this.timeToX(n.startSec)
        const nw = Math.max(2, n.durationSec * this.pxPerSec)
        const ny = this.pitchToY(n.pitch)
        if (nx + nw < kw || nx > w || ny + this.rowH < 0 || ny > h) continue
        const sel = this.selection.has(n)
        ctx.fillStyle = sel ? '#4ea1ff' : (dim ? track.color + '80' : track.color)
        ctx.fillRect(nx, ny + 1, nw, this.rowH - 2)
        ctx.strokeStyle = sel ? '#ffffff' : 'rgba(0,0,0,0.35)'
        ctx.lineWidth = sel ? 1.5 : 1
        ctx.strokeRect(nx + 0.5, ny + 1.5, nw - 1, this.rowH - 3)
      }
    }

    // Playhead
    if (this.playhead > 0) {
      const px = this.timeToX(this.playhead)
      if (px >= kw) {
        ctx.strokeStyle = '#2bd4a0'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(px, 0); ctx.lineTo(px, h)
        ctx.stroke()
      }
    }

    // Marquee
    if (this._drag && this._drag.kind === 'marquee') {
      const d = this._drag
      const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1)
      const ww = Math.abs(d.x1 - d.x0), hh = Math.abs(d.y1 - d.y0)
      ctx.fillStyle = 'rgba(78,161,255,0.15)'
      ctx.fillRect(x, y, ww, hh)
      ctx.strokeStyle = '#4ea1ff'
      ctx.strokeRect(x + 0.5, y + 0.5, ww, hh)
    }
  }
}

module.exports = { PianoRoll, midiName }
