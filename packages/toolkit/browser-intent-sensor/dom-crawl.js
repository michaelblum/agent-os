export function descriptorFromElement(element, options = {}) {
  if (!element || typeof element !== 'object') return null
  const rect = element.getBoundingClientRect?.()
  const text = textExcerpt(element.textContent ?? element.value ?? '')
  const role = element.getAttribute?.('role') || implicitRole(element)
  const name = accessibleName(element) || text
  const selector = cssPath(element)
  const ref = options.refResolver?.(element) ?? element.getAttribute?.('data-aos-ref') ?? null

  return {
    ...(ref ? { ref } : {}),
    ...(role ? { role } : {}),
    ...(name ? { name } : {}),
    ...(text ? { text } : {}),
    ...(selector ? { selector } : {}),
    ...(rect ? { rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } } : {}),
  }
}

export function elementsInsideRect(root, rect) {
  const bounds = normalizeRect(rect)
  if (!root?.querySelectorAll || !bounds) return []
  const elements = [...root.querySelectorAll('a,button,input,textarea,select,[role],h1,h2,h3,h4,h5,h6,p,img')]
  return elements.filter((element) => {
    const r = element.getBoundingClientRect?.()
    if (!r) return false
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    return cx >= bounds.x
      && cy >= bounds.y
      && cx <= bounds.x + bounds.width
      && cy <= bounds.y + bounds.height
  })
}

export function containedDescriptors(root, rect, options = {}) {
  return elementsInsideRect(root, rect)
    .map((element, index) => descriptorFromElement(element, {
      ...options,
      refResolver: options.refResolver ?? (() => `contained_${index + 1}`),
    }))
    .filter(Boolean)
}

function normalizeRect(rect) {
  if (!rect) return null
  const x = Number(rect.x)
  const y = Number(rect.y)
  const width = Number(rect.width ?? rect.w)
  const height = Number(rect.height ?? rect.h)
  if (![x, y, width, height].every(Number.isFinite)) return null
  return { x, y, width, height }
}

function textExcerpt(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
}

function accessibleName(element) {
  return element.getAttribute?.('aria-label')
    || element.getAttribute?.('alt')
    || element.getAttribute?.('title')
    || element.getAttribute?.('placeholder')
    || ''
}

function implicitRole(element) {
  const tag = element.tagName?.toLowerCase()
  if (tag === 'a' && element.getAttribute?.('href')) return 'link'
  if (tag === 'button') return 'button'
  if (tag === 'input') return inputRole(element.getAttribute?.('type'))
  if (/^h[1-6]$/.test(tag)) return 'heading'
  if (tag === 'img') return 'img'
  return null
}

function inputRole(type) {
  switch ((type ?? 'text').toLowerCase()) {
    case 'button':
    case 'submit':
    case 'reset':
      return 'button'
    case 'checkbox':
      return 'checkbox'
    case 'radio':
      return 'radio'
    default:
      return 'textbox'
  }
}

function cssPath(element) {
  if (!element?.tagName) return null
  if (element.id) return `#${cssEscape(element.id)}`
  const parts = []
  let current = element
  while (current && current.nodeType === 1 && parts.length < 4) {
    const tag = current.tagName.toLowerCase()
    const name = current.getAttribute?.('name')
    const dataTestId = current.getAttribute?.('data-testid')
    if (dataTestId) {
      parts.unshift(`${tag}[data-testid="${cssAttrEscape(dataTestId)}"]`)
      break
    }
    if (name) {
      parts.unshift(`${tag}[name="${cssAttrEscape(name)}"]`)
      break
    }
    const parent = current.parentElement
    if (!parent) {
      parts.unshift(tag)
      break
    }
    const siblings = [...parent.children].filter((child) => child.tagName === current.tagName)
    const index = siblings.indexOf(current) + 1
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag)
    current = parent
  }
  return parts.join(' > ')
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value)
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`)
}

function cssAttrEscape(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
