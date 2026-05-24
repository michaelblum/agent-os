function resolveDocument(container) {
  return container?.ownerDocument || globalThis.document;
}

export function appendSessionRailText(parent, tagName, className, text) {
  const element = resolveDocument(parent).createElement(tagName);
  element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

export function renderSessionRailEmpty(container) {
  container.replaceChildren();
  appendSessionRailText(container, 'div', 'empty-state', 'No sessions');
}

export function createSessionRailButton(row, { document = globalThis.document, onSessionClick } = {}) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'session-button';
  if (row.selected) {
    item.classList.add('selected');
    item.setAttribute('aria-current', 'true');
  }
  item.setAttribute('role', 'listitem');
  item.setAttribute('aria-label', row.ariaLabel);
  item.addEventListener('click', () => {
    onSessionClick?.(row);
  });

  const main = document.createElement('div');
  main.className = 'session-main';
  const badge = document.createElement('span');
  badge.className = `provider-badge ${row.provider}`;
  badge.textContent = row.providerLabel;
  const name = document.createElement('span');
  name.className = 'session-name';
  name.textContent = row.workspaceLabel;
  main.append(badge, name);

  const meta = document.createElement('div');
  meta.className = 'session-meta';
  meta.textContent = row.metadataText;

  const id = document.createElement('div');
  id.className = 'session-id';
  id.textContent = row.shortId;

  item.append(main, meta, id);
  return item;
}

export function renderSessionRail(container, rows, { onSessionClick } = {}) {
  container.replaceChildren();
  if (!Array.isArray(rows) || !rows.length) {
    appendSessionRailText(container, 'div', 'empty-state', 'No sessions');
    return [];
  }

  const rendered = rows.map((row) => {
    const item = createSessionRailButton(row, {
      document: resolveDocument(container),
      onSessionClick,
    });
    container.append(item);
    return item;
  });
  return rendered;
}
