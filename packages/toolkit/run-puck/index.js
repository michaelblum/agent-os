import { emit, wireBridge } from '../runtime/bridge.js'
import { subscribe } from '../runtime/subscribe.js'
import { commandForHotkey } from './hotkeys.js'
import { commandLabel, menuCommandsForState, primaryCommandForState, viewForRunState } from './controls.js'

const state = {
  session_id: new URLSearchParams(location.search).get('session') || 'unknown',
  run_state: 'idle',
  menu_open: false,
}

function runControlEvent(command, source = 'puck') {
  const event = {
    type: 'run.control',
    event_id: `run-control-${source}-${Date.now()}`,
    session_id: state.session_id,
    command,
    source,
    at: new Date().toISOString(),
  }
  if (command === 'step') event.budget = 1
  return event
}

function sendCommand(command, source = 'puck') {
  emit('run.control', runControlEvent(command, source))
}

function render() {
  const view = viewForRunState(state.run_state)
  document.body.dataset.tone = view.tone
  document.querySelector('[data-role="state"]').textContent = view.label
  const primary = document.querySelector('[data-role="primary"]')
  const command = primaryCommandForState(state.run_state)
  primary.dataset.command = command
  primary.textContent = commandLabel(command)
  primary.title = commandLabel(command)

  const menu = document.querySelector('[data-role="menu"]')
  menu.hidden = !state.menu_open
  menu.innerHTML = ''
  for (const item of menuCommandsForState(state.run_state)) {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.command = item
    button.textContent = commandLabel(item)
    button.addEventListener('click', () => {
      state.menu_open = false
      sendCommand(item, 'puck')
      render()
    })
    menu.append(button)
  }
}

function install() {
  wireBridge((msg) => {
    if (msg?.type === 'run.state' || msg?.type === 'run-control.snapshot') {
      const payload = msg.payload ?? msg
      state.run_state = payload.state ?? payload.run_state ?? state.run_state
      state.session_id = payload.session_id ?? state.session_id
      render()
      return
    }

    const hotkeyCommand = commandForHotkey(msg, state.run_state)
    if (hotkeyCommand) {
      sendCommand(hotkeyCommand, 'hotkey')
      return
    }
  })
  subscribe(['run.state', 'run-control.snapshot', 'input_event'])

  document.querySelector('[data-role="primary"]').addEventListener('click', () => {
    sendCommand(primaryCommandForState(state.run_state), 'puck')
  })

  document.querySelector('[data-role="menu-toggle"]').addEventListener('click', () => {
    state.menu_open = !state.menu_open
    render()
  })

  document.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    state.menu_open = true
    render()
  })

  render()
  emit('manifest.ready', {
    name: 'run-puck',
    title: 'Run Puck',
    defaultSize: { w: 280, h: 74 },
  })
}

install()
