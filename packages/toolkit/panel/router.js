// router.js — manifest-prefix message dispatch.
//
// Hosts (Single, Tabs, etc.) install a router that maps incoming message types
// to the right content. Type prefix matches manifest.channelPrefix; on match,
// the prefix is stripped and the remainder is delivered to content.onMessage.
//
// Messages with no recognized prefix fall back to broadcast — every content
// with onMessage is given the chance to handle them. Contents can choose to
// ignore unknown types.

export function createRouter({ contents, hostByContent }) {
  // contents: array of Content objects
  // hostByContent: Map<Content, ContentHost>

  const byPrefix = new Map()
  for (const c of contents) {
    const prefix = c.manifest?.channelPrefix
    if (prefix) byPrefix.set(prefix, c)
  }

  return function route(msg) {
    if (!msg || typeof msg.type !== 'string') return
    const slash = msg.type.indexOf('/')
    if (slash > 0) {
      const prefix = msg.type.slice(0, slash)
      const rest = msg.type.slice(slash + 1)
      const content = byPrefix.get(prefix)
      if (content && typeof content.onMessage === 'function') {
        content.onMessage({ type: rest, payload: msg.payload }, hostByContent.get(content))
        return
      }
    }
    // No prefix or no match — broadcast to every content that has onMessage.
    for (const c of contents) {
      if (typeof c.onMessage === 'function') {
        c.onMessage(msg, hostByContent.get(c))
      }
    }
  }
}
