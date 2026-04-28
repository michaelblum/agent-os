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
  const backSelector = options.backSelector || '[data-stack-menu-back], [data-ctx-back]'
  const departingClass = options.departingClass || 'departing'
  const departingActiveClass = options.departingActiveClass || 'departing-active'
  const returningClass = options.returningClass || 'returning'
  const departingMs = Number(options.departingMs ?? 180)
  const listeners = []
  const departureTimers = new Map()
  const returningTimers = new Map()

  function markDeparting(cardId) {
    const card = byId(anchor, cardId)
    if (!card) return
    const prior = departureTimers.get(cardId)
    if (prior) clearTimeout(prior)
    card.classList.add(departingClass)
    card.classList.remove(departingActiveClass)
    card.style.zIndex = '30'
    requestAnimationFrame(() => {
      card.classList.add(departingActiveClass)
    })
    departureTimers.set(cardId, setTimeout(() => {
      card.classList.remove(departingClass, departingActiveClass)
      departureTimers.delete(cardId)
    }, departingMs))
  }

  function apply(priorState = null) {
    const nextState = model.snapshot()
    const returningDepth = priorState?.stack?.includes(nextState.activeId)
      ? priorState.stack.length - priorState.stack.lastIndexOf(nextState.activeId)
      : 0
    const returningCard = returningDepth > 0 ? byId(anchor, nextState.activeId) : null
    const returningStyle = returningCard ? stackMenuPushedStyle(returningDepth) : null

    applyStackMenuState(anchor, nextState, options)
    if (returningCard && returningStyle) {
      const prior = returningTimers.get(nextState.activeId)
      if (prior) clearTimeout(prior)
      returningCard.classList.add(returningClass)
      returningCard.style.opacity = returningStyle.opacity
      returningCard.style.filter = returningStyle.filter
      returningCard.style.zIndex = String(10 + (nextState.stack || []).length)
      requestAnimationFrame(() => {
        returningCard.style.opacity = ''
        returningCard.style.filter = ''
        returningCard.style.zIndex = String(10 + (nextState.stack || []).length)
      })
      returningTimers.set(nextState.activeId, setTimeout(() => {
        returningCard.classList.remove(returningClass)
        returningTimers.delete(nextState.activeId)
      }, departingMs))
    }
    if (
      priorState?.activeId
      && priorState.activeId !== nextState.activeId
      && !nextState.stack.includes(priorState.activeId)
    ) {
      markDeparting(priorState.activeId)
    }
    options.onChange?.(nextState)
  }

  function on(element, event, handler, opts) {
    element.addEventListener(event, handler, opts)
    listeners.push(() => element.removeEventListener(event, handler, opts))
  }

  function reset() {
    const prior = model.snapshot()
    model.reset(rootId)
    apply(prior)
  }

  function applySnapshot(state = {}) {
    const prior = model.snapshot()
    model.set(state)
    apply(prior)
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
    const prior = model.snapshot()
    model.push(cardId)
    apply(prior)
  }

  function popTo(cardId) {
    const prior = model.snapshot()
    model.popTo(cardId)
    apply(prior)
  }

  function pop() {
    const prior = model.snapshot()
    model.pop()
    apply(prior)
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

  asArray(anchor.querySelectorAll(backSelector)).forEach((button) => {
    on(button, 'click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      pop()
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
    pop,
    snapshot: model.snapshot,
    contains(target) {
      return anchor.contains(target)
    },
    isOpen() {
      return anchor.classList.contains(visibleClass)
    },
    destroy() {
      for (const timer of departureTimers.values()) clearTimeout(timer)
      departureTimers.clear()
      for (const timer of returningTimers.values()) clearTimeout(timer)
      returningTimers.clear()
      while (listeners.length) listeners.pop()()
    },
  }
}
