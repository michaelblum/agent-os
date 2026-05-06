import { createWorkbenchSubject } from './subject.js';
import { createWikiPageSubject } from './wiki-subject.js';

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function pathText(value) {
  return String(value ?? '').replace(/^\/+/, '').trim();
}

function basename(path = '') {
  return pathText(path).split('/').filter(Boolean).pop() || '';
}

function frontmatterValue(page = {}, key = '') {
  const frontmatter = page.frontmatter && typeof page.frontmatter === 'object' ? page.frontmatter : {};
  return page[key] ?? frontmatter[key];
}

function agentIdForPage(page = {}, path = '') {
  const explicit = text(frontmatterValue(page, 'id') || frontmatterValue(page, 'agent_id'));
  return explicit || basename(path).replace(/\.md$/i, '');
}

function createNarrativeSourceReference(wikiSubject, { id = 'sigil-agent-narrative-source' } = {}) {
  return {
    id,
    relationship: 'narrative_source',
    handle: wikiSubject.id,
    subject_id: wikiSubject.id,
    subject_type: wikiSubject.subject_type,
    facet_key: 'wiki',
    layer: 'narrative',
    role: 'source',
  };
}

export function createSigilAgentSubject(page = {}, options = {}) {
  const path = pathText(page.path);
  if (!path) throw new TypeError('sigil agent subject requires a source wiki path');

  const wikiSubject = createWikiPageSubject(page);
  const agentId = text(options.agentId || agentIdForPage(page, path));
  if (!agentId) throw new TypeError('sigil agent subject requires an agent id');

  const reference = createNarrativeSourceReference(wikiSubject, {
    id: options.referenceId || 'sigil-agent-narrative-source',
  });
  const label = text(options.label || frontmatterValue(page, 'name'), wikiSubject.label || agentId);
  const tags = Array.isArray(wikiSubject.metadata.tags) ? wikiSubject.metadata.tags : [];

  return createWorkbenchSubject({
    id: `sigil.agent:${agentId}`,
    type: 'sigil.agent',
    label,
    owner: 'sigil',
    source: {
      kind: 'wiki',
      path,
      namespace: wikiSubject.source?.namespace || 'sigil',
      plugin: wikiSubject.source?.plugin || null,
      agent_id: agentId,
    },
    capabilities: [
      'inspectable',
      'editable',
      'wiki.read',
      'wiki.markdown.render',
      'markdown_document.text.patch',
      'markdown_document.save.requested',
      'sigil.agent.preview',
      'sigil.agent.appearance',
    ],
    subject_references: [reference],
    facets: [
      {
        key: 'narrative',
        layer: 'narrative',
        label: 'Agent Narrative',
        source_ref: reference.id,
        capabilities: ['inspectable', 'editable'],
        contracts: [
          'wiki.read',
          'wiki.markdown.render',
          'markdown_document.text.patch',
          'markdown_document.save.requested',
        ],
        hosts: [
          {
            kind: 'canvas',
            target_dialect: 'canvas',
            entry: {
              kind: 'aos-url',
              value: 'aos://toolkit/components/markdown-workbench/index.html',
            },
            preferred: true,
          },
        ],
      },
      {
        key: 'avatar-preview',
        layer: 'artifacts',
        label: 'Avatar Preview',
        capabilities: ['inspectable'],
        contracts: ['sigil.agent.preview'],
        hosts: [
          {
            kind: 'canvas',
            target_dialect: 'canvas',
            entry: {
              kind: 'aos-url',
              value: 'aos://sigil/renderer/index.html',
            },
          },
        ],
      },
      {
        key: 'appearance-controls',
        layer: 'controls',
        label: 'Appearance Controls',
        capabilities: ['editable'],
        contracts: ['sigil.agent.appearance'],
        hosts: [
          {
            kind: 'canvas',
            target_dialect: 'canvas',
            entry: {
              kind: 'aos-url',
              value: 'aos://sigil/studio/index.html',
            },
          },
        ],
      },
    ],
    views: [
      'markdown.source',
      'markdown.preview',
      'wiki.graph',
      'sigil.avatar.preview',
    ],
    controls: ['open', 'edit', 'save', 'appearance.controls'],
    persistence: {
      kind: 'wiki_write',
      request: 'markdown_document.save.requested',
      result: 'wiki_page_changed',
    },
    state: {
      modified_at: wikiSubject.state.modified_at,
    },
    metadata: {
      agent_id: agentId,
      wiki_subject: {
        id: wikiSubject.id,
        subject_type: wikiSubject.subject_type,
        path,
      },
      subject_references: [reference],
      wiki_type: wikiSubject.metadata.wiki_type,
      description: wikiSubject.metadata.description,
      tags,
    },
  });
}
