// agent-api.js — HTTP surface for sigil/agents/* wiki docs.
// All calls are relative to the same origin Studio is served from. The content
// server exposes /wiki/<path> (GET/PUT/DELETE on files) and /wiki/<dir>/
// (GET listing; trailing slash required). See src/content/server.swift.

const NS = 'sigil/agents';

export async function listAgents() {
  const res = await fetch(`/wiki/${NS}/`);
  if (!res.ok) throw new Error(`listAgents: HTTP ${res.status}`);
  const payload = await res.json();
  return payload.entries
    .filter(e => e.kind === 'file' && e.name.endsWith('.md'))
    .map(e => e.name.slice(0, -'.md'.length));
}

export async function loadAgentDoc(id) {
  const res = await fetch(`/wiki/${NS}/${encodeURIComponent(id)}.md`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`loadAgentDoc(${id}): HTTP ${res.status}`);
  return await res.text();
}

export async function putAgentDoc(id, markdown) {
  const res = await fetch(`/wiki/${NS}/${encodeURIComponent(id)}.md`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/markdown' },
    body: markdown,
  });
  if (!res.ok) throw new Error(`putAgentDoc(${id}): HTTP ${res.status}`);
}

export async function deleteAgent(id) {
  const res = await fetch(`/wiki/${NS}/${encodeURIComponent(id)}.md`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`deleteAgent(${id}): HTTP ${res.status}`);
  }
}
