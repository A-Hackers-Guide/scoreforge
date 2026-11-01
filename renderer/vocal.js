// Center-channel vocal reduction / isolation (classic karaoke subtraction).
// Works when the vocal is mixed to center. Mono input: returns unchanged.
// Honest: this is not AI source separation. It will fail or sound thin on
// modern wide-stereo mixes, and will suck in anything else panned center
// (kick, snare, bass).

function reduceVocal (audioBuffer) {
  if (audioBuffer.numberOfChannels < 2) return audioBuffer
  const L = audioBuffer.getChannelData(0)
  const R = audioBuffer.getChannelData(1)
  const n = audioBuffer.length
  const out = new AudioBuffer({
    length: n,
    numberOfChannels: 2,
    sampleRate: audioBuffer.sampleRate
  })
  const oL = out.getChannelData(0)
  const oR = out.getChannelData(1)
  for (let i = 0; i < n; i++) {
    oL[i] = L[i] - R[i]
    oR[i] = R[i] - L[i]
  }
  return out
}

function isolateCenter (audioBuffer) {
  if (audioBuffer.numberOfChannels < 2) return audioBuffer
  const L = audioBuffer.getChannelData(0)
  const R = audioBuffer.getChannelData(1)
  const n = audioBuffer.length
  const out = new AudioBuffer({
    length: n,
    numberOfChannels: 2,
    sampleRate: audioBuffer.sampleRate
  })
  const oL = out.getChannelData(0)
  const oR = out.getChannelData(1)
  // (L + R) - |L - R| emphasizes the shared (center) content.
  for (let i = 0; i < n; i++) {
    const sum = (L[i] + R[i]) * 0.5
    const diff = Math.abs(L[i] - R[i])
    const v = sum - diff * Math.sign(sum)
    oL[i] = v
    oR[i] = v
  }
  return out
}

module.exports = { reduceVocal, isolateCenter }
