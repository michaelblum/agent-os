// active-agent.js — single source of truth for "which agent is Studio editing?"
// Replaces the old ?agent=<id> URL-param-only model. The URL is still updated
// for bookmarking, but in-app state flows through this module.

let current = null;
const listeners = new Set();

export function getActiveAgent() { return current; }

export function setActiveAgent(agent) {
  current = agent;
  if (agent?.id) {
    const url = new URL(window.location);
    url.searchParams.set('agent', agent.id);
    window.history.replaceState({}, '', url);
  }
  listeners.forEach(fn => { try { fn(agent); } catch (e) { console.warn(e); } });
}

export function onActiveAgentChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
