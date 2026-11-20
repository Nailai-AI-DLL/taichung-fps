// Web Audio procedural sound synthesizer + persisted user settings (sensitivity, volume, mute).

const SETTINGS_KEY = 'lastblock_settings';
const rand = Math.random;

export const CFG = { sens: 1, vol: 0.45, mute: false };
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  if (typeof saved.sens === 'number' && saved.sens >= 0.2 && saved.sens <= 2.5) CFG.sens = saved.sens;
  if (typeof saved.vol === 'number' && saved.vol >= 0 && saved.vol <= 1) CFG.vol = saved.vol;
  if (typeof saved.mute === 'boolean') CFG.mute = saved.mute;
} catch {}

let AC = null, master = null, noiseBuf = null;

export function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(CFG)); } catch {}
}

export function applyAudioGain() {
  if (master) master.gain.value = CFG.mute ? 0 : CFG.vol;
}

export function syncSettingsUI() {
  for (const el of document.querySelectorAll('[data-setting="sens"]')) el.value = String(CFG.sens);
  for (const el of document.querySelectorAll('[data-out="sens"]')) el.textContent = CFG.sens.toFixed(1) + '×';
  for (const el of document.querySelectorAll('[data-setting="vol"]')) el.value = String(Math.round(CFG.vol * 100));
  for (const el of document.querySelectorAll('[data-setting="mute"]')) {
    el.textContent = CFG.mute ? 'MUTED' : 'MUTE';
    el.classList.toggle('on', CFG.mute);
  }
}

export function bindSettingsUI() {
  for (const el of document.querySelectorAll('[data-setting="sens"]')) {
    el.addEventListener('input', (e) => { CFG.sens = +e.target.value; syncSettingsUI(); saveSettings(); });
  }
  for (const el of document.querySelectorAll('[data-setting="vol"]')) {
    el.addEventListener('input', (e) => {
      CFG.vol = +e.target.value / 100;
      if (CFG.vol > 0 && CFG.mute) CFG.mute = false;
      applyAudioGain(); syncSettingsUI(); saveSettings();
    });
  }
  for (const el of document.querySelectorAll('[data-setting="mute"]')) {
    el.addEventListener('click', () => { CFG.mute = !CFG.mute; applyAudioGain(); syncSettingsUI(); saveSettings(); });
  }
  syncSettingsUI();
}

export function initAudio() {
  if (AC) { AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); applyAudioGain(); master.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
  } catch { AC = null; }
}

function noise(vol, dur, freq, type = 'lowpass') {
  if (!AC || vol < 0.005) return;
  const s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain(), t = AC.currentTime;
  s.buffer = noiseBuf; s.playbackRate.value = 0.7 + rand() * 0.6; f.type = type; f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(master); s.start(t, rand() * 0.5, dur + 0.02);
}

function tone(f0, f1, dur, vol, type = 'sine') {
  if (!AC) return;
  const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime;
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}

export const sfx = {
  rifle() { noise(0.55, 0.13, 3200); tone(160, 50, 0.09, 0.4, 'square'); },
  pistol() { noise(0.45, 0.09, 4500); tone(240, 70, 0.06, 0.3, 'square'); },
  sniper() { noise(0.85, 0.4, 1700); tone(130, 34, 0.28, 0.6, 'square'); },
  magnum() { noise(0.7, 0.2, 2600); tone(190, 45, 0.14, 0.5, 'square'); },
  enemy(d) { const v = 0.35 / (1 + d / 18); noise(v, 0.12, 1700); },
  boom(d = 0) { const v = 1 / (1 + d / 30); noise(0.9 * v, 1.0, 600); tone(90, 28, 0.6, 0.8 * v); },
  hit() { tone(1700, 1500, 0.035, 0.18, 'square'); },
  head() { tone(2500, 1900, 0.07, 0.22, 'square'); },
  kill() { tone(700, 1050, 0.1, 0.16, 'triangle'); },
  empty() { tone(900, 800, 0.03, 0.12, 'square'); },
  reload() { noise(0.2, 0.04, 2500, 'highpass'); setTimeout(() => noise(0.25, 0.05, 1800, 'highpass'), 380); },
  hurt() { tone(130, 60, 0.16, 0.5); noise(0.2, 0.1, 500); },
  pick() { tone(620, 930, 0.12, 0.2, 'triangle'); },
  radio() { tone(1250, 1250, 0.06, 0.07, 'square'); setTimeout(() => tone(1650, 1650, 0.06, 0.07, 'square'), 90); },
  drone(d) { tone(210, 190, 0.12, 0.1 / (1 + d / 10), 'sawtooth'); },
};
