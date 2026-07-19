# Toolkit Status-Item Contract

`@agent-os/toolkit/status-item` exposes the product-neutral data contract for
the AOS-owned native status-item host. It contains no socket discovery, daemon
startup, consumer product policy, renderer implementation, or local asset
loading.

## Descriptor

`normalizeStatusItemDescriptor(value)` validates and canonicalizes
`aos.status_item.descriptor.v1`. Required fields are `owner`, `item_id`,
non-negative safe-integer `revision`, accessibility `label`, and
`primary_action_id`. Optional `help_text` and a maximum of 32 simple native menu
items are allowed.

Descriptors reject unknown fields, consumer icon/visual fields, scripts,
duplicate item/action ids, and a menu action that collides with the primary
action. The descriptor, event, and anchor JSON Schemas reject `..` sequences
to match the native host's identifier validation.
`normalizeStatusItemUpdateRequest(value)` validates an exact
owner/item/generation/current-revision compare-and-swap request and requires the
descriptor revision to advance.

## Anchor And Events

`normalizeStatusItemAnchor(value)` validates `aos.status_item.anchor.v1`. AOS
derives this anchor from the actual `NSStatusItem` button and owning display.
It carries a canonical owner/item anchor id, global display top-left bounds,
current display frame/visible frame, and at most 32 topology display ids.

`normalizeStatusItemEvent(value)` validates `aos.status_item.event.v1`. The
implemented event set is:

- `ready` after the native item and exact anchor are available;
- `bounds_changed` after an observed native status-item window move/resize;
- `topology_changed` after AppKit reports changed screen parameters;
- `primary_activation`, `secondary_activation`, and `menu_selection` from the
  native item.

Every event requires safe-integer generation/revision/sequence, timestamp,
source, bounds, and anchor. Activation events additionally require their
action/origin/modifier facts. Top-level bounds must equal anchor bounds.

## Lease Model

The CLI owner runs `aos status-item register --descriptor <file> --json
--follow`; that one connection owns lease lifetime and receives events. Its
registration result is delivered before the initial `ready` event. Separate
update, inspect, and invoke calls must present exact owner/item/generation and
current revision. Update requires a strictly newer descriptor and preserves the
original lease/event connection. Closing the follow process releases the item.
Standalone subscribe and cleanup commands do not exist.

The canonical daemon request schema types `register`, `update`, `inspect`,
`invoke`, and `invoke_dry_run`; the canonical event schema validates the status
item event payload and requires the envelope event name to match its `type`.
Dry-run invocation uses the daemon response status `dry_run`.

The AOS-owned monochrome icon is a continuity fallback, not a consumer visual.
Generic visual projection inside the real status-item button and the rich
status palette/popover are separate dependent contracts.

## Exports

- `STATUS_ITEM_DESCRIPTOR_SCHEMA_VERSION`
- `STATUS_ITEM_ANCHOR_SCHEMA_VERSION`
- `STATUS_ITEM_EVENT_SCHEMA_VERSION`
- `normalizeStatusItemDescriptor(value)`
- `normalizeStatusItemUpdateRequest(value)`
- `normalizeStatusItemAnchor(value)`
- `normalizeStatusItemEvent(value)`
- TypeScript descriptor, update request/result, menu, rect, bounds, anchor, and
  event interfaces

Authoritative schemas live in `shared/schemas/aos-status-item-*-v1.schema.json`.
Human-readable descriptor strings are canonical input: surrounding JSON
whitespace is rejected, and the schema's Unicode character limits are shared
by the toolkit and native host.
