import { createWorkbenchSubject } from './subject.js';

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

export function wikiSubjectType(page = {}) {
  const path = pathText(page.path);
  const pageType = text(frontmatterValue(page, 'type')).toLowerCase();
  if (path.startsWith('sigil/agents/') || pageType === 'agent') return 'sigil.agent';
  if (pageType === 'workflow' || path.includes('/plugins/') && basename(path) === 'SKILL.md') {
    return 'wiki.workflow';
  }
  if (pageType === 'entity') return 'wiki.entity';
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
    'wiki.read',
    'wiki.markdown.render',
    'markdown_document.text.patch',
    'markdown_document.save.requested',
  ];
  const views = ['markdown.source', 'markdown.preview', 'wiki.graph'];
  const controls = ['open', 'edit', 'save'];

  if (subjectType === 'wiki.workflow') {
    capabilities.push('wiki.invoke', 'workflow.project');
    views.push('workflow.graph', 'workflow.source');
    controls.push('invoke');
  }

  if (subjectType === 'sigil.agent') {
    capabilities.push('sigil.agent.preview', 'sigil.agent.appearance');
    views.push('sigil.avatar.preview');
    controls.push('appearance.controls');
  }

  return createWorkbenchSubject({
    id: `wiki:${path}`,
    type: subjectType,
    label: name,
    owner: namespace,
    source: {
      kind: 'wiki',
      path,
      namespace,
      plugin: plugin || null,
    },
    capabilities,
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
