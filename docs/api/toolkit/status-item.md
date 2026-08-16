# Toolkit Status-Item Contract

`@agent-os/toolkit/status-item` exposes the product-neutral data contract for
the AOS-owned native status-item host. It contains no socket discovery, daemon
startup, consumer product policy, renderer implementation, or local asset
loading.

> **Transition pointer — `aos-sovereign-capability-substrate-v1`:** this file
> remains the implemented status-item lease and invocation contract. ADR 0043
> and `../../dev/aos-sovereign-capability-authority-v1.json` own the future
> product-neutral operation-control direction. AOS owns the future neutral
> active-operation/recording projection through this host; Sigil owns product
> labels and action policy. That control plane and projection do not exist yet
> and will not be smuggled into status-item identity.

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
`normalizeStatusItemInvokeRequest(value)` requires exact
owner/item/action/generation/revision identity plus the current positive
`action_sequence` obtained from inspect.
`normalizeStatusItemInvocationResult(value)` validates the complete success or
dry-run shape, including exact identity, accepted action sequence, event type,
bounds, and anchor. `STATUS_ITEM_INVOKE_ERROR_CODES` is the closed set of
daemon error codes accepted by the public invoke client; an incomplete success
or an unknown error code is a daemon protocol failure. Invocation results are
discriminated by `event_type`: `menu_selection` requires `menu_item_id`, while
`primary_activation` forbids it.

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
source, bounds, and anchor. Action event variants require their exact
action/origin/modifier facts and admitted `action_sequence`: menu selection
requires `menu_item_id`, primary activation forbids it, and secondary activation
forbids both action and menu identity. Lifecycle events reject all action-only
fields. Top-level bounds must equal anchor bounds. The all-event
`sequence` preserves stream order, while `(generation, action_sequence)` is the
stable action replay identity.

## Lease Model

The CLI owner runs `aos status-item register --descriptor <file> --json
--follow`; that one connection owns lease lifetime and receives events. Its
registration result is delivered before the initial `ready` event. Separate
update, inspect, and invoke calls must present exact owner/item/generation and
current revision. Inspect also returns the current action sequence. Effectful
invoke must present that sequence and atomically consumes it before event
delivery; dry-run validates and reports it without consuming. Native clicks
and programmatic invokes share the allocator. Descriptor updates preserve the
sequence, a new lease generation resets it, and failed delivery leaves the
reserved sequence consumed. A rendered native menu row retains its generation,
descriptor revision, item id, action id, and enabled state; selection is
discarded without admission if any binding is stale or disabled. At sequence
exhaustion, dry-run and effectful invoke return the same typed error without
emitting or changing state. Closing the follow process releases the item.
Standalone subscribe and cleanup commands do not exist.

Invoke validates the original envelope `data` object before generic daemon
envelope shaping. Its key set is exact; caller-supplied `action`,
`__envelope_ref`, and `__envelope_active` are invalid invoke data and never
reach action admission.

The canonical daemon request schema types `register`, `update`, `inspect`,
`invoke`, and `invoke_dry_run`; the canonical event schema validates the status
item event payload and requires the envelope event name to match its `type`.
`aos-status-item-invocation-result-v1.schema.json` owns the complete invocation
success payload. Dry-run invocation uses the daemon response status `dry_run`.

The AOS-owned monochrome icon is a continuity fallback, not a consumer visual.
Generic visual projection inside the real status-item button and the rich
status palette/popover are separate dependent contracts.

## Exports

- `STATUS_ITEM_DESCRIPTOR_SCHEMA_VERSION`
- `STATUS_ITEM_ANCHOR_SCHEMA_VERSION`
- `STATUS_ITEM_EVENT_SCHEMA_VERSION`
- `STATUS_ITEM_INVOKE_ERROR_CODES`
- `normalizeStatusItemDescriptor(value)`
- `normalizeStatusItemUpdateRequest(value)`
- `normalizeStatusItemInvokeRequest(value)`
- `normalizeStatusItemInvocationResult(value)`
- `normalizeStatusItemAnchor(value)`
- `normalizeStatusItemEvent(value)`
- TypeScript descriptor, update/invoke request and result, inspect state, menu,
  rect, bounds, anchor, and event interfaces

Authoritative schemas live in `shared/schemas/aos-status-item-*-v1.schema.json`.
Human-readable descriptor strings are canonical input: surrounding JSON
whitespace is rejected, and the schema's Unicode character limits are shared
by the toolkit and native host.
