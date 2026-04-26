// stack-menu.js — generic deck-of-cards menu behavior.
//
// Styling belongs to the consuming app. This module only owns active/pushed
// card state, tab switching, push/pop, and outside-close wiring.

function asArray(value) {
  return Array.from(value || [])
}

function clearCardStyles(card) {
  if (!card?.style) return
  card.style.transform = ''
  card.style.opacity = ''
  card.style.zIndex = ''
  card.style.filter = ''
}

function byId(root, id) {
  if (!root || !id) return null
  if (globalThis.CSS?.escape) return root.querySelector(`#${CSS.escape(id)}`)
  return root.querySelector(`#${String(id).replace(/"/g, '\\"')}`)
}

export function stackMenuPushedStyle(depth) {
  const d = Math.max(1, Number(depth) || 1)
  return {
    transform: `scale(${Math.pow(0.9, d)}) translateY(${-20 * d}%)`,
    opacity: String(Math.max(0.2, 0.55 - (d - 1) * 0.15)),
    zIndex: String(10 - d),
    filter: `brightness(${Math.max(0.35, 0.7 - (d - 1) * 0.15)})`,
  }
}

export function createStackMenuModel({ rootId = 'root' } = {}) {
  let activeId = rootId
  let stack = []

  function snapshot() {
    return {
      rootId,
      activeId,
      stack: [...stack],
    }
  }

  return {
    snapshot,
    reset(nextRootId = rootId) {
      activeId = nextRootId
      stack = []
      return snapshot()
    },
    set(nextState = {}) {
      activeId = nextState.activeId || rootId
      stack = Array.isArray(nextState.stack) ? [...nextState.stack] : []
      return snapshot()
    },
    push(cardId) {
      if (!cardId || cardId === activeId) return snapshot()
      if (activeId) stack.push(activeId)
      activeId = cardId
      return snapshot()
    },
    popTo(cardId) {
      if (!cardId) return snapshot()
      if (activeId === cardId) return snapshot()
      const idx = stack.lastIndexOf(cardId)
      if (idx < 0) {
        activeId = rootId
        stack = []
        return snapshot()
      }
      activeId = cardId
      stack = stack.slice(0, idx)
      return snapshot()
    },
    pop() {
      const prior = stack.pop()
      activeId = prior || rootId
      return snapshot()
    },
  }
}

export function applyStackMenuState(anchor, state, options = {}) {
  if (!anchor || !state) return
  const cardSelector = options.cardSelector || '.stack-menu-card, .ctx-menu-card'
  const activeClass = options.activeClass || 'active'
  const pushedClass = options.pushedClass || 'pushed'
  const cards = asArray(anchor.querySelectorAll(cardSelector))
  const stack = state.stack || []
  const pushed = new Set(stack)

  for (const card of cards) {
    const id = card.id
    clearCardStyles(card)
    card.classList.toggle(activeClass, id === state.activeId)
    card.classList.toggle(pushedClass, pushed.has(id))
  }

  const n = stack.length
  stack.forEach((id, index) => {
    const card = byId(anchor, id)
    if (!card) return
    const depth = n - index
    Object.assign(card.style, stackMenuPushedStyle(depth))
  })

  const active = byId(anchor, state.activeId)
  if (active) active.style.zIndex = String(10 + n)
}

export function createStackMenu(anchor, options = {}) {
  if (!anchor) throw new Error('createStackMenu: anchor is required')

  const rootId = options.rootId || anchor.querySelector('.ctx-menu-card, .stack-menu-card')?.id || 'root'
  const model = createStackMenuModel({ rootId })
  const visibleClass = options.visibleClass || 'visible'
  const triggerSelector = options.triggerSelector || '[data-stack-menu-open], [data-ctx-open]'
  const triggerAttr = options.triggerAttr || 'stackMenuOpen'
  const legacyTriggerAttr = options.legacyTriggerAttr || 'ctxOpen'
  const tabSelector = options.tabSelector || '[data-stack-menu-tab], [data-ctx-tab]'
  const tabAttr = options.tabAttr || 'stackMenuTab'
  const legacyTabAttr = options.legacyTabAttr || 'ctxTab'
  const tabPanelSelector = options.tabPanelSelector || '.stack-menu-panel, .ctx-panel'
  const tabActiveClass = options.tabActiveClass || 'active'
  const listeners = []

  function apply() {
    applyStackMenuState(anchor, model.snapshot(), options)
    options.onChange?.(model.snapshot())
  }

  function on(element, event, handler, opts) {
    element.addEventListener(event, handler, opts)
    listeners.push(() => element.removeEventListener(event, handler, opts))
  }

  function reset() {
    model.reset(rootId)
    apply()
  }

  function applySnapshot(state = {}) {
    model.set(state)
    apply()
  }

  function open(position = {}) {
    if (Number.isFinite(position.x)) anchor.style.left = `${Math.round(position.x)}px`
    if (Number.isFinite(position.y)) anchor.style.top = `${Math.round(position.y)}px`
    anchor.classList.add(visibleClass)
    reset()
    options.onOpen?.(model.snapshot())
  }

  function close(reason = 'close') {
    anchor.classList.remove(visibleClass)
    reset()
    options.onClose?.(reason)
  }

  function openCard(cardId) {
    model.push(cardId)
    apply()
  }

  function popTo(cardId) {
    model.popTo(cardId)
    apply()
  }

  asArray(anchor.querySelectorAll(triggerSelector)).forEach((trigger) => {
    on(trigger, 'click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      openCard(trigger.dataset[triggerAttr] || trigger.dataset[legacyTriggerAttr])
    })
  })

  asArray(anchor.querySelectorAll(tabSelector)).forEach((tab) => {
    on(tab, 'click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      reset()
      const target = tab.dataset[tabAttr] || tab.dataset[legacyTabAttr]
      asArray(anchor.querySelectorAll(tabSelector)).forEach((entry) => {
        entry.classList.toggle(tabActiveClass, entry === tab)
      })
      asArray(anchor.querySelectorAll(tabPanelSelector)).forEach((panel) => {
        panel.classList.toggle(tabActiveClass, panel.id === target)
      })
      options.onTab?.(target)
    })
  })

  asArray(anchor.querySelectorAll(options.cardSelector || '.stack-menu-card, .ctx-menu-card')).forEach((card) => {
    on(card, 'click', (event) => {
      if (!card.classList.contains(options.pushedClass || 'pushed')) return
      event.preventDefault()
      event.stopPropagation()
      popTo(card.id)
    })
  })

  apply()

  return {
    open,
    close,
    reset,
    applySnapshot,
    openCard,
    popTo,
    snapshot: model.snapshot,
    contains(target) {
      return anchor.contains(target)
    },
    isOpen() {
      return anchor.classList.contains(visibleClass)
    },
    destroy() {
      while (listeners.length) listeners.pop()()
    },
  }
}
