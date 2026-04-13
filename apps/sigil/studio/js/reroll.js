// reroll.js — reroll flyout: scope chips, recent strip, seed pill.
// Roll execution goes through randomize.js; history is kept in seed-history.
import { randomizeAll } from './randomize.js';
import { seedToWords, wordsToSeed } from './seed-words.js';
import { createSeedHistory } from './seed-history.js';
import { updatePulsars, updateGammaRays, updateAccretion, updateNeutrinos } from './ui.js';

const history = createSeedHistory({ capacity: 6 });
let currentScope = 'everything';
let currentSeed = Math.floor(Math.random() * 999999);

function render() {
  const fly = document.getElementById('reroll-flyout');
  const scopes = ['everything', 'shape', 'palette', 'effects'];
  const entries = history.entries();
  fly.innerHTML = `
    <div class="scopes">${scopes.map(s => `
      <div class="scope ${s === currentScope ? 'active' : ''}" data-scope="${s}">${labelOf(s)}</div>
    `).join('')}</div>
    <div class="recent">${entries.map(e => `
      <div class="mini-orb ${e.seed === currentSeed ? 'current' : ''}"
           title="${seedToWords(e.seed)}"
           data-seed="${e.seed}"
           style="background: linear-gradient(135deg, ${hashToHex(e.seed, 0)}, ${hashToHex(e.seed, 1)})"></div>
    `).join('')}</div>
    <div class="seed-row">
      <input class="seed-input" value="${seedToWords(currentSeed)}" spellcheck="false">
    </div>
  `;
  fly.querySelectorAll('.scope').forEach(el => {
    el.addEventListener('click', () => { currentScope = el.dataset.scope; render(); });
  });
  fly.querySelectorAll('.mini-orb').forEach(el => {
    el.addEventListener('click', () => { executeRoll(Number(el.dataset.seed)); });
  });
  const input = fly.querySelector('.seed-input');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { executeRoll(wordsToSeed(input.value.trim())); }
  });
}

function executeRoll(seed) {
  currentSeed = (seed >>> 0) % 1000000;
  randomizeAll(currentSeed, currentScope, { updatePulsars, updateGammaRays, updateAccretion, updateNeutrinos });
  history.push({ seed: currentSeed, scope: currentScope });
  render();
}

function hashToHex(seed, channel) {
  const h = Math.imul(seed + channel * 17, 0x9e3779b1) >>> 0;
  return '#' + (h & 0xffffff).toString(16).padStart(6, '0');
}
function labelOf(s) { return { everything: 'All', shape: 'Shape', palette: 'Palette', effects: 'FX' }[s]; }

export function setupReroll() {
  const btn = document.getElementById('btn-reroll');
  const fly = document.getElementById('reroll-flyout');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!fly.hidden) { executeRoll(Math.floor(Math.random() * 999999)); return; }
    const rect = btn.getBoundingClientRect();
    fly.style.left = `${Math.max(8, rect.right - 280)}px`;
    fly.style.top = `${rect.bottom + 4}px`;
    render();
    fly.hidden = false;
    setTimeout(() => document.addEventListener('click', onDoc, true), 0);
  });
  function onDoc(e) {
    if (!fly.contains(e.target) && e.target !== btn) {
      fly.hidden = true;
      document.removeEventListener('click', onDoc, true);
    }
  }
}
