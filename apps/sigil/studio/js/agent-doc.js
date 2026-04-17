// agent-doc.js — parse and serialize wiki-backed Sigil agent docs.

import { DEFAULT_APPEARANCE } from '../../renderer/appearance.js';

const DEFAULT_MINDS = Object.freeze({ skills: [], tools: [], workflows: [] });
const DEFAULT_INSTANCE = Object.freeze({
  birthplace: { anchor: 'nonant', nonant: 'bottom-right', display: 'main' },
  size: 180,
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseFrontmatter(src = '') {
  const out = {};
  for (const line of src.split('\n')) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    }
    out[match[1]] = value;
  }
  return out;
}

function serializeFrontmatter(frontmatter) {
  return Object.entries(frontmatter)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}: [${value.join(', ')}]`;
      return `${key}: ${value}`;
    })
    .join('\n');
}

function normalizeBirthplace(instance = {}) {
  const birthplace = instance.birthplace ?? instance.home ?? DEFAULT_INSTANCE.birthplace;
  return {
    ...clone(DEFAULT_INSTANCE.birthplace),
    ...(birthplace || {}),
  };
}

function normalizeInstance(instance = {}) {
  return {
    ...clone(DEFAULT_INSTANCE),
    ...(instance || {}),
    birthplace: normalizeBirthplace(instance),
  };
}

function normalizeMinds(minds = {}) {
  return {
    ...clone(DEFAULT_MINDS),
    ...(minds || {}),
  };
}

export function createDraftAgent({ id, name, appearance, tags, minds, instance, prose } = {}) {
  const safeId = String(id || 'default');
  const safeName = String(name || safeId);
  return {
    id: safeId,
    name: safeName,
    tags: Array.isArray(tags) && tags.length ? [...tags] : ['sigil'],
    prose: prose ?? `Sigil agent: ${safeName}.`,
    appearance: clone(appearance || DEFAULT_APPEARANCE),
    minds: normalizeMinds(minds),
    instance: normalizeInstance(instance),
    version: 1,
    frontmatterExtra: {},
    bodyExtra: {},
  };
}

export function parseDraftAgent(markdown, fallbackId = 'default') {
  if (!markdown) return createDraftAgent({ id: fallbackId, name: fallbackId });

  const fmMatch = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  const jsonMatch = markdown.match(/```json\s*\n([\s\S]*?)\n```/);

  const frontmatter = fmMatch ? parseFrontmatter(fmMatch[1]) : {};
  let body = {};
  if (jsonMatch) {
    try {
      body = JSON.parse(jsonMatch[1]);
    } catch (error) {
      console.warn('[studio] malformed agent json block; falling back to defaults', error);
    }
  }

  const proseStart = fmMatch ? fmMatch[0].length : 0;
  const proseEnd = jsonMatch ? jsonMatch.index : markdown.length;
  const prose = markdown.slice(proseStart, proseEnd).trim() || `Sigil agent: ${frontmatter.name || fallbackId}.`;

  const draft = createDraftAgent({
    id: frontmatter.id ?? fallbackId,
    name: frontmatter.name ?? frontmatter.id ?? fallbackId,
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : ['sigil'],
    prose,
    appearance: body.appearance ?? DEFAULT_APPEARANCE,
    minds: body.minds ?? DEFAULT_MINDS,
    instance: body.instance ?? DEFAULT_INSTANCE,
  });

  draft.version = body.version ?? 1;
  draft.frontmatterExtra = Object.fromEntries(
    Object.entries(frontmatter).filter(([key]) => !['type', 'id', 'name', 'tags'].includes(key))
  );
  draft.bodyExtra = Object.fromEntries(
    Object.entries(body).filter(([key]) => !['version', 'appearance', 'minds', 'instance'].includes(key))
  );
  return draft;
}

export function serializeDraftAgent(draft) {
  const normalized = createDraftAgent(draft);
  normalized.version = draft?.version ?? 1;
  normalized.frontmatterExtra = clone(draft?.frontmatterExtra || {});
  normalized.bodyExtra = clone(draft?.bodyExtra || {});

  const frontmatter = {
    type: 'agent',
    id: normalized.id,
    name: normalized.name,
    tags: normalized.tags,
    ...normalized.frontmatterExtra,
  };

  const body = {
    ...normalized.bodyExtra,
    version: normalized.version,
    appearance: clone(normalized.appearance),
    minds: normalizeMinds(normalized.minds),
    instance: normalizeInstance(normalized.instance),
  };

  return [
    '---',
    serializeFrontmatter(frontmatter),
    '---',
    '',
    normalized.prose.trim(),
    '',
    '```json',
    JSON.stringify(body, null, 2),
    '```',
    '',
  ].join('\n');
}

export function cloneDraftAgent(draft) {
  return {
    ...clone(createDraftAgent(draft)),
    version: draft?.version ?? 1,
    frontmatterExtra: clone(draft?.frontmatterExtra || {}),
    bodyExtra: clone(draft?.bodyExtra || {}),
  };
}
