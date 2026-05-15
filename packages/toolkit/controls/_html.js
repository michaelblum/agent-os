export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function dataAttributeName(name) {
  return `data-${String(name).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

export function attributeParts(config = {}) {
  const parts = [];
  for (const [name, value] of Object.entries(config.attributes || {})) {
    if (value === undefined || value === null || value === false) continue;
    parts.push(value === true ? escapeHtml(name) : `${escapeHtml(name)}="${escapeHtml(value)}"`);
  }
  for (const [name, value] of Object.entries(config.dataset || {})) {
    if (value === undefined || value === null || value === false) continue;
    const attrName = dataAttributeName(name);
    parts.push(value === true ? escapeHtml(attrName) : `${escapeHtml(attrName)}="${escapeHtml(value)}"`);
  }
  for (const raw of config.rawAttributes || []) {
    if (!raw) continue;
    parts.push(String(raw));
  }
  return parts;
}
