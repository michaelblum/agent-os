import {
  compileSceneRadialMenuDefinition,
} from '../radial-menu.js'

const definition = {
  kind: 'aos.radial_menu_3d',
  schema_version: '2026-05-16',
  id: 'example.radial.main',
  close_on_select: true,
  geometry: {
    orientation: 'fixed',
    menuRadius: 1.8,
    handoffRadius: 2.25,
    reentryRadius: 1.85,
  },
  scene: {
    radius: 108,
    spreadDegrees: 120,
    startAngle: -90,
    style: {
      activeColor: '#ffffff',
      fillColor: '#201b2f',
      itemRadius: 22,
      opacity: 0.94,
    },
  },
  defaults: {
    three: {
      item: {
        hover: {
          progress: { approach: 'exponential', factor: 0.22 },
          transform: {
            scale: { from: 1, to: 1.35 },
            rotate: {
              spin: { axis: 'y', rate: 1.25 },
              degrees: { x: 5, y: 0, z: 3 },
            },
          },
        },
      },
    },
  },
  items: [
    {
      id: 'inspect',
      label: 'Inspect object',
      action: 'inspect',
      color: '#9b7cff',
      geometry: { type: 'procedural', implementation: 'example.radial.inspect' },
      effects: [{ ref: 'example.radial.halo', enabled: true }],
    },
    {
      id: 'move',
      label: 'Move object',
      action: 'move',
      color: '#53f5d7',
      geometry: { type: 'procedural', implementation: 'example.radial.move' },
    },
    {
      id: 'details',
      label: 'Show details',
      action: 'details',
      color: '#ffcf66',
      geometry: { type: 'procedural', implementation: 'example.radial.details' },
    },
  ],
}

const compiled = compileSceneRadialMenuDefinition(definition)
const runtimeJson = JSON.stringify(compiled.parameters)
const summary = {
  status: 'ok',
  contract: compiled.contract,
  menuId: compiled.parameters.menuId,
  runtimeItemIds: compiled.parameters.items.map(({ id }) => id),
  logicalActions: compiled.logicalItems.map(({ id, action }) => ({ id, action })),
  visualKinds: compiled.visualDefinition.items.map(({ id, geometry }) => ({
    id,
    kind: geometry?.type ?? null,
  })),
  gestureOrientation: compiled.gestureProjection.orientation ?? null,
  runtimePayloadContainsActions: runtimeJson.includes('action'),
  runtimePayloadContainsVisuals: runtimeJson.includes('geometry') || runtimeJson.includes('effects'),
}

process.stdout.write(`${JSON.stringify(summary, null, process.argv.includes('--json') ? 0 : 2)}\n`)
