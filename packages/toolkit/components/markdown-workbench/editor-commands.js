export function indentMarkdownSelection({
  value = '',
  selectionStart = 0,
  selectionEnd = selectionStart,
  indent = '  ',
} = {}) {
  const source = String(value ?? '');
  const start = Math.max(0, Math.min(source.length, Number(selectionStart) || 0));
  const end = Math.max(start, Math.min(source.length, Number(selectionEnd) || start));
  const lineStart = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const selection = source.slice(lineStart, end);
  const lines = selection.split('\n');
  const nextSelection = lines.map((line) => `${indent}${line}`).join('\n');
  const nextValue = `${source.slice(0, lineStart)}${nextSelection}${source.slice(end)}`;
  return {
    value: nextValue,
    selectionStart: start + indent.length,
    selectionEnd: end + (indent.length * lines.length),
  };
}

export function outdentMarkdownSelection({
  value = '',
  selectionStart = 0,
  selectionEnd = selectionStart,
  indent = '  ',
} = {}) {
  const source = String(value ?? '');
  const start = Math.max(0, Math.min(source.length, Number(selectionStart) || 0));
  const end = Math.max(start, Math.min(source.length, Number(selectionEnd) || start));
  const lineStart = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const selection = source.slice(lineStart, end);
  const lines = selection.split('\n');
  let removedBeforeStart = 0;
  let removedTotal = 0;
  let cursor = lineStart;
  const nextLines = lines.map((line) => {
    let removeCount = 0;
    if (line.startsWith(indent)) removeCount = indent.length;
    else if (line.startsWith('\t')) removeCount = 1;
    else if (line.startsWith(' ')) removeCount = 1;

    if (cursor < start) removedBeforeStart += Math.min(removeCount, start - cursor);
    removedTotal += removeCount;
    cursor += line.length + 1;
    return line.slice(removeCount);
  });

  const nextSelection = nextLines.join('\n');
  const nextValue = `${source.slice(0, lineStart)}${nextSelection}${source.slice(end)}`;
  return {
    value: nextValue,
    selectionStart: Math.max(lineStart, start - removedBeforeStart),
    selectionEnd: Math.max(lineStart, end - removedTotal),
  };
}
