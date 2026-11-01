// Sheet-music rendering via VexFlow.
// Quantizes a track's notes into measures based on tempo + time signature,
// then renders staff by staff.

const Vex = require('vexflow')
const { Factory, Formatter, Stave, StaveNote, Voice, Accidental, Barline } = Vex.Flow

const DUR_TABLE = [
  { beats: 4,    key: 'w'  },
  { beats: 3,    key: 'hd' },
  { beats: 2,    key: 'h'  },
  { beats: 1.5,  key: 'qd' },
  { beats: 1,    key: 'q'  },
  { beats: 0.75, key: '8d' },
  { beats: 0.5,  key: '8'  },
  { beats: 0.25, key: '16' },
  { beats: 0.125,key: '32' }
]

const PITCH_NAMES = ['c','c#','d','d#','e','f','f#','g','g#','a','a#','b']

function midiToVf (midi, keySig) {
  const flatMap = { 'c#':'db', 'd#':'eb', 'f#':'gb', 'g#':'ab', 'a#':'bb' }
  const useFlats = /b$|^F$/.test(keySig)
  const name = PITCH_NAMES[midi % 12]
  const octave = Math.floor(midi / 12) - 1
  let n = name
  let acc = null
  if (n.includes('#')) {
    if (useFlats) n = flatMap[n]
    acc = n.includes('b') ? 'b' : '#'
  }
  const letter = n[0]
  const key = letter + (acc ? acc : '') + '/' + octave
  return { key, accidental: acc }
}

function pickDurations (beatsRemaining, availableBeats) {
  // Greedy fit of standard durations to beatsRemaining, capped at availableBeats.
  const b = Math.min(beatsRemaining, availableBeats)
  const out = []
  let left = b
  for (const d of DUR_TABLE) {
    while (left >= d.beats - 1e-6) {
      out.push(d.key)
      left -= d.beats
    }
  }
  if (!out.length) return ['32']
  return out
}

function quantizeNotesToMeasures (notes, tempo, beatsPerBar, unit) {
  // Convert note startSec/durationSec to beats.
  const secPerBeat = 60 / tempo
  const quantUnit = Math.min(0.25, 1 / Math.max(1, unit)) // beats
  const events = notes
    .map(n => ({
      pitch: n.pitch,
      startBeat: Math.round(n.startSec / secPerBeat / quantUnit) * quantUnit,
      durBeat: Math.max(quantUnit, Math.round(n.durationSec / secPerBeat / quantUnit) * quantUnit)
    }))
    .sort((a, b) => a.startBeat - b.startBeat || b.pitch - a.pitch)

  // Build monophonic timeline with rests inserted.
  // Simple approach: iterate in increments of quantUnit; the next note after a gap becomes the next event.
  const timeline = []
  let cursor = 0
  for (const e of events) {
    if (e.startBeat > cursor + 1e-6) {
      timeline.push({ rest: true, startBeat: cursor, durBeat: e.startBeat - cursor })
    }
    // if overlapping, truncate previous
    if (timeline.length && !timeline[timeline.length - 1].rest) {
      const prev = timeline[timeline.length - 1]
      const prevEnd = prev.startBeat + prev.durBeat
      if (prevEnd > e.startBeat) prev.durBeat = e.startBeat - prev.startBeat
    }
    timeline.push({ rest: false, pitch: e.pitch, startBeat: e.startBeat, durBeat: e.durBeat })
    cursor = e.startBeat + e.durBeat
  }

  // Split timeline into measures of beatsPerBar beats.
  const measures = []
  let m = { events: [] }
  let used = 0
  for (const ev of timeline) {
    let remaining = ev.durBeat
    let s = ev.startBeat
    while (remaining > 1e-6) {
      const spaceLeft = beatsPerBar - used
      const take = Math.min(spaceLeft, remaining)
      const durs = pickDurations(take, spaceLeft)
      for (const key of durs) {
        const beatsOfKey = DUR_TABLE.find(d => d.key === key).beats
        m.events.push({ rest: ev.rest, pitch: ev.pitch, durKey: key, beats: beatsOfKey })
      }
      used += take
      remaining -= take
      s += take
      if (used >= beatsPerBar - 1e-6) {
        measures.push(m); m = { events: [] }; used = 0
      }
    }
  }
  if (m.events.length || measures.length === 0) {
    // pad final measure with rest
    const left = beatsPerBar - used
    if (left > 1e-6) {
      for (const key of pickDurations(left, left)) {
        const beats = DUR_TABLE.find(d => d.key === key).beats
        m.events.push({ rest: true, durKey: key, beats })
      }
    }
    measures.push(m)
  }
  return measures
}

function renderScore (container, track, project, { clef = 'treble', keySig = 'C' } = {}) {
  container.innerHTML = ''
  const measures = quantizeNotesToMeasures(track.notes, project.tempo, project.beatsPerBar, project.unit)
  const timeSig = project.beatsPerBar + '/' + project.unit

  const measuresPerLine = 4
  const measureWidth = 240
  const staffHeight = 110
  const lines = Math.ceil(measures.length / measuresPerLine)
  const totalW = measuresPerLine * measureWidth + 60
  const totalH = Math.max(140, lines * staffHeight + 40)

  const renderer = new Vex.Flow.Renderer(container, Vex.Flow.Renderer.Backends.SVG)
  renderer.resize(totalW, totalH)
  const ctx = renderer.getContext()
  ctx.setFont('Arial', 10)

  for (let i = 0; i < measures.length; i++) {
    const line = Math.floor(i / measuresPerLine)
    const col = i % measuresPerLine
    const x = 10 + col * measureWidth
    const y = 20 + line * staffHeight

    const stave = new Stave(x, y, measureWidth)
    if (col === 0) {
      stave.addClef(clef).addKeySignature(keySig)
      if (line === 0) stave.addTimeSignature(timeSig)
    }
    if (col === measuresPerLine - 1 || i === measures.length - 1) {
      stave.setEndBarType(Barline.type.END)
    }
    stave.setContext(ctx).draw()

    const vfNotes = measures[i].events.map(ev => {
      if (ev.rest) {
        return new StaveNote({ keys: ['b/4'], duration: ev.durKey + 'r', clef })
      }
      const { key, accidental } = midiToVf(ev.pitch, keySig)
      const note = new StaveNote({ keys: [key], duration: ev.durKey, clef })
      if (accidental) note.addModifier(new Accidental(accidental), 0)
      return note
    })

    if (!vfNotes.length) continue
    const voice = new Voice({ num_beats: project.beatsPerBar, beat_value: project.unit })
    voice.setStrict(false)
    voice.addTickables(vfNotes)
    new Formatter().joinVoices([voice]).format([voice], measureWidth - 50)
    voice.draw(ctx, stave)
  }

  return { measures: measures.length, container }
}

function renderMusicXML (project, { clef = 'treble', keySig = 'C', trackIndex = 0 } = {}) {
  const track = project.tracks[trackIndex]
  const measures = quantizeNotesToMeasures(track.notes, project.tempo, project.beatsPerBar, project.unit)
  const divisions = 4
  const noteTypeFor = (key) => {
    switch (key.replace('d','').replace('r','')) {
      case 'w': return { type: 'whole', duration: 4 * divisions, dot: key.includes('d') }
      case 'h': return { type: 'half', duration: 2 * divisions, dot: key.includes('d') }
      case 'q': return { type: 'quarter', duration: 1 * divisions, dot: key.includes('d') }
      case '8': return { type: 'eighth', duration: 0.5 * divisions, dot: key.includes('d') }
      case '16': return { type: '16th', duration: 0.25 * divisions, dot: false }
      case '32': return { type: '32nd', duration: 0.125 * divisions, dot: false }
    }
    return { type: 'quarter', duration: divisions, dot: false }
  }
  const pitchXml = (midi) => {
    const names = ['C','C','D','D','E','F','F','G','G','A','A','B']
    const alters = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0]
    const step = names[midi % 12]
    const alter = alters[midi % 12]
    const octave = Math.floor(midi / 12) - 1
    return `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>`
  }
  const fifths = ({ 'C':0,'G':1,'D':2,'A':3,'E':4,'B':5,'F#':6,'F':-1,'Bb':-2,'Eb':-3,'Ab':-4,'Db':-5,'Gb':-6 })[keySig] ?? 0
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>${escapeXml(track.name || 'Voice')}</part-name></score-part>
  </part-list>
  <part id="P1">
`
  measures.forEach((m, idx) => {
    xml += `    <measure number="${idx + 1}">\n`
    if (idx === 0) {
      xml += `      <attributes>
        <divisions>${divisions}</divisions>
        <key><fifths>${fifths}</fifths></key>
        <time><beats>${project.beatsPerBar}</beats><beat-type>${project.unit}</beat-type></time>
        <clef><sign>${clef === 'bass' ? 'F' : (clef === 'alto' || clef === 'tenor' ? 'C' : 'G')}</sign><line>${clef === 'bass' ? 4 : (clef === 'alto' ? 3 : (clef === 'tenor' ? 4 : 2))}</line></clef>
      </attributes>
      <sound tempo="${project.tempo}"/>
`
    }
    for (const ev of m.events) {
      const nt = noteTypeFor(ev.durKey)
      const dur = Math.max(1, Math.round(nt.duration))
      if (ev.rest) {
        xml += `      <note><rest/><duration>${dur}</duration><type>${nt.type}</type>${nt.dot ? '<dot/>' : ''}</note>\n`
      } else {
        xml += `      <note>${pitchXml(ev.pitch)}<duration>${dur}</duration><type>${nt.type}</type>${nt.dot ? '<dot/>' : ''}</note>\n`
      }
    }
    xml += `    </measure>\n`
  })
  xml += `  </part>
</score-partwise>
`
  return xml
}

function escapeXml (s) {
  return String(s).replace(/[<>&'"]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;' }[c]))
}

module.exports = { renderScore, renderMusicXML, quantizeNotesToMeasures }
