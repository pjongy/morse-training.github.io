'use strict';

// ── Morse tables ─────────────────────────────────────────────────────────────
const MORSE = {
  A:'.-',   B:'-...', C:'-.-.', D:'-..', E:'.',    F:'..-.',
  G:'--.',  H:'....', I:'..',   J:'.---',K:'-.-',  L:'.-..',
  M:'--',   N:'-.',   O:'---',  P:'.--.', Q:'--.-', R:'.-.',
  S:'...',  T:'-',    U:'..-',  V:'...-', W:'.--',  X:'-..-',
  Y:'-.--', Z:'--..',
  0:'-----',1:'.----',2:'..---',3:'...--',4:'....-',
  5:'.....',6:'-....',7:'--...',8:'---..',9:'----.'
};
const REVERSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// ── Audio ─────────────────────────────────────────────────────────────────────
let audioCtx     = null;
let liveOsc      = null;
let liveGain     = null;
let playbackAbort = 0;

function ensureCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function startLiveTone() {
  stopLiveTone();
  const ctx = ensureCtx();
  liveGain = ctx.createGain();
  liveOsc  = ctx.createOscillator();
  liveOsc.frequency.value = 700;
  liveOsc.connect(liveGain);
  liveGain.connect(ctx.destination);
  liveGain.gain.setValueAtTime(0, ctx.currentTime);
  liveGain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + 0.008);
  liveOsc.start();
}

function stopLiveTone() {
  if (!liveOsc) return;
  const ctx = ensureCtx();
  liveGain.gain.setValueAtTime(liveGain.gain.value, ctx.currentTime);
  liveGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.012);
  liveOsc.stop(ctx.currentTime + 0.015);
  liveOsc = null; liveGain = null;
}

function playBeep(ms) {
  return new Promise(resolve => {
    const ctx = ensureCtx();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = 700;
    osc.connect(gain); gain.connect(ctx.destination);
    const t = ctx.currentTime, d = ms / 1000;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.4, t + 0.008);
    gain.gain.setValueAtTime(0.4, t + Math.max(d - 0.01, 0.008));
    gain.gain.linearRampToValueAtTime(0, t + d);
    osc.start(t); osc.stop(t + d);
    osc.onended = resolve;
  });
}

async function playMorseRef(code, unitMs, token) {
  for (const sym of code) {
    if (playbackAbort !== token) return;
    await playBeep(sym === '.' ? unitMs : unitMs * 3);
    if (playbackAbort !== token) return;
    await sleep(unitMs);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Adaptive timing detector ──────────────────────────────────────────────────
// Standard: dit=1 unit, dah=3 units. Threshold between them auto-adapts.
class TimingDetector {
  constructor() {
    this.samples   = [];
    this.threshold = 280;   // ms: boundary between dit and dah
    this.unitTime  = 130;   // ms: estimated dit duration
  }

  // Returns 'dit' or 'dah', updates internal model
  classify(ms) {
    const type = ms < this.threshold ? 'dit' : 'dah';
    this.samples.push(ms);
    if (this.samples.length > 30) this.samples.shift();
    this._kmeans();
    return type;
  }

  _kmeans() {
    const s = [...this.samples].sort((a, b) => a - b);
    if (s.length < 2) return;
    let c1 = s[0], c2 = s[s.length - 1];
    for (let i = 0; i < 20; i++) {
      const g1 = [], g2 = [];
      for (const v of s) (Math.abs(v - c1) <= Math.abs(v - c2) ? g1 : g2).push(v);
      if (!g1.length || !g2.length) break;
      const n1 = g1.reduce((a, b) => a + b, 0) / g1.length;
      const n2 = g2.reduce((a, b) => a + b, 0) / g2.length;
      if (Math.abs(n1 - c1) < 0.5 && Math.abs(n2 - c2) < 0.5) { c1 = n1; c2 = n2; break; }
      c1 = n1; c2 = n2;
    }
    if (c1 >= c2) return;
    this.threshold = (c1 + c2) / 2;
    this.unitTime  = c1;
  }

  get gapTimeout() { return Math.max(this.unitTime * 3, 700); }
  get wpm()        { return Math.round(60000 / (50 * this.unitTime)); }
}

// ── Timing panel renderer ─────────────────────────────────────────────────────
// Each entry shows:  [type]  [bar track: ref ghost + actual fill + tick]  [actual s]  [±dev s]
function renderTimingEntry(container, type, actualMs, refMs) {
  // Scale: enough so the larger value reaches ~80% of bar width
  const maxMs = Math.max(actualMs, refMs) * 1.25;
  const actPct = Math.min((actualMs / maxMs) * 100, 100);
  const refPct = Math.min((refMs   / maxMs) * 100, 100);

  const devMs  = actualMs - refMs;
  const devRel = Math.abs(devMs) / refMs; // relative deviation
  const diffClass = devRel < 0.20 ? 'good' : devRel < 0.50 ? 'warn' : 'bad';
  const diffSign  = devMs > 0 ? '+' : '';
  const diffText  = `${diffSign}${(devMs / 1000).toFixed(2)}s`;
  const label     = type === 'dit' ? 'dit' : 'dah';

  const row = document.createElement('div');
  row.className = 'te';
  row.innerHTML = `
    <span class="te-label ${type}">${label}</span>
    <div class="te-track">
      <div class="te-ref-bar ${type}" style="width:${refPct.toFixed(1)}%"></div>
      <div class="te-act-bar ${type}" style="width:${actPct.toFixed(1)}%"></div>
      <div class="te-tick" style="left:${refPct.toFixed(1)}%"></div>
    </div>
    <span class="te-val">${(actualMs / 1000).toFixed(2)}s</span>
    <span class="te-diff ${diffClass}">${diffText}</span>
  `;
  container.appendChild(row);
}

// ── Symbol helpers ────────────────────────────────────────────────────────────
function makeSym(type) {
  const el = document.createElement('span');
  el.className = `sym-${type}`;
  return el;
}

function renderCode(container, code) {
  container.innerHTML = '';
  for (const c of code) container.appendChild(makeSym(c === '.' ? 'dit' : 'dah'));
}

// ── State ─────────────────────────────────────────────────────────────────────
const detector = new TimingDetector();

let currentLetter = '';
let currentCode   = '';
let userInput     = [];   // { type: 'dit'|'dah', ms: number }[]
let pressStart    = 0;
let gapTimer      = null;
let gameState     = 'idle';
let refWpm        = 15;
let score         = { correct: 0, total: 0 };
let streak        = 0;
let audioReady    = false;   // AudioContext needs user gesture first

const refUnitMs = () => Math.round(60000 / (50 * refWpm));

// ── DOM ───────────────────────────────────────────────────────────────────────
const learnView    = document.getElementById('learn-view');
const letterEl     = document.getElementById('current-letter');
const targetMorse  = document.getElementById('target-morse');
const userCard     = document.getElementById('user-card');
const userDecoded  = document.getElementById('user-decoded');
const userMorse    = document.getElementById('user-morse');
const feedbackEl   = document.getElementById('feedback-banner');
const pressArea    = document.getElementById('press-area');
const pressHint    = document.getElementById('press-hint');
const replayBtn    = document.getElementById('replay-btn');
const scoreText    = document.getElementById('score-text');
const streakText   = document.getElementById('streak-text');
const speedDisplay = document.getElementById('speed-display');
const timingEntries= document.getElementById('timing-entries');

// ── Playback ──────────────────────────────────────────────────────────────────
async function playCurrentCode() {
  playbackAbort++;
  const token = playbackAbort;
  replayBtn.disabled = true;
  await playMorseRef(currentCode, refUnitMs(), token);
  if (playbackAbort === token) replayBtn.disabled = false;
}

// ── User card update ──────────────────────────────────────────────────────────
function updateUserCard() {
  const code    = userInput.map(e => e.type === 'dit' ? '.' : '-').join('');
  const decoded = REVERSE[code] || '?';

  renderCode(userMorse, code);
  userDecoded.textContent = code ? decoded : '—';

  userCard.className = 'card' + (code ? ' has-input' : '');
}

// ── Next round ────────────────────────────────────────────────────────────────
async function nextLetter() {
  gameState = 'waiting';
  userInput = [];

  currentLetter = LETTERS[Math.floor(Math.random() * LETTERS.length)];
  currentCode   = MORSE[currentLetter];

  letterEl.textContent    = currentLetter;
  renderCode(targetMorse, currentCode);
  userDecoded.textContent = '—';
  userMorse.innerHTML     = '';
  userCard.className      = 'card';
  timingEntries.innerHTML = '';
  pressArea.className     = 'press-idle';
  pressHint.style.display = '';

  if (!audioReady) {
    feedbackEl.textContent = 'Press to start (enables audio)';
    feedbackEl.className   = 'waiting';
    return;
  }

  feedbackEl.textContent = 'Listen...';
  feedbackEl.className   = 'waiting';
  await playCurrentCode();

  if (gameState === 'waiting') {
    feedbackEl.textContent = 'Your turn';
  }
}

// ── Press handlers ────────────────────────────────────────────────────────────
function onPressStart(e) {
  e.preventDefault();
  if (gameState === 'evaluating') return;
  if (gameState === 'waiting' || gameState === 'inputting') {
    // First press ever → unlock AudioContext, then play the reference beep
    if (!audioReady) {
      audioReady = true;
      ensureCtx();
      // Let the press complete naturally, then replay beep for current letter
    }
    gameState = 'inputting';
    clearTimeout(gapTimer);
    pressStart = performance.now();
    startLiveTone();
    pressArea.className     = 'press-active';
    pressHint.style.display = 'none';
    feedbackEl.textContent  = '';
    feedbackEl.className    = '';
  }
}

function onPressEnd(e) {
  e.preventDefault();
  if (gameState !== 'inputting' || !pressStart) return;

  const ms   = performance.now() - pressStart;
  pressStart = 0;
  stopLiveTone();
  pressArea.className = 'press-idle';

  const type   = detector.classify(ms);
  const refMs  = type === 'dit' ? refUnitMs() : refUnitMs() * 3;
  userInput.push({ type, ms });

  updateUserCard();
  renderTimingEntry(timingEntries, type, ms, refMs);

  gapTimer = setTimeout(evaluate, detector.gapTimeout);
}

// ── Evaluate ──────────────────────────────────────────────────────────────────
function evaluate() {
  if (gameState !== 'inputting') return;
  gameState = 'evaluating';
  stopLiveTone();
  clearTimeout(gapTimer);
  pressArea.className = 'press-locked';

  const code    = userInput.map(e => e.type === 'dit' ? '.' : '-').join('');
  const correct = code === currentCode;
  const decoded = REVERSE[code] || '?';

  userDecoded.textContent = decoded;
  userCard.className      = 'card ' + (correct ? 'correct' : 'wrong');

  score.total++;
  if (correct) {
    score.correct++;
    streak++;
    feedbackEl.textContent = streak >= 3 ? `Correct! ×${streak}` : 'Correct!';
    feedbackEl.className   = 'correct';
  } else {
    streak = 0;
    const hint = currentCode.split('').map(c => c === '.' ? 'dit' : 'dah').join(' ');
    feedbackEl.textContent = `Wrong — ${hint}`;
    feedbackEl.className   = 'wrong';
  }

  const pct = Math.round(score.correct / score.total * 100);
  scoreText.textContent  = `${score.correct}/${score.total}  ${pct}%`;
  streakText.textContent = streak >= 3 ? `🔥×${streak}` : streak > 0 ? `×${streak}` : '';

  setTimeout(nextLetter, correct ? 1200 : 2200);
}

// ── Events ────────────────────────────────────────────────────────────────────
pressArea.addEventListener('mousedown',  onPressStart);
pressArea.addEventListener('mouseup',    onPressEnd);
pressArea.addEventListener('mouseleave', e => { if (gameState === 'inputting' && pressStart) onPressEnd(e); });
pressArea.addEventListener('touchstart', onPressStart, { passive: false });
pressArea.addEventListener('touchend',   onPressEnd,   { passive: false });
pressArea.addEventListener('touchcancel',onPressEnd,   { passive: false });

document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !e.repeat && !learnView.hidden) { e.preventDefault(); onPressStart(e); }
});
document.addEventListener('keyup', e => {
  if (e.code === 'Space' && !learnView.hidden) { e.preventDefault(); onPressEnd(e); }
});

replayBtn.addEventListener('click', () => {
  if (gameState !== 'evaluating') playCurrentCode();
});

document.getElementById('speed-up').addEventListener('click', () => {
  refWpm = Math.min(refWpm + 2, 30);
  speedDisplay.textContent = `${refWpm} WPM`;
});
document.getElementById('speed-down').addEventListener('click', () => {
  refWpm = Math.max(refWpm - 2, 5);
  speedDisplay.textContent = `${refWpm} WPM`;
});

// Auto-start on load
speedDisplay.textContent = `${refWpm} WPM`;
nextLetter();
