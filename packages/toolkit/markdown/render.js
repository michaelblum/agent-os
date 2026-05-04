const SAFE_PROTOCOLS = new Set(['aos:', 'http:', 'https:', 'mailto:']);

export function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttribute(value) {
  return escHtml(value);
}

export function safeExternalHref(rawHref) {
  const href = String(rawHref ?? '').trim();
  if (!href) return '';
  if (href.startsWith('#') || href.startsWith('/')) return href;

  try {
    const parsed = new URL(href, 'https://example.invalid');
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) {
      return SAFE_PROTOCOLS.has(parsed.protocol) ? href : '';
    }
  } catch {
    return '';
  }

  return '';
}

function replaceMarkdownLinks(content, token) {
  let output = '';

  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== '[') {
      output += content[index];
      continue;
    }

    const labelEnd = content.indexOf(']', index + 1);
    if (labelEnd < 0 || content[labelEnd + 1] !== '(') {
      output += content[index];
      continue;
    }

    let depth = 0;
    let hrefEnd = -1;
    for (let cursor = labelEnd + 2; cursor < content.length; cursor += 1) {
      const char = content[cursor];
      if (char === '(') depth += 1;
      else if (char === ')') {
        if (depth === 0) {
          hrefEnd = cursor;
          break;
        }
        depth -= 1;
      }
    }

    if (hrefEnd < 0) {
      output += content[index];
      continue;
    }

    const label = content.slice(index + 1, labelEnd);
    const href = content.slice(labelEnd + 2, hrefEnd);
    const safeHref = safeExternalHref(href);
    if (!safeHref) output += token(escHtml(label));
    else {
      output += token(
        `<a href="${escAttribute(safeHref)}" target="_blank" rel="noopener noreferrer">${escHtml(label)}</a>`
      );
    }
    index = hrefEnd;
  }

  return output;
}

function renderInline(text) {
  const tokens = [];
  const token = (html) => {
    const marker = `@@TOKEN_${tokens.length}@@`;
    tokens.push(html);
    return marker;
  };

  let content = String(text ?? '');
  content = content.replace(/`([^`]+)`/g, (_, code) => token(`<code>${escHtml(code)}</code>`));
  content = replaceMarkdownLinks(content, token);

  let html = escHtml(content);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  return html.replace(/@@TOKEN_(\d+)@@/g, (_, index) => tokens[Number(index)] || '');
}

export function renderMarkdown(source) {
  if (!source) return '';

  const lines = String(source).split('\n');
  let html = '';
  let listTag = null;

  function closeList() {
    if (listTag) {
      html += `</${listTag}>`;
      listTag = null;
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (index === 0 && line.trim() === '---') {
      index += 1;
      while (index < lines.length && lines[index].trim() !== '---') index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)/);
    if (heading) {
      closeList();
      const depth = heading[1].length;
      html += `<h${depth}>${renderInline(heading[2])}</h${depth}>`;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      closeList();
      html += '<hr>';
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)/);
    if (unordered) {
      if (listTag !== 'ul') {
        closeList();
        html += '<ul>';
        listTag = 'ul';
      }
      html += `<li>${renderInline(unordered[1])}</li>`;
      continue;
    }

    const ordered = line.match(/^\d+\.\s+(.+)/);
    if (ordered) {
      if (listTag !== 'ol') {
        closeList();
        html += '<ol>';
        listTag = 'ol';
      }
      html += `<li>${renderInline(ordered[1])}</li>`;
      continue;
    }

    if (line.trim() === '') {
      closeList();
      continue;
    }

    closeList();
    html += `<p>${renderInline(line)}</p>`;
  }

  closeList();
  return html;
}
