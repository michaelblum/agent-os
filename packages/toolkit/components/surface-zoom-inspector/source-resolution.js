export function resolveMarkdownSourceUrl(filePath = '', options = {}) {
  const value = String(filePath || '').trim()
  if (!value) return null
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) || value.startsWith('/')) return value

  const treeUrl = String(options.treeUrl || '').trim()
  try {
    const parsedTreeUrl = new URL(treeUrl)
    if (parsedTreeUrl.protocol === 'aos:' && parsedTreeUrl.host) {
      return `aos://${parsedTreeUrl.host}/${value.replace(/^\/+/, '')}`
    }
  } catch {
    // Fall through to the local import-relative fallback below.
  }

  const importMetaUrl = options.importMetaUrl || import.meta.url
  return new URL(`../../../../${value.replace(/^\/+/, '')}`, importMetaUrl).href
}
