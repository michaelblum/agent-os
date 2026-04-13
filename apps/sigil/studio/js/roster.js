// roster.js — agent tile grid (default Studio view).
// Queries the content-server's wiki directory listing, derives mini-orb
// gradients from each agent's appearance.colors.face, switches active agent
// on tile click. Kebab opens rename/clone/delete actions.

import { listAgents, loadAgentDoc } from './agent-api.js';
import { parseAgentDoc } from '../../renderer/agent-loader.js';
import { applyAppearance } from '../../renderer/appearance.js';
import { getActiveAgent, setActiveAgent, onActiveAgentChange } from './active-agent.js';

function renderTile(agent, active) {
  const tile = document.createElement('div');
  tile.className = 'agent-tile' + (active ? ' active' : '');
  tile.dataset.agentId = agent.id;
  const [c1, c2] = agent?.appearance?.colors?.face ?? ['#bc13fe', '#4a2b6e'];
  tile.innerHTML = `
    <div class="orb" style="--orb-gradient: linear-gradient(135deg, ${c1}, ${c2})"></div>
    <div class="name">${escapeHtml(agent.name ?? agent.id)}</div>
    <div class="status">${active ? 'editing' : 'idle'}</div>
    <div class="kebab" role="button" tabindex="0" aria-label="Actions">⋯</div>
  `;
  tile.addEventListener('click', async (e) => {
    if (e.target.classList.contains('kebab')) return;
    await switchToAgent(agent.id);
  });
  tile.querySelector('.kebab').addEventListener('click', (e) => {
    e.stopPropagation();
    document.dispatchEvent(new CustomEvent('roster:kebab', { detail: { id: agent.id, anchor: e.target } }));
  });
  return tile;
}

function renderNewTile() {
  const tile = document.createElement('div');
  tile.className = 'agent-tile new';
  tile.innerHTML = `<div class="plus">+</div><div class="name">New agent</div>`;
  tile.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('roster:new'));
  });
  return tile;
}

async function switchToAgent(id) {
  const markdown = await loadAgentDoc(id);
  if (markdown === null) { console.warn('[roster] missing', id); return; }
  const agent = parseAgentDoc(markdown);
  agent.id = id;
  applyAppearance(agent.appearance);
  setActiveAgent(agent);
}

export async function setupRoster() {
  const grid = document.getElementById('roster-grid');
  async function refresh() {
    grid.replaceChildren();
    try {
      const ids = await listAgents();
      const active = getActiveAgent();
      for (const id of ids) {
        const md = await loadAgentDoc(id);
        if (!md) continue;
        const parsed = parseAgentDoc(md);
        parsed.id = id;
        grid.appendChild(renderTile(parsed, id === active?.id));
      }
    } catch (e) {
      console.warn('[roster] refresh failed:', e);
    }
    grid.appendChild(renderNewTile());
  }
  onActiveAgentChange(() => refresh());
  document.addEventListener('roster:refresh', refresh);
  await refresh();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
