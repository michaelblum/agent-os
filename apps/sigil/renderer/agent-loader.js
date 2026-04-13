// agent-loader.js — Parse agent wiki documents into canvas-ready config.
//
// Agent docs are markdown files with a YAML frontmatter block (identity/tags)
// and a single ```json code block carrying {appearance, minds, instance}.
//
// Any parse/fetch failure MUST fall back to MINIMAL_DEFAULT — live renderer
// boot depends on this never throwing.

export const MINIMAL_DEFAULT = Object.freeze({
  id: 'default',
  name: 'Default',
  appearance: {
    shape: 6,
    opacity: 0.25,
    edgeOpacity: 1.0,
    maskEnabled: true,
    interiorEdges: true,
    specular: true,
    aura: { enabled: true, reach: 1.0, intensity: 1.0, pulseRate: 0.005 },
    colors: {
      face: ['#bc13fe', '#4a2b6e'],
      edge: ['#bc13fe', '#4a2b6e'],
    },
  },
  minds: { skills: [], tools: [], workflows: [] },
  instance: {
    birthplace: { anchor: 'nonant', nonant: 'bottom-right', display: 'main' },
    size: 300,
  },
});

export function parseAgentDoc(markdown) {
  try {
    const fmMatch = markdown.match(/^---\n([\s\S]*?)\n---\n/);
    const frontmatter = fmMatch ? parseYAMLFrontmatter(fmMatch[1]) : {};
    const jsonMatch = markdown.match(/```json\s*\n([\s\S]*?)\n```/);
    if (!jsonMatch) throw new Error('no json block');
    const body = JSON.parse(jsonMatch[1]);
    return {
      id: frontmatter.id ?? MINIMAL_DEFAULT.id,
      name: frontmatter.name ?? MINIMAL_DEFAULT.name,
      tags: frontmatter.tags ?? [],
      appearance: body.appearance ?? MINIMAL_DEFAULT.appearance,
      minds: body.minds ?? MINIMAL_DEFAULT.minds,
      instance: body.instance ?? MINIMAL_DEFAULT.instance,
    };
  } catch (e) {
    console.warn('[agent-loader] falling back to minimal default:', e);
    return { ...MINIMAL_DEFAULT };
  }
}

function parseYAMLFrontmatter(src) {
  // Minimal: key: value; lists in [a, b, c] form. Sufficient for our frontmatter needs.
  const out = {};
  for (const line of src.split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      v = v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    }
    out[m[1]] = v;
  }
  return out;
}

// NOTE: The AOS content server mounts the wiki at `/wiki/<path>` on the
// localhost HTTP port. The `aos://` scheme is only rewritten by the daemon
// for the initial canvas URL (--url) — it is NOT a WKWebView scheme handler,
// so in-page fetches must use root-relative paths. Canvases are loaded from
// the same content-server origin, so `/wiki/...` resolves correctly.
// See src/content/server.swift (the `wiki` prefix branch) and
// src/daemon/unified.swift (resolveContentURL).
export async function loadAgent(wikiPath) {
  try {
    const res = await fetch(`/wiki/${wikiPath}.md`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return parseAgentDoc(text);
  } catch (e) {
    console.warn('[agent-loader] fetch failed, falling back:', e);
    return { ...MINIMAL_DEFAULT };
  }
}
