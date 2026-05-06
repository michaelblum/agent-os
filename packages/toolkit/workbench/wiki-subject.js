import { createWorkbenchSubject } from './subject.js';

const MARKDOWN_WORKBENCH_URL = 'aos://toolkit/components/markdown-workbench/index.html';
const WIKI_KB_URL = 'aos://toolkit/components/wiki-kb/index.html';

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

function namespaceForPath(path = '') {
  return pathText(path).split('/').filter(Boolean)[0] || 'wiki';
}

function normalizeTags(value = []) {
  if (Array.isArray(value)) return value.map((tag) => text(tag)).filter(Boolean);
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return raw.slice(1, -1).split(',').map((tag) => text(tag)).filter(Boolean);
  }
  return raw.split(/\s*,\s*/).map((tag) => text(tag)).filter(Boolean);
}

function frontmatterValue(page = {}, key = '') {
  const frontmatter = page.frontmatter && typeof page.frontmatter === 'object' ? page.frontmatter : {};
  return page[key] ?? frontmatter[key];
}

function canvasComponentHost(value, { preferred = false, facet = '' } = {}) {
  return {
    kind: 'canvas',
    target_dialect: 'canvas',
    entry: {
      kind: 'aos-url',
      value,
      ...(facet ? { facet } : {}),
    },
    ...(preferred ? { preferred: true } : {}),
  };
}

export function wikiSubjectType(page = {}) {
  const path = pathText(page.path);
  const pageType = text(frontmatterValue(page, 'type')).toLowerCase();
  if (pageType === 'workflow' || path.includes('/plugins/') && basename(path) === 'SKILL.md') {
    return 'wiki.workflow';
  }
  if (pageType === 'entity' || pageType === 'agent' || path.startsWith('sigil/agents/')) {
    return 'wiki.entity';
  }
  if (pageType === 'concept') return page.plugin ? 'wiki.reference' : 'wiki.concept';
  return 'wiki.page';
}

export function createWikiPageSubject(page = {}) {
  const path = pathText(page.path);
  if (!path) throw new TypeError('wiki page subject requires a path');

  const subjectType = wikiSubjectType(page);
  const name = text(frontmatterValue(page, 'name'), basename(path).replace(/\.md$/i, ''));
  const tags = normalizeTags(frontmatterValue(page, 'tags'));
  const plugin = text(frontmatterValue(page, 'plugin') || page.plugin);
  const namespace = namespaceForPath(path);
  const capabilities = [
    'inspectable',
    'editable',
    'wiki.read',
    'wiki.markdown.render',
    'markdown_document.text.patch',
    'markdown_document.save.requested',
  ];
  const views = ['markdown.source', 'markdown.preview', 'wiki.graph'];
  const controls = ['open', 'edit', 'save'];

  if (subjectType === 'wiki.workflow') {
    capabilities.push('replayable');
    capabilities.push('wiki.invoke', 'workflow.project');
    views.push('workflow.graph', 'workflow.source');
    controls.push('invoke');
  }
  const source = {
    kind: 'wiki',
    path,
    namespace,
    plugin: plugin || null,
  };
  const facets = [
    {
      key: 'wiki-markdown',
      layer: 'narrative',
      label: 'Markdown Source',
      source,
      capabilities: ['inspectable', 'editable'],
      contracts: [
        'wiki.read',
        'markdown_document.text.patch',
        'markdown_document.save.requested',
      ],
      hosts: [
        canvasComponentHost(MARKDOWN_WORKBENCH_URL, { preferred: true, facet: 'source' }),
      ],
    },
    {
      key: 'markdown-preview',
      layer: 'narrative',
      label: 'Rendered Markdown Preview',
      source,
      capabilities: ['inspectable'],
      contracts: ['wiki.markdown.render'],
      hosts: [
        canvasComponentHost(MARKDOWN_WORKBENCH_URL, { facet: 'preview' }),
      ],
    },
    {
      key: 'wiki-graph',
      layer: 'descriptor',
      label: 'Wiki Graph',
      source,
      capabilities: ['inspectable'],
      contracts: ['wiki.read'],
      hosts: [
        canvasComponentHost(MARKDOWN_WORKBENCH_URL, { facet: 'graph' }),
        canvasComponentHost(WIKI_KB_URL, { facet: 'graph' }),
      ],
    },
  ];

  if (subjectType === 'wiki.workflow') {
    facets.push({
      key: 'workflow-projection',
      layer: 'descriptor',
      label: 'Workflow Projection',
      source,
      capabilities: ['inspectable', 'replayable'],
      contracts: ['workflow.project', 'wiki.invoke'],
      hosts: [
        canvasComponentHost(WIKI_KB_URL, { facet: 'workflow' }),
      ],
    });
  }

  return createWorkbenchSubject({
    id: `wiki:${path}`,
    type: subjectType,
    label: name,
    owner: namespace,
    source,
    capabilities,
    facets,
    views,
    controls,
    persistence: {
      kind: 'wiki_write',
      request: 'markdown_document.save.requested',
      result: 'wiki_page_changed',
    },
    state: {
      modified_at: Number(page.modified_at || 0) || null,
    },
    metadata: {
      wiki_type: text(frontmatterValue(page, 'type'), 'page'),
      description: text(frontmatterValue(page, 'description')),
      tags,
      plugin: plugin || null,
    },
  });
}

export function createWikiPageSubjects(pages = []) {
  return (Array.isArray(pages) ? pages : []).map((page) => createWikiPageSubject(page));
}
