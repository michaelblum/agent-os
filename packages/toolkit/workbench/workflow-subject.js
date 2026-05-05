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

function textList(values = []) {
  if (Array.isArray(values)) return values.map((value) => text(value)).filter(Boolean);
  return String(values ?? '').split(',').map((value) => text(value)).filter(Boolean);
}

function normalizePage(page = {}) {
  const path = pathText(page.path);
  const fallbackName = basename(path).replace(/\.md$/i, '').replace(/-/g, ' ');
  return {
    path,
    type: text(page.type || page.frontmatter?.type, 'page'),
    name: text(page.name || page.frontmatter?.name, fallbackName),
    description: text(page.description || page.frontmatter?.description),
    tags: textList(page.tags || page.frontmatter?.tags),
    plugin: text(page.plugin || page.frontmatter?.plugin) || null,
    modified_at: Number(page.modified_at || 0) || null,
  };
}

function normalizeLinkTarget(sourcePath = '', href = '') {
  const cleanHref = String(href || '').split('#')[0].split('?')[0].trim();
  if (!cleanHref || /^[a-z]+:/i.test(cleanHref)) return null;

  const parts = cleanHref.startsWith('/')
    ? []
    : pathText(sourcePath).split('/').filter(Boolean).slice(0, -1);

  for (const part of cleanHref.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
    } else {
      parts.push(part);
    }
  }

  return parts.join('/');
}

function markdownLinks(markdown = '', sourcePath = '') {
  const links = [];
  const pattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = pattern.exec(String(markdown || '')))) {
    const target = normalizeLinkTarget(sourcePath, match[2]);
    if (!target) continue;
    links.push({
      label: text(match[1]),
      target,
    });
  }
  return links;
}

function splitMarkdownRow(line = '') {
  return String(line)
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => text(cell));
}

function parseStageContractRows(markdown = '') {
  const lines = String(markdown || '').split(/\r?\n/);
  const rows = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line.startsWith('|')) continue;

    const headers = splitMarkdownRow(line).map((header) => header.toLowerCase());
    if (!headers.includes('stage') || !headers.some((header) => header.includes('output'))) continue;

    const divider = lines[index + 1]?.trim() || '';
    if (!/^\|?\s*:?-{2,}/.test(divider)) continue;

    const stageIndex = headers.indexOf('stage');
    const outputIndex = headers.findIndex((header) => header.includes('output'));
    const targetIndex = headers.findIndex((header) => header.includes('canonical') || header.includes('page'));

    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const rowLine = lines[rowIndex].trim();
      if (!rowLine.startsWith('|')) break;
      const cells = splitMarkdownRow(rowLine);
      if (cells.length < headers.length) continue;
      rows.push({
        stage: cells[stageIndex] || '',
        output: cells[outputIndex] || '',
        targetCell: targetIndex >= 0 ? cells[targetIndex] : '',
        cells,
      });
    }
    break;
  }

  return rows;
}

function pageKind(page = {}) {
  const normalizedPath = pathText(page.path);
  if (page.type === 'workflow' || normalizedPath.includes('/plugins/')) return 'workflow';
  if (page.type === 'entity' || normalizedPath.includes('/entities/')) return 'artifact';
  if (page.type === 'concept' || normalizedPath.includes('/concepts/')) return 'reference';
  return 'reference';
}

function createPageLookup(pages = []) {
  const lookup = new Map();
  for (const page of pages) {
    const normalized = normalizePage(page);
    if (normalized.path) lookup.set(normalized.path, normalized);
  }
  return lookup;
}

function uniqueBy(items = [], keyFn = (item) => item) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function stageStepFromRow(row, index, root, pageLookup) {
  const allLinks = markdownLinks(row.cells.join(' '), root.path);
  const targetLink = markdownLinks(row.targetCell, root.path)[0] || allLinks[0] || null;
  const targetPage = targetLink ? pageLookup.get(targetLink.target) : null;

  return {
    id: `step-${String(index + 1).padStart(2, '0')}`,
    order: index + 1,
    label: text(row.stage, `Step ${index + 1}`),
    output: text(row.output),
    target: targetLink ? {
      subject_id: `wiki:${targetLink.target}`,
      path: targetLink.target,
      label: targetLink.label,
      kind: targetPage ? pageKind(targetPage) : 'missing',
      resolved: Boolean(targetPage),
    } : null,
    references: allLinks.map((link) => {
      const page = pageLookup.get(link.target);
      return {
        subject_id: `wiki:${link.target}`,
        path: link.target,
        label: link.label,
        kind: page ? pageKind(page) : 'missing',
        resolved: Boolean(page),
      };
    }),
  };
}

function fallbackSteps(root, pages, links) {
  const pageLookup = createPageLookup(pages);
  return (Array.isArray(links) ? links : [])
    .filter((link) => pathText(link.source_path || link.source) === root.path)
    .map((link, index) => {
      const targetPath = pathText(link.target_path || link.target);
      const targetPage = pageLookup.get(targetPath);
      return {
        id: `step-${String(index + 1).padStart(2, '0')}`,
        order: index + 1,
        label: targetPage?.name || targetPath,
        output: '',
        target: {
          subject_id: `wiki:${targetPath}`,
          path: targetPath,
          label: targetPage?.name || targetPath,
          kind: targetPage ? pageKind(targetPage) : 'missing',
          resolved: Boolean(targetPage),
        },
        references: [],
      };
    });
}

export function createWikiWorkflowDescriptor({ root, pages = [], links = [], markdown = null } = {}) {
  const normalizedRoot = normalizePage(root);
  if (!normalizedRoot.path) throw new TypeError('wiki workflow descriptor requires a root path');

  const sourceMarkdown = String(markdown ?? root?.content ?? root?.rawContent ?? root?.markdown ?? '');
  const allPages = uniqueBy([normalizedRoot, ...(Array.isArray(pages) ? pages : [])].map(normalizePage), (page) => page.path);
  const pageLookup = createPageLookup(allPages);
  const stageRows = parseStageContractRows(sourceMarkdown);
  const steps = stageRows.length
    ? stageRows.map((row, index) => stageStepFromRow(row, index, normalizedRoot, pageLookup))
    : fallbackSteps(normalizedRoot, allPages, links);

  const references = uniqueBy(
    steps.flatMap((step) => step.references || []),
    (ref) => ref.path,
  );
  const artifacts = references
    .filter((ref) => ref.kind === 'artifact')
    .map((ref) => ({ kind: 'wiki_artifact', ...ref }));
  const childWorkflows = uniqueBy(
    steps
      .map((step) => step.target)
      .filter((target) => target?.kind === 'workflow'),
    (target) => target.path,
  );
  const missingTargets = references.filter((ref) => !ref.resolved);

  return {
    root: {
      subject_id: `wiki:${normalizedRoot.path}`,
      path: normalizedRoot.path,
      label: normalizedRoot.name,
      type: normalizedRoot.type,
    },
    steps,
    child_workflows: childWorkflows,
    artifacts,
    inputs: [],
    outputs: uniqueBy(steps.map((step) => step.output).filter(Boolean)),
    approval_gates: [],
    validation: {
      state: missingTargets.length ? 'repairable' : 'valid',
      missing_targets: missingTargets,
      source: stageRows.length ? 'stage_contract_table' : 'outgoing_links',
    },
  };
}

export function createWikiWorkflowSubject(input = {}) {
  const descriptor = createWikiWorkflowDescriptor(input);
  const root = normalizePage(input.root);
  const namespace = namespaceForPath(root.path);
  const hasInvocableChildren = descriptor.child_workflows.length > 0;

  return createWorkbenchSubject({
    id: `workflow:${root.path}`,
    type: 'wiki.workflow_chain',
    label: root.name,
    owner: namespace,
    source: {
      kind: 'wiki_workflow',
      path: root.path,
      namespace,
      plugin: root.plugin,
    },
    capabilities: [
      'wiki.read',
      'workflow.project',
      'workflow.chain.inspect',
      ...(hasInvocableChildren ? ['wiki.invoke'] : []),
    ],
    views: ['workflow.chain', 'workflow.graph', 'workflow.source', 'workflow.artifacts'],
    controls: ['open', 'inspect.step', ...(hasInvocableChildren ? ['invoke.child_workflow'] : [])],
    artifacts: descriptor.artifacts,
    state: {
      workflow: descriptor,
      modified_at: root.modified_at,
    },
    metadata: {
      wiki_type: root.type,
      description: root.description,
      tags: root.tags,
      step_count: descriptor.steps.length,
      child_workflow_count: descriptor.child_workflows.length,
      artifact_count: descriptor.artifacts.length,
      validation_state: descriptor.validation.state,
    },
  });
}
