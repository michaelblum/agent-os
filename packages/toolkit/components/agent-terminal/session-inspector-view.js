import { createSessionInspectorModel } from './session-inspector-model.js';
import { providerLabel } from './session-rail-model.js';

function resolveDocument(container) {
  return container?.ownerDocument || globalThis.document;
}

export function appendInspectorText(parent, className, text, title) {
  const document = resolveDocument(parent);
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  if (title) element.title = title;
  parent.append(element);
  return element;
}

export function appendInspectorRow(parent, key, value, title) {
  const row = resolveDocument(parent).createElement('div');
  row.className = 'inspector-row';
  appendInspectorText(row, 'inspector-key', key);
  appendInspectorText(row, 'inspector-value', value || 'unknown', title);
  parent.append(row);
  return row;
}

export function appendInspectorSection(parent, heading) {
  const section = resolveDocument(parent).createElement('section');
  section.className = 'inspector-section';
  appendInspectorText(section, 'inspector-heading', heading);
  parent.append(section);
  return section;
}

export function appendInspectorMetricRow(parent, row) {
  appendInspectorRow(parent, row.key, row.value, row.title);
  if (row.source) appendInspectorText(parent, 'inspector-source', row.source, row.sourceTitle);
}

export function renderInspectorEmpty(container, text = 'Select a session') {
  container.replaceChildren();
  appendInspectorText(container, 'empty-state', text);
}

export function renderInspectorLoading(container, record) {
  container.replaceChildren();
  const section = appendInspectorSection(container, 'Session');
  appendInspectorRow(section, 'provider', providerLabel(record?.provider));
  appendInspectorRow(section, 'id', record?.session_id);
  appendInspectorRow(section, 'cwd', record?.cwd, record?.cwd);
  appendInspectorText(container, 'empty-state', 'Loading telemetry...');
}

export function renderInspectorError(container, error) {
  container.replaceChildren();
  const section = appendInspectorSection(container, 'Inspector');
  appendInspectorText(section, 'empty-state', error?.message || String(error));
}

export function appendDiagnosticRow(parent, diagnostic) {
  const item = resolveDocument(parent).createElement('div');
  item.className = `diagnostic ${diagnostic.severity || ''}`;
  appendInspectorText(item, 'inspector-heading', diagnostic.code);
  appendInspectorText(item, 'inspector-source', diagnostic.source);
  parent.append(item);
  return item;
}

export function renderSessionInspector(container, record, payload) {
  container.replaceChildren();
  const model = createSessionInspectorModel(record, payload);

  const sessionSection = appendInspectorSection(container, 'Session');
  for (const row of model.sessionRows) {
    appendInspectorRow(sessionSection, row.key, row.value, row.title);
  }

  const contextSection = appendInspectorSection(container, 'Context');
  if (model.contextRows) {
    for (const row of model.contextRows) appendInspectorMetricRow(contextSection, row);
  } else {
    appendInspectorText(contextSection, 'empty-state', model.contextEmpty);
  }

  if (model.tokenRows.length) {
    const tokenSection = appendInspectorSection(container, 'Token Counters');
    for (const row of model.tokenRows) appendInspectorMetricRow(tokenSection, row);
  }

  if (model.lifecycleRows.length) {
    const lifecycleSection = appendInspectorSection(container, 'Lifecycle');
    for (const event of model.lifecycleRows) {
      appendInspectorRow(lifecycleSection, event.heading.key, event.heading.value);
      if (event.pre) appendInspectorMetricRow(lifecycleSection, event.pre);
      if (event.post) appendInspectorMetricRow(lifecycleSection, event.post);
    }
  }

  const diagnosticSection = appendInspectorSection(container, 'Diagnostics');
  if (model.diagnosticRows.length) {
    for (const diagnostic of model.diagnosticRows) appendDiagnosticRow(diagnosticSection, diagnostic);
  } else {
    appendInspectorText(diagnosticSection, 'empty-state', model.diagnosticsEmpty);
  }

  return model;
}
