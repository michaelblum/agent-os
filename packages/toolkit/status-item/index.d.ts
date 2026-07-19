export const STATUS_ITEM_DESCRIPTOR_SCHEMA_VERSION: 'aos.status_item.descriptor.v1'
export const STATUS_ITEM_EVENT_SCHEMA_VERSION: 'aos.status_item.event.v1'
export const STATUS_ITEM_ANCHOR_SCHEMA_VERSION: 'aos.status_item.anchor.v1'

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

export interface StatusItemEvent {
  schema_version: typeof STATUS_ITEM_EVENT_SCHEMA_VERSION
  type: 'ready' | 'bounds_changed' | 'topology_changed' | 'primary_activation' | 'secondary_activation' | 'menu_selection'
  owner: string
  item_id: string
  generation: number
  descriptor_revision: number
  sequence: number
  timestamp: string
  source: 'status_item'
  action_id?: string
  menu_item_id?: string
  origin_x?: number
  origin_y?: number
  modifiers?: Array<'command' | 'option' | 'control' | 'shift'>
  bounds: StatusItemBounds
  anchor: StatusItemAnchor
}

export function normalizeStatusItemDescriptor(input: unknown): StatusItemDescriptor
export function normalizeStatusItemUpdateRequest(input: unknown): StatusItemUpdateRequest
export function normalizeStatusItemAnchor(input: unknown): StatusItemAnchor
export function normalizeStatusItemEvent(input: unknown): StatusItemEvent
