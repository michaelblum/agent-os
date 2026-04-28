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
    tesseron: { enabled: true, proportion: 0.5, matchMother: true },
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
    size: 180,
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
    const url = `/wiki/${wikiPath}.md`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const agent = parseAgentDoc(text);

    // Migration: if the doc has `home` but not `birthplace`, upgrade in memory
    // only. Studio is responsible for persisting the normalized field on an
    // explicit save; reads must not rewrite wiki content.
    const inst = agent.instance ?? {};
    const hasBirthplace = inst.birthplace != null;
    const hasHome = inst.home != null;

    if (hasBirthplace && hasHome) {
      console.warn('[agent-loader] agent doc has both birthplace and home; home is orphaned and will NOT be removed automatically (to avoid unexpected writes on read). Manual cleanup recommended.');
      return agent;
    }

    if (!hasBirthplace && hasHome) {
      agent.instance = { ...inst, birthplace: inst.home };
      delete agent.instance.home;
      return agent;
    }

    // hasBirthplace-only or neither — parseAgentDoc already filled in
    // MINIMAL_DEFAULT.instance (which has `birthplace`) when `instance` was
    // missing from the doc, so the agent object is already well-formed.
    return agent;
  } catch (e) {
    console.warn('[agent-loader] fetch failed, falling back:', e);
    return { ...MINIMAL_DEFAULT };
  }
}
