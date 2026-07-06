import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  OPERATOR_ANNOTATION_START_EVENT,
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
  },
]

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
  ]
  const projection = Buffer.from(JSON.stringify({
    schema_version: 'aos.operator-annotation-menu-projection.v0',
    experience_id: 'operator-fixture',
    surface_id: 'operator-fixture-surface',
    menu: projectedMenu,
  }), 'utf8').toString('base64url')
  const runtimeMenu = operatorAnnotationMenuFromLocation({
    search: `?aos_manifest_menu=${projection}`,
  })
  assert.deepEqual(runtimeMenu, projectedMenu)
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
