function stripListMarker(line) {
  let columns = 0;
  let index = 0;
  while (index < line.length && (line[index] === ' ' || line[index] === '\t')) {
    columns += line[index] === '\t' ? 2 : 1;
    index += 1;
  }
  if (line[index] !== '-') return null;
  index += 1;
  while (index < line.length && (line[index] === ' ' || line[index] === '\t')) index += 1;
  return line.slice(index) ? { indent: Math.floor(columns / 2), body: line.slice(index) } : null;
}

function readQuoted(text, start) {
  let value = '';
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) { value += character; escaped = false; }
    else if (character === '\\') escaped = true;
    else if (character === '"') return { value, next: index + 1 };
    else value += character;
  }
  return null;
}

function closingBracket(text, start) {
  let quoted = false;
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) escaped = false;
    else if (quoted && character === '\\') escaped = true;
    else if (character === '"') quoted = !quoted;
    else if (!quoted && character === ']') return index;
  }
  return -1;
}

function inlineFields(text) {
  let title;
  const markers = {};
  const flags = new Set();
  for (let index = 0; index < text.length;) {
    if (text[index] === '"') {
      const quoted = readQuoted(text, index);
      if (quoted) { title ??= quoted.value; index = quoted.next; continue; }
    }
    if (text[index] === '[') {
      const close = closingBracket(text, index);
      if (close >= 0) {
        const inner = text.slice(index + 1, close).trim();
        const equals = inner.indexOf('=');
        if (equals < 0 && inner) flags.add(inner);
        else if (equals > 0) {
          const key = inner.slice(0, equals).trim();
          const raw = inner.slice(equals + 1).trim();
          const quoted = raw.startsWith('"') ? readQuoted(raw, 0) : null;
          markers[key] = quoted?.next === raw.length ? quoted.value : raw;
        }
        index = close + 1;
        continue;
      }
    }
    index += 1;
  }
  return { title, markers, flags };
}

export function parseSnapshotMarkdown(contents) {
  const elements = [];
  const stack = [];
  for (const line of String(contents).split('\n')) {
    const item = stripListMarker(line);
    if (!item) continue;
    const text = item.body.endsWith(':') ? item.body.slice(0, -1) : item.body;
    const match = text.match(/^(\S+)(?:\s+(.*))?$/u);
    if (!match || match[1].startsWith('/')) continue;
    const inline = inlineFields(match[2] || '');
    if (!/^[A-Za-z0-9_-]+$/u.test(inline.markers.ref ?? '')) continue;
    while (stack.length > 0 && stack.at(-1).indent >= item.indent) stack.pop();
    const element = {
      context_path: stack.map((parent) => parent.role),
      enabled: !inline.flags.has('disabled'),
      ref: inline.markers.ref,
      role: match[1],
    };
    if (inline.title !== undefined) element.title = inline.title;
    if (inline.markers.value !== undefined) element.value = inline.markers.value;
    elements.push(element);
    stack.push({ indent: item.indent, role: match[1] });
  }
  return elements;
}
