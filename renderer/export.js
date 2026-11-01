// MIDI (via @tonejs/midi) and MusicXML export.

const { Midi } = require('@tonejs/midi')
const { renderMusicXML } = require('./score')

const GM_PROGRAMS = {
  'Piano': 0,
  'Electric Piano': 4,
  'Guitar': 24,
  'Bass': 33,
  'Strings': 48,
  'Pad': 88,
  'Lead Synth': 80,
  'Flute': 73,
  'Brass': 61,
  'Choir': 52
}

function exportMidi (project) {
  const midi = new Midi()
  midi.header.setTempo(project.tempo)
  midi.header.timeSignatures.push({
    ticks: 0,
    timeSignature: [project.beatsPerBar, project.unit]
  })
  for (const track of project.tracks) {
    const t = midi.addTrack()
    t.name = track.name
    t.channel = project.tracks.indexOf(track) % 16
    t.instrument.number = GM_PROGRAMS[track.instrument] ?? 0
    for (const n of track.notes) {
      t.addNote({
        midi: n.pitch,
        time: n.startSec,
        duration: n.durationSec,
        velocity: Math.max(0, Math.min(1, (n.velocity ?? 96) / 127))
      })
    }
  }
  return midi.toArray() // Uint8Array
}

function exportMusicXML (project, { clef = 'treble', keySig = 'C', trackIndex = 0 } = {}) {
  return renderMusicXML(project, { clef, keySig, trackIndex })
}

module.exports = { exportMidi, exportMusicXML, GM_PROGRAMS }
