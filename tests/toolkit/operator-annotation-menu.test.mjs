import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LEGACY_MOUNTED_SURFACE_MENU_QUERY_PARAM,
  MOUNTED_SURFACE_MENU_PROJECTION_SCHEMA_VERSION,
  MOUNTED_SURFACE_MENU_QUERY_PARAM,
} from '../../packages/toolkit/contracts/mounted-surface-menu-projection.js'
import {
  OPERATOR_ANNOTATION_MENU_QUERY_PARAM,
} from '../../packages/toolkit/runtime/operator-annotation-menu-contract.js'
import {
  OPERATOR_ANNOTATION_START_EVENT,
  operatorAnnotationMenuFromProjection,
  operatorAnnotationMenuFromLocation,
  operatorAnnotationMenuRoutes,
  operatorAnnotationStatusMenuItems,
  routeOperatorAnnotationMenuAction,
} from '../../packages/toolkit/runtime/operator-annotation-menu.js'

const menu = [
  {
    id: 'annotate-visible-target',
    label: 'Annotate Visible Target',
    kind: 'operator_annotation',
    surface: 'operator-fixture-surface',
    action_id: 'aos.operator_fixture.annotation',
    mode: 'selection_annotation',
  },
    {
      id: 'settings',
      label: 'Settings',
      kind: 'future_tool',
      tool: 'settings',
      surface: 'operator-fixture-surface',
    },
  ]

function encodedProjection(overrides = {}) {
  return Buffer.from(JSON.stringify({
    schema_version: MOUNTED_SURFACE_MENU_PROJECTION_SCHEMA_VERSION,
    experience_id: 'operator-fixture',
    surface_id: 'operator-fixture-surface',
    menu,
    ...overrides,
  }), 'utf8').toString('base64url')
}

test('operator annotation menu entries project to native status menu descriptors', () => {
  assert.deepEqual(operatorAnnotationStatusMenuItems(menu), [
    {
      id: 'aos.operator_fixture.annotation',
      title: 'Annotate Visible Target',
      enabled: true,
      checked: false,
    },
  ])

  const routes = operatorAnnotationMenuRoutes(menu)
  assert.equal(routes.size, 1)
  assert.equal(routes.get('aos.operator_fixture.annotation').surface, 'operator-fixture-surface')
  assert.equal(routes.get('aos.operator_fixture.annotation').message_type, OPERATOR_ANNOTATION_START_EVENT)
})

test('operator annotation status menu action routes to the declared operator surface', () => {
  const posts = []
  const result = routeOperatorAnnotationMenuAction({
    type: 'status_item.menu_action',
    id: 'aos.operator_fixture.annotation',
    origin_x: 12,
    origin_y: 34,
    modifiers: ['option'],
  }, menu, {
    post(type, payload) {
      posts.push({ type, payload })
    },
  })

  assert.equal(result.handled, true)
  assert.equal(result.target, 'operator-fixture-surface')
  assert.equal(posts.length, 1)
  assert.equal(posts[0].type, 'canvas.send')
  assert.equal(posts[0].payload.target, 'operator-fixture-surface')
  assert.deepEqual(posts[0].payload.message, {
    type: OPERATOR_ANNOTATION_START_EVENT,
    source: 'status_item.menu_action',
    menu_item_id: 'annotate-visible-target',
    action_id: 'aos.operator_fixture.annotation',
    mode: 'selection_annotation',
    create_pending_annotation: true,
    origin_x: 12,
    origin_y: 34,
    modifiers: ['option'],
  })
})

test('operator annotation routing ignores unrelated status menu actions', () => {
  const posts = []
  const result = routeOperatorAnnotationMenuAction({
    type: 'status_item.menu_action',
    id: 'settings',
  }, menu, {
    post(type, payload) {
      posts.push({ type, payload })
    },
  })

  assert.deepEqual(result, {
    handled: false,
    reason: 'unknown_action_id',
    action_id: 'settings',
  })
  assert.deepEqual(posts, [])
})

test('operator annotation smoke surface reads menu projection from manifest-owned URL data', () => {
  const projectedMenu = [
    {
      id: 'annotate-runtime-target',
      label: 'Annotate Runtime Target',
      kind: 'operator_annotation',
      surface: 'operator-fixture-surface',
      action_id: 'aos.operator_fixture.runtime_annotation',
      mode: 'selection_annotation',
    },
    {
      id: 'runtime-settings',
      label: 'Runtime Settings',
      kind: 'future_tool',
      surface: 'operator-fixture-surface',
      tool: 'settings',
    },
  ]
  const projection = Buffer.from(JSON.stringify({
    schema_version: MOUNTED_SURFACE_MENU_PROJECTION_SCHEMA_VERSION,
    experience_id: 'operator-fixture',
    surface_id: 'operator-fixture-surface',
    menu: projectedMenu,
  }), 'utf8').toString('base64url')
  const runtimeMenu = operatorAnnotationMenuFromLocation({
    search: `?${MOUNTED_SURFACE_MENU_QUERY_PARAM}=${projection}`,
  }, { surfaceId: 'operator-fixture-surface' })
  assert.deepEqual(runtimeMenu, [projectedMenu[0]])
  assert.deepEqual(operatorAnnotationStatusMenuItems(runtimeMenu), [{
    id: 'aos.operator_fixture.runtime_annotation',
    title: 'Annotate Runtime Target',
    enabled: true,
    checked: false,
  }])
  assert.equal(
    operatorAnnotationMenuRoutes(runtimeMenu).get('aos.operator_fixture.runtime_annotation').surface,
    'operator-fixture-surface',
  )
})

test('operator annotation menu contract exports the current mounted-surface query name', () => {
  assert.equal(MOUNTED_SURFACE_MENU_QUERY_PARAM, 'aos_mounted_surface_menu')
  assert.equal(LEGACY_MOUNTED_SURFACE_MENU_QUERY_PARAM, 'aos_manifest_menu')
  assert.equal(OPERATOR_ANNOTATION_MENU_QUERY_PARAM, MOUNTED_SURFACE_MENU_QUERY_PARAM)
  assert.notEqual(OPERATOR_ANNOTATION_MENU_QUERY_PARAM, LEGACY_MOUNTED_SURFACE_MENU_QUERY_PARAM)
})

test('operator annotation runtime still accepts legacy mounted-surface query data internally', () => {
  const runtimeMenu = operatorAnnotationMenuFromLocation({
    search: `?${LEGACY_MOUNTED_SURFACE_MENU_QUERY_PARAM}=${encodedProjection()}`,
  }, { surfaceId: 'operator-fixture-surface' })

  assert.deepEqual(runtimeMenu, [menu[0]])
})

test('operator annotation projected menu fails closed for malformed or stale envelopes', () => {
  const invalidCases = [
    null,
    {},
    { schema_version: 'wrong', experience_id: 'operator-fixture', surface_id: 'operator-fixture-surface', menu },
    { schema_version: MOUNTED_SURFACE_MENU_PROJECTION_SCHEMA_VERSION, surface_id: 'operator-fixture-surface', menu },
    { schema_version: MOUNTED_SURFACE_MENU_PROJECTION_SCHEMA_VERSION, experience_id: 'operator-fixture', menu },
    { schema_version: MOUNTED_SURFACE_MENU_PROJECTION_SCHEMA_VERSION, experience_id: 'operator-fixture', surface_id: 'operator-fixture-surface', menu: {} },
  ]
  for (const projection of invalidCases) {
    assert.deepEqual(operatorAnnotationMenuFromProjection(projection), [])
  }
  assert.deepEqual(operatorAnnotationMenuFromLocation({
    search: `?${MOUNTED_SURFACE_MENU_QUERY_PARAM}=not-valid-base64`,
  }), [])
  assert.deepEqual(operatorAnnotationMenuFromLocation({
    search: `?${MOUNTED_SURFACE_MENU_QUERY_PARAM}=${Buffer.from('{not json', 'utf8').toString('base64url')}`,
  }), [])
  assert.deepEqual(operatorAnnotationMenuFromLocation({
    search: `?${MOUNTED_SURFACE_MENU_QUERY_PARAM}=${encodedProjection()}`,
  }, { surfaceId: 'stale-surface' }), [])
})

test('operator annotation projected menu refuses cross-surface routes from tampered URL data', () => {
  const runtimeMenu = operatorAnnotationMenuFromLocation({
    search: `?${MOUNTED_SURFACE_MENU_QUERY_PARAM}=${encodedProjection({
      menu: [{
        id: 'annotate-wrong-surface',
        label: 'Annotate Wrong Surface',
        kind: 'operator_annotation',
        surface: 'attacker-surface',
        action_id: 'aos.operator_fixture.annotation',
      }],
    })}`,
  })
  const posts = []
  const result = routeOperatorAnnotationMenuAction({
    type: 'status_item.menu_action',
    id: 'aos.operator_fixture.annotation',
  }, runtimeMenu, {
    post(type, payload) {
      posts.push({ type, payload })
    },
  })

  assert.deepEqual(runtimeMenu, [])
  assert.deepEqual(result, {
    handled: false,
    reason: 'unknown_action_id',
    action_id: 'aos.operator_fixture.annotation',
  })
  assert.deepEqual(posts, [])
})

test('operator annotation projected menu refuses arbitrary matching surface tampering when mounted surface is known', () => {
  const runtimeMenu = operatorAnnotationMenuFromLocation({
    search: `?${MOUNTED_SURFACE_MENU_QUERY_PARAM}=${encodedProjection({
      surface_id: 'attacker-surface',
      menu: [{
        id: 'annotate-attacker-surface',
        label: 'Annotate Attacker Surface',
        kind: 'operator_annotation',
        surface: 'attacker-surface',
        action_id: 'aos.operator_fixture.annotation',
      }],
    })}`,
  }, { surfaceId: 'operator-fixture-surface' })
  const posts = []
  const result = routeOperatorAnnotationMenuAction({
    type: 'status_item.menu_action',
    id: 'aos.operator_fixture.annotation',
  }, runtimeMenu, {
    post(type, payload) {
      posts.push({ type, payload })
    },
  })

  assert.deepEqual(runtimeMenu, [])
  assert.equal(result.handled, false)
  assert.deepEqual(posts, [])
})
