// Spoken coaching. Hands are full and eyes are on the box during a lift, so the
// feedback that matters has to be heard. Never throws: speech is a bonus, not a dependency.
const KEY = 'liftsafe.voice';

export function voiceOn() {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function setVoice(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* storage blocked: stays on for this page */ }
  if (!on) stopSpeaking();
}

export function stopSpeaking() {
  try { window.speechSynthesis?.cancel(); } catch { /* no speech on this device */ }
}

// Says `text`, replacing whatever was being said: stale coaching is worse than none.
export function speak(text) {
  if (!voiceOn() || !text) return;
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    synth.speak(u);
  } catch { /* no speech on this device */ }
}
