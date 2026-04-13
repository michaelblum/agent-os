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
    const url = `/wiki/${wikiPath}.md`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const agent = parseAgentDoc(text);

    // Migration: if the doc has `home` but not `birthplace`, rewrite on disk
    // and upgrade the in-memory agent. If both are present, `birthplace` wins
    // and `home` is left orphaned (logged advisory, no rewrite — we don't
    // mutate docs on a read path when both fields are present).
    const inst = agent.instance ?? {};
    const hasBirthplace = inst.birthplace != null;
    const hasHome = inst.home != null;

    if (hasBirthplace && hasHome) {
      console.warn('[agent-loader] agent doc has both birthplace and home; home is orphaned and will NOT be removed automatically (to avoid unexpected writes on read). Manual cleanup recommended.');
      return agent;
    }

    if (!hasBirthplace && hasHome) {
      // In-place rename. `agent.instance` already came from parseAgentDoc,
      // which returned a fresh object — safe to mutate.
      agent.instance = { ...inst, birthplace: inst.home };
      delete agent.instance.home;

      // Rewrite the wiki doc so `home` no longer appears on disk. Best-effort:
      // if the PUT fails we keep the in-memory rewrite and the next load will
      // retry. Construct the new body by replacing the `home` key token in
      // the JSON block — simpler and safer than round-tripping through the
      // full frontmatter + JSON serializer.
      const rewritten = text.replace(/"home"\s*:/g, '"birthplace":');
      try {
        const putRes = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/markdown' },
          body: rewritten,
        });
        if (!putRes.ok) throw new Error(`PUT HTTP ${putRes.status}`);
        console.log('[agent-loader] migrated home → birthplace in', wikiPath);
      } catch (e) {
        console.warn('[agent-loader] migration PUT failed; keeping in-memory rewrite:', e);
      }
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
