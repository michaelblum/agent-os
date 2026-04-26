import { DesktopWorldSurface2D, emit } from 'aos://toolkit/runtime/index.js'

const SURFACE_ID = window.__aosSurfaceCanvasId || 'dws-three-spike'
const STATE_CHANNEL = `dws-three-spike:${SURFACE_ID}`
const hud = document.getElementById('hud')

const surface = new DesktopWorldSurface2D({ canvasId: SURFACE_ID })
const channel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel(STATE_CHANNEL)
  : null

let scene
let camera
let renderer
let avatar
let beam
let topology = []
let worldBounds = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }
let sharedState = null
let renderFrames = 0
let sentFrames = 0
let receivedFrames = 0
let lastReceiveAt = 0
let lastMetricAt = 0
let latencies = []

function boundsFromSegment(segment) {
  const [x, y, w, h] = segment?.dw_bounds || [0, 0, window.innerWidth, window.innerHeight]
  return { x, y, w, h, maxX: x + w, maxY: y + h }
}

function unionBounds(segments) {
  if (!segments.length) return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }
  const rects = segments.map(boundsFromSegment)
  const minX = Math.min(...rects.map((r) => r.x))
  const minY = Math.min(...rects.map((r) => r.y))
  const maxX = Math.max(...rects.map((r) => r.maxX))
  const maxY = Math.max(...rects.map((r) => r.maxY))
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function percentile(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))
  return sorted[idx]
}

function report(type, extra = {}) {
  emit('dws_three_spike.metric', {
    surface_id: SURFACE_ID,
    segment_display_id: surface.segment?.display_id ?? null,
    segment_index: surface.segment?.index ?? null,
    role: surface.isPrimary ? 'primary' : 'follower',
    type,
    render_frames: renderFrames,
    sent_frames: sentFrames,
    received_frames: receivedFrames,
    median_latency_ms: percentile(latencies, 0.5),
    p95_latency_ms: percentile(latencies, 0.95),
    last_receive_age_ms: lastReceiveAt ? Date.now() - lastReceiveAt : null,
    ...extra,
  })
}

function setHud() {
  const s = surface.segment
  hud.textContent = [
    `surface ${SURFACE_ID}`,
    `segment ${s?.index ?? '?'} display ${s?.display_id ?? '?'}`,
    surface.isPrimary ? 'role primary' : 'role follower',
    `frames ${renderFrames}`,
    `sent ${sentFrames} recv ${receivedFrames}`,
    `p50 ${percentile(latencies, 0.5) ?? '-'}ms p95 ${percentile(latencies, 0.95) ?? '-'}ms`,
  ].join('\n')
}

function makeBox(width, height, color, opacity = 1) {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide,
  })
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, 1), material)
}

function rebuildScene() {
  const segmentBounds = boundsFromSegment(surface.segment)
  worldBounds = unionBounds(topology)

  if (!scene) {
    scene = new THREE.Scene()
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(window.devicePixelRatio || 1)
    document.body.appendChild(renderer.domElement)
  }

  scene.clear()

  camera = new THREE.OrthographicCamera(
    segmentBounds.x,
    segmentBounds.x + segmentBounds.w,
    segmentBounds.y,
    segmentBounds.y + segmentBounds.h,
    -1000,
    1000,
  )
  camera.position.z = 100
  camera.updateProjectionMatrix()

  beam = makeBox(worldBounds.w, 18, 0x30d5ff, 0.62)
  beam.position.set(worldBounds.x + worldBounds.w / 2, worldBounds.y + worldBounds.h / 2, -2)
  scene.add(beam)

  for (const segment of topology) {
    const b = boundsFromSegment(segment)
    const frame = makeBox(b.w, b.h, segment.index === 0 ? 0x68ff9a : 0xffcc55, 0.10)
    frame.position.set(b.x + b.w / 2, b.y + b.h / 2, -10)
    scene.add(frame)

    const seam = makeBox(3, b.h, 0xffffff, 0.34)
    seam.position.set(b.x, b.y + b.h / 2, -1)
    scene.add(seam)
  }

  avatar = new THREE.Mesh(
    new THREE.BoxGeometry(92, 92, 92),
    new THREE.MeshNormalMaterial(),
  )
  scene.add(avatar)
  resize()
}

function resize() {
  if (!renderer) return
  renderer.setSize(window.innerWidth, window.innerHeight, false)
}

function stateForTime(now) {
  const period = 6000
  const phase = (now % period) / period
  const sweep = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2)
  return {
    x: worldBounds.x + 80 + (worldBounds.w - 160) * sweep,
    y: worldBounds.y + worldBounds.h / 2,
    t: now,
    sent_at_epoch_ms: Date.now(),
  }
}

function applyState(state) {
  sharedState = state
  if (!avatar) return
  avatar.position.set(state.x, state.y, 32)
  avatar.rotation.x = state.t / 700
  avatar.rotation.y = state.t / 500
}

function publishState(state) {
  sentFrames += 1
  channel?.postMessage({ type: 'state', state })
}

channel?.addEventListener('message', (event) => {
  if (event.data?.type !== 'state' || surface.isPrimary) return
  const state = event.data.state
  receivedFrames += 1
  lastReceiveAt = Date.now()
  if (Number.isFinite(state?.sent_at_epoch_ms)) {
    latencies.push(Math.max(0, Date.now() - state.sent_at_epoch_ms))
    if (latencies.length > 240) latencies = latencies.slice(-240)
  }
  applyState(state)
})

function frame(now) {
  renderFrames += 1
  if (surface.isPrimary) {
    const next = stateForTime(now)
    applyState(next)
    publishState(next)
  } else if (!sharedState) {
    applyState(stateForTime(now))
  }

  renderer.render(scene, camera)
  setHud()

  if (performance.now() - lastMetricAt > 1000) {
    lastMetricAt = performance.now()
    report('tick', { broadcast_channel: !!channel })
  }
  requestAnimationFrame(frame)
}

await surface.start({
  onInit({ topology: nextTopology }) {
    topology = nextTopology
    rebuildScene()
    report('ready', { segment_count: topology.length, broadcast_channel: !!channel })
  },
  onTopologyChange({ topology: nextTopology }) {
    topology = nextTopology
    rebuildScene()
    report('topology_change', { segment_count: topology.length })
  },
  becamePrimary() {
    report('became_primary')
  },
  lostPrimary() {
    report('lost_primary')
  },
})

window.addEventListener('resize', resize)
requestAnimationFrame(frame)

