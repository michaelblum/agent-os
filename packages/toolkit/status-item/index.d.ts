export const STATUS_ITEM_DESCRIPTOR_SCHEMA_VERSION: 'aos.status_item.descriptor.v1'
export const STATUS_ITEM_EVENT_SCHEMA_VERSION: 'aos.status_item.event.v1'
export const STATUS_ITEM_ANCHOR_SCHEMA_VERSION: 'aos.status_item.anchor.v1'
export const STATUS_ITEM_INVOKE_ERROR_CODES: readonly [
  'INVALID_STATUS_ITEM_INVOKE',
  'STATUS_ITEM_NOT_FOUND',
  'STATUS_ITEM_UNAVAILABLE',
  'STATUS_ITEM_STALE_GENERATION',
  'STATUS_ITEM_STALE_REVISION',
  'STATUS_ITEM_STALE_ACTION_SEQUENCE',
  'STATUS_ITEM_ACTION_NOT_FOUND',
  'STATUS_ITEM_ACTION_DISABLED',
  'STATUS_ITEM_ANCHOR_UNAVAILABLE',
  'STATUS_ITEM_ACTION_SEQUENCE_EXHAUSTED',
  'STATUS_ITEM_EVENT_UNAVAILABLE',
]

export interface StatusItemMenuItem {
  kind: 'item'
  id: string
  action_id: string
  label: string
  enabled?: boolean
  state?: 'off' | 'on' | 'mixed'
  key_equivalent?: string
}

export interface StatusItemSeparator {
  kind: 'separator'
}

export interface StatusItemRect {
  x: number
  y: number
  width: number
  height: number
  origin_x: number
  origin_y: number
}

export interface StatusItemBounds extends StatusItemRect {
  display_id: number
}

export interface StatusItemAnchor {
  schema_version: typeof STATUS_ITEM_ANCHOR_SCHEMA_VERSION
  anchor_id: string
  host: 'native_status_item'
  coordinate_space: 'global_display_top_left'
  visible: true
  bounds: StatusItemBounds
  display: {
    id: number
    frame: StatusItemRect
    visible_frame: StatusItemRect
  }
  topology: {
    display_count: number
    display_ids: number[]
    truncated: boolean
  }
}

export interface StatusItemDescriptor {
  schema_version: typeof STATUS_ITEM_DESCRIPTOR_SCHEMA_VERSION
  owner: string
  item_id: string
  revision: number
  label: string
  help_text?: string
  primary_action_id: string
  menu: Array<StatusItemMenuItem | StatusItemSeparator>
}

export interface StatusItemUpdateRequest {
  owner: string
  item_id: string
  generation: number
  current_revision: number
  descriptor: StatusItemDescriptor
}

export interface StatusItemUpdateResult {
  status: 'ok'
  schema_version: typeof STATUS_ITEM_DESCRIPTOR_SCHEMA_VERSION
  owner: string
  item_id: string
  generation: number
  previous_descriptor_revision: number
  descriptor_revision: number
  updated: true
  anchor: StatusItemAnchor
  lease: { status: 'active'; cleanup: 'connection_scoped' }
}

export interface StatusItemInvokeRequest {
  owner: string
  item_id: string
  action_id: string
  generation: number
  descriptor_revision: number
  action_sequence: number
}

export interface StatusItemInspectState {
  schema_version: 'aos.status_item.inspect.v1'
  host: 'native_status_item'
  visible: boolean
  accessibility_label: string
  status: 'leased'
  owner: string
  item_id: string
  generation: number
  descriptor_revision: number
  action_sequence: number
  label: string
  primary_action_id: string
  menu_item_count: number
  bounds: StatusItemBounds
  anchor: StatusItemAnchor
}

export interface StatusItemInvocationResultBase {
  status: 'ok' | 'dry_run'
  owner: string
  item_id: string
  action_id: string
  generation: number
  descriptor_revision: number
  action_sequence: number
  bounds: StatusItemBounds
  anchor: StatusItemAnchor
}

export interface StatusItemPrimaryInvocationResult extends StatusItemInvocationResultBase {
  event_type: 'primary_activation'
  menu_item_id?: never
}

export interface StatusItemMenuInvocationResult extends StatusItemInvocationResultBase {
  event_type: 'menu_selection'
  menu_item_id: string
}

export type StatusItemInvocationResult = StatusItemPrimaryInvocationResult | StatusItemMenuInvocationResult

export interface StatusItemEventBase {
  schema_version: typeof STATUS_ITEM_EVENT_SCHEMA_VERSION
  owner: string
  item_id: string
  generation: number
  descriptor_revision: number
  sequence: number
  timestamp: string
  source: 'status_item'
  bounds: StatusItemBounds
  anchor: StatusItemAnchor
}

export interface StatusItemLifecycleEventBase extends StatusItemEventBase {
  action_sequence?: never
  action_id?: never
  menu_item_id?: never
  origin_x?: never
  origin_y?: never
  modifiers?: never
}

export interface StatusItemReadyEvent extends StatusItemLifecycleEventBase {
  type: 'ready'
}

export interface StatusItemBoundsChangedEvent extends StatusItemLifecycleEventBase {
  type: 'bounds_changed'
}

export interface StatusItemTopologyChangedEvent extends StatusItemLifecycleEventBase {
  type: 'topology_changed'
}

export type StatusItemLifecycleEvent = StatusItemReadyEvent | StatusItemBoundsChangedEvent | StatusItemTopologyChangedEvent

export interface StatusItemActionEventBase extends StatusItemEventBase {
  action_sequence: number
  origin_x: number
  origin_y: number
  modifiers: Array<'command' | 'option' | 'control' | 'shift'>
}

export interface StatusItemPrimaryActivationEvent extends StatusItemActionEventBase {
  type: 'primary_activation'
  action_id: string
  menu_item_id?: never
}

export interface StatusItemSecondaryActivationEvent extends StatusItemActionEventBase {
  type: 'secondary_activation'
  action_id?: never
  menu_item_id?: never
}

export interface StatusItemMenuSelectionEvent extends StatusItemActionEventBase {
  type: 'menu_selection'
  action_id: string
  menu_item_id: string
}

export type StatusItemActionEvent = StatusItemPrimaryActivationEvent | StatusItemSecondaryActivationEvent | StatusItemMenuSelectionEvent

export type StatusItemEvent = StatusItemLifecycleEvent | StatusItemActionEvent

export function normalizeStatusItemDescriptor(input: unknown): StatusItemDescriptor
export function normalizeStatusItemUpdateRequest(input: unknown): StatusItemUpdateRequest
export function normalizeStatusItemInvokeRequest(input: unknown): StatusItemInvokeRequest
export function normalizeStatusItemInvocationResult(input: unknown): StatusItemInvocationResult
export function normalizeStatusItemAnchor(input: unknown): StatusItemAnchor
export function normalizeStatusItemEvent(input: unknown): StatusItemEvent
