// Main renderer entry. Wires the UI to the engine modules.

const { ipcRenderer } = require('electron')
const fs = require('fs')
const path = require('path')

const { transcribe } = require('./renderer/transcribe')
const { reduceVocal, isolateCenter } = require('./renderer/vocal')
const { PianoRoll } = require('./renderer/pianoroll')
const { renderScore } = require('./renderer/score')
const { Playback, INSTRUMENT_NAMES } = require('./renderer/playback')
const { exportMidi, exportMusicXML } = require('./renderer/export')

const COLORS = ['#4ea1ff', '#2bd4a0', '#ffb84d', '#ff6b6b', '#b084ff', '#ff87c5', '#79e8ff', '#ffd166']

const project = {
  tempo: 120,
  beatsPerBar: 4,
  unit: 4,
  tracks: [],
  activeTrackIndex: 0,
  audioBuffer: null,
  audioFileName: null,
  _nextTrackId: 1,
  activeTrack () { return this.tracks[this.activeTrackIndex] || null },
  addTrack (name = null, instrument = 'Piano', notes = []) {
    const id = this._nextTrackId++
    const t = {
      id,
      name: name || `Track ${this.tracks.length + 1}`,
      instrument,
      notes,
      muted: false,
      color: COLORS[(this.tracks.length) % COLORS.length]
    }
    this.tracks.push(t)
    this.activeTrackIndex = this.tracks.length - 1
    return t
  },
  removeTrack (idx = this.activeTrackIndex) {
    if (idx < 0 || idx >= this.tracks.length) return
    this.tracks.splice(idx, 1)
    this.activeTrackIndex = Math.max(0, Math.min(this.activeTrackIndex, this.tracks.length - 1))
  },
  durationSec () {
    let m = 0
    for (const t of this.tracks)
      for (const n of t.notes)
        m = Math.max(m, n.startSec + n.durationSec)
    return Math.max(m, this.audioBuffer ? this.audioBuffer.duration : 0)
  },
  touch () { /* used by piano roll to notify of edits; UI reads live */ }
}

const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
const playback = new Playback()

const el = {
  btnOpen: document.getElementById('btn-open'),
  fileName: document.getElementById('file-name'),
  btnTranscribe: document.getElementById('btn-transcribe'),
  status: document.getElementById('status'),
  inTempo: document.getElementById('in-tempo'),
  inBeats: document.getElementById('in-beats'),
  inUnit: document.getElementById('in-unit'),
  inAlgo: document.getElementById('in-algo'),
  inVocal: document.getElementById('in-vocal'),
  inVocalOnly: document.getElementById('in-vocal-only'),
  rollTool: document.getElementById('roll-tool'),
  rollInstr: document.getElementById('roll-instrument'),
  rollSnap: document.getElementById('roll-snap'),
  rollZoom: document.getElementById('roll-zoom'),
  btnAddTrack: document.getElementById('btn-add-track'),
  btnDelTrack: document.getElementById('btn-del-track'),
  tracksList: document.getElementById('tracks-list'),
  rollCanvas: document.getElementById('roll-canvas'),
  scoreTrack: document.getElementById('score-track'),
  scoreClef: document.getElementById('score-clef'),
  scoreKey: document.getElementById('score-key'),
  btnRerender: document.getElementById('btn-rerender'),
  scoreArea: document.getElementById('score-area'),
  btnPlay: document.getElementById('btn-play'),
  btnStop: document.getElementById('btn-stop'),
  pos: document.getElementById('pos'),
  posSlider: document.getElementById('pos-slider'),
  vol: document.getElementById('vol'),
  btnExportMidi: document.getElementById('btn-export-midi'),
  btnExportMusicxml: document.getElementById('btn-export-musicxml'),
  btnExportPdf: document.getElementById('btn-export-pdf'),
  tabs: document.querySelectorAll('.tab'),
  panels: document.querySelectorAll('.tab-panel'),
  readmeBody: document.getElementById('readme-body')
}

// Populate instrument select
for (const name of INSTRUMENT_NAMES) {
  const o = document.createElement('option'); o.value = o.textContent = name; el.rollInstr.appendChild(o)
}

// Seed a default track so the editor is usable before transcription.
project.addTrack('Melody', 'Piano')

const roll = new PianoRoll(el.rollCanvas, project, { pxPerSec: 120 })
roll.render()

playback.onTick = (t) => {
  roll.setPlayhead(t)
  const dur = project.durationSec()
  el.pos.textContent = `${t.toFixed(2)} / ${dur.toFixed(2)}s`
  if (dur > 0) el.posSlider.value = String((t / dur) * 100)
}

function setStatus (msg) { el.status.textContent = msg || '' }

function refreshTracksUI () {
  el.tracksList.innerHTML = ''
  for (let i = 0; i < project.tracks.length; i++) {
    const t = project.tracks[i]
    const chip = document.createElement('button')
    chip.className = 'track-chip' + (i === project.activeTrackIndex ? ' active' : '')
    chip.style.borderColor = t.color
    chip.textContent = `${t.name} · ${t.instrument}`
    chip.addEventListener('click', () => {
      project.activeTrackIndex = i
      el.rollInstr.value = t.instrument
      refreshTracksUI()
      roll.render()
    })
    el.tracksList.appendChild(chip)
  }
  // sync instrument select to active track
  const a = project.activeTrack()
  if (a) el.rollInstr.value = a.instrument
  // score-track select
  el.scoreTrack.innerHTML = ''
  project.tracks.forEach((t, i) => {
    const o = document.createElement('option'); o.value = String(i); o.textContent = t.name; el.scoreTrack.appendChild(o)
  })
  el.scoreTrack.value = String(project.activeTrackIndex)
}
refreshTracksUI()

// Open audio
el.btnOpen.addEventListener('click', async () => {
  const file = await ipcRenderer.invoke('open-audio')
  if (!file) return
  el.fileName.textContent = file.name
  setStatus('Decoding audio…')
  try {
    project.audioBuffer = await audioCtx.decodeAudioData(file.buffer.slice(0))
    project.audioFileName = file.name
    el.btnTranscribe.disabled = false
    setStatus(`Loaded ${file.name} (${project.audioBuffer.duration.toFixed(1)}s, ${project.audioBuffer.sampleRate} Hz, ${project.audioBuffer.numberOfChannels}ch)`)
  } catch (e) {
    setStatus('Decode failed: ' + e.message)
  }
})

// Transcribe
el.btnTranscribe.addEventListener('click', async () => {
  if (!project.audioBuffer) return
  project.tempo = +el.inTempo.value || 120
  project.beatsPerBar = +el.inBeats.value || 4
  project.unit = +el.inUnit.value || 4

  let buf = project.audioBuffer
  if (el.inVocalOnly.checked) {
    setStatus('Isolating center channel…')
    buf = isolateCenter(buf)
  } else if (el.inVocal.checked) {
    setStatus('Reducing vocals…')
    buf = reduceVocal(buf)
  }

  el.btnTranscribe.disabled = true
  const algorithm = el.inAlgo.value
  setStatus('Transcribing (0%)…')
  const { notes } = await transcribe(buf, {
    algorithm,
    tempo: project.tempo,
    onProgress: p => { setStatus(`Transcribing (${Math.round(p * 100)}%)…`) }
  })
  const name = 'Melody (auto)'
  // Replace active track if it is empty, else add
  let target = project.activeTrack()
  if (!target || target.notes.length) {
    target = project.addTrack(name, 'Piano', notes)
  } else {
    target.name = name
    target.notes = notes
  }
  el.btnTranscribe.disabled = false
  setStatus(`Transcribed ${notes.length} notes. Edit freely in the piano roll.`)
  refreshTracksUI()
  roll.render()
})

// Tempo/time-sig changes
el.inTempo.addEventListener('change', () => { project.tempo = +el.inTempo.value || 120; roll.render() })
el.inBeats.addEventListener('change', () => { project.beatsPerBar = +el.inBeats.value || 4; roll.render() })
el.inUnit.addEventListener('change', () => { project.unit = +el.inUnit.value || 4 })

// Tool
el.rollTool.addEventListener('change', () => roll.setTool(el.rollTool.value))
el.rollSnap.addEventListener('change', () => { roll.snap = +el.rollSnap.value })
el.rollZoom.addEventListener('input', () => roll.setZoom(+el.rollZoom.value))

// Instrument swap on active track
el.rollInstr.addEventListener('change', () => {
  const t = project.activeTrack(); if (!t) return
  t.instrument = el.rollInstr.value
  refreshTracksUI()
})

el.btnAddTrack.addEventListener('click', () => { project.addTrack(); refreshTracksUI(); roll.render() })
el.btnDelTrack.addEventListener('click', () => {
  if (project.tracks.length <= 1) return
  project.removeTrack(); refreshTracksUI(); roll.render()
})

// Tabs
el.tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    el.tabs.forEach(t => t.classList.remove('active'))
    el.panels.forEach(p => p.classList.remove('active'))
    tab.classList.add('active')
    const name = tab.dataset.tab
    document.querySelector(`.tab-panel[data-panel="${name}"]`).classList.add('active')
    if (name === 'roll') roll.resize()
    if (name === 'score') rerenderScore()
    if (name === 'info') loadReadme()
  })
})

function rerenderScore () {
  const idx = +el.scoreTrack.value || 0
  const t = project.tracks[idx]
  if (!t) return
  renderScore(el.scoreArea, t, project, { clef: el.scoreClef.value, keySig: el.scoreKey.value })
}
el.btnRerender.addEventListener('click', rerenderScore)
el.scoreTrack.addEventListener('change', rerenderScore)
el.scoreClef.addEventListener('change', rerenderScore)
el.scoreKey.addEventListener('change', rerenderScore)

// Transport
el.btnPlay.addEventListener('click', async () => {
  const from = (project.durationSec() * (+el.posSlider.value / 100)) || 0
  await playback.play(project, from < project.durationSec() ? from : 0)
})
el.btnStop.addEventListener('click', () => playback.stop())
el.vol.addEventListener('input', () => playback.setVolume(+el.vol.value))
el.posSlider.addEventListener('input', () => {
  const t = project.durationSec() * (+el.posSlider.value / 100)
  roll.setPlayhead(t)
  el.pos.textContent = `${t.toFixed(2)} / ${project.durationSec().toFixed(2)}s`
})

// Export
el.btnExportMidi.addEventListener('click', async () => {
  const data = exportMidi(project) // Uint8Array
  await ipcRenderer.invoke('save-file', {
    defaultName: (project.audioFileName || 'score').replace(/\.[^.]+$/, '') + '.mid',
    filters: [{ name: 'MIDI', extensions: ['mid', 'midi'] }],
    data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  })
})
el.btnExportMusicxml.addEventListener('click', async () => {
  const idx = +el.scoreTrack.value || 0
  const xml = exportMusicXML(project, { clef: el.scoreClef.value, keySig: el.scoreKey.value, trackIndex: idx })
  await ipcRenderer.invoke('save-file', {
    defaultName: (project.audioFileName || 'score').replace(/\.[^.]+$/, '') + '.musicxml',
    filters: [{ name: 'MusicXML', extensions: ['musicxml', 'xml'] }],
    data: xml
  })
})
el.btnExportPdf.addEventListener('click', async () => {
  // Switch to the score tab so the printable area is rendered
  document.querySelector('.tab[data-tab="score"]').click()
  await new Promise(r => setTimeout(r, 50))
  rerenderScore()
  await new Promise(r => setTimeout(r, 50))
  await ipcRenderer.invoke('print-pdf')
})

function loadReadme () {
  if (el.readmeBody.dataset.loaded) return
  try {
    const p = path.join(__dirname, 'README.md')
    const text = fs.readFileSync(p, 'utf8')
    el.readmeBody.innerHTML = markdownish(text)
    el.readmeBody.dataset.loaded = '1'
  } catch (e) {
    el.readmeBody.textContent = 'README not found.'
  }
}

function markdownish (s) {
  // Minimal markdown rendering (not a real parser; good enough for the embedded readme).
  const esc = (t) => t.replace(/[&<>]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]))
  const lines = s.split(/\r?\n/)
  let out = ''
  let inCode = false
  for (const raw of lines) {
    if (raw.startsWith('```')) { out += inCode ? '</code></pre>' : '<pre><code>'; inCode = !inCode; continue }
    if (inCode) { out += esc(raw) + '\n'; continue }
    if (raw.startsWith('### ')) { out += `<h3>${esc(raw.slice(4))}</h3>`; continue }
    if (raw.startsWith('## ')) { out += `<h2>${esc(raw.slice(3))}</h2>`; continue }
    if (raw.startsWith('# ')) { out += `<h1>${esc(raw.slice(2))}</h1>`; continue }
    if (/^\s*[-*]\s+/.test(raw)) { out += `<li>${inline(esc(raw.replace(/^\s*[-*]\s+/, '')))}</li>`; continue }
    if (!raw.trim()) { out += '<br/>'; continue }
    out += `<p>${inline(esc(raw))}</p>`
  }
  return out.replace(/(<li>.*?<\/li>)+/gs, m => '<ul>' + m + '</ul>')
  function inline (t) {
    return t
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
  }
}

// Resize handling for canvas
window.addEventListener('resize', () => roll.resize())
setTimeout(() => roll.resize(), 50)
