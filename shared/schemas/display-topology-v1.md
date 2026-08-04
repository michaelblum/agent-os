# Display Topology Identity

**Schema:** `aos.display-topology.v1`
**File:** `display-topology-v1.schema.json`
**Producers:** `aos see list`, explicit or interactively selected region capture

## Contract

`display_topology` is one immutable observation of the active-display mapping.
The producer freezes it before resolving or interactively selecting a region.
That same value drives display lookup, segmentation, capture scale, per-display
cropping, stitching, the direct capture response, and the optional perception topology.
`aos see list` also observes once and builds its dynamic spatial topology from
that exact snapshot. There is no post-capture recomputation or second display
enumeration.

The object is closed. It contains:

- schema and content identity;
- whether any member had to use a runtime display-ID fallback;
- the separate-Spaces mapping fact;
- the native origin used to construct DesktopWorld;
- native full and visible union bounds;
- DesktopWorld full and visible union bounds; and
- canonically ordered member mapping facts: ordinal, main status, member
  identity, native and DesktopWorld full/visible bounds, scale, and normalized
  rotation.

An explicit `--region` or bounds-only `--interactive` region response exposes
this object directly even without `--perception`. The interactive overlay uses
the frozen target-display geometry, returns only local selection bounds, and
the real pixels follow the same validated region segmentation/capture/stitch
path; it neither enumerates screens again nor captures an image itself. When
perception is requested,
`perceptions[].topology.display_topology` is the same frozen value. The capture
`state_id` remains a new per-capture correlation handle; it is neither derived
from nor interchangeable with `display_topology.identity`.

## Capture-provider alignment boundary

The live builder admits the observation only when every active CoreGraphics
display has exactly one `NSScreen` source. Missing or duplicate mappings fail
closed; visible bounds, label, and backing scale are never synthesized.

ScreenCaptureKit content and the CoreGraphics/AppKit observation are separate
framework reads. Before any selected full-display capture, the producer creates
each `SCContentFilter` once and requires unique selected membership plus exact
agreement for display ID, frame, width/height in points, and the filter's
`pointPixelScale`. The admitted filter is retained for capture rather than
recreated. Output size is the exact integer conversion of the frozen point
geometry times that validated scale; fractional or unrepresentable dimensions
fail closed. The returned full-display `CGImage` must have those exact pixel
dimensions before any crop or stitch.

This validation detects every mismatch exposed by those framework values, but
it does not claim an atomic framework generation. ScreenCaptureKit does not
expose the display UUID, visible bounds, rotation, or a generation token. A
change that preserves all exposed values can therefore remain unobservable at
this seam. That limitation does not weaken or create another topology identity:
the published identity still names only the admitted frozen CoreGraphics/AppKit
observation.

## Member identity and order

A usable `CGDisplayCreateUUIDFromDisplayID` value is normalized to lowercase
RFC 4122 text and encoded as:

```json
{ "kind": "display_uuid", "display_uuid": "11111111-2222-4333-8444-555555555555" }
```

If the UUID is missing or appears on more than one observed member, every
affected member uses the explicit fallback:

```json
{ "kind": "display_id_fallback", "display_id_fallback": 202 }
```

Runtime display IDs are excluded for UUID-backed members. They participate only
when the fallback is public. Duplicate runtime display IDs, zero or multiple
main displays, malformed provided UUIDs, non-finite values, non-positive full
bounds, negative visible bounds sizes, and non-positive scales are rejected.

Canonical member order is:

1. main display first;
2. native full-bounds `minX`;
3. native full-bounds `minY`; and
4. member identity (UUID raw bytes before fallback IDs, then ascending bytes or
   integer).

Ordinals are assigned after sorting. Rotation is normalized into `[0, 360)`.
Every signed zero in included numeric facts is normalized to positive zero.

## Content identity

`identity` is `sha256:` followed by 64 lowercase hexadecimal characters. The
SHA-256 input begins with the exact domain bytes
`AOS_DISPLAY_TOPOLOGY_ID_V1\0`, then the typed binary payload below. Container
lengths and integers are unsigned 32-bit big-endian. Doubles are finite IEEE
754 binary64 bit patterns in big-endian order. UUIDs are their raw 16 bytes.

| Encoding | Bytes |
| --- | --- |
| Boolean | `0x01`, then `0x00` or `0x01` |
| Unsigned integer | `0x02`, then UInt32 big-endian |
| Double | `0x03`, then normalized binary64 big-endian |
| UUID | `0x04`, then 16 raw UUID bytes |
| Record | `0x10`, then UInt32 field count, then ordered fields |
| Array | `0x11`, then UInt32 member count, then ordered members |
| UUID identity variant | `0x20`, then UUID encoding |
| Display-ID fallback variant | `0x21`, then unsigned-integer encoding |

The top record has eight fields in this order:

1. `uses_display_id_fallback`
2. `screens_have_separate_spaces`
3. `desktop_world_origin_native` as a two-field `x,y` record
4. `native_bounds` as a four-field `x,y,width,height` record
5. `native_visible_bounds` in the same order
6. `desktop_world_bounds` in the same order
7. `visible_desktop_world_bounds` in the same order
8. the display array, including its display count

Each display record has nine fields: ordinal, `is_main`, member identity,
native bounds, native visible bounds, DesktopWorld bounds, visible DesktopWorld
bounds, scale factor, and rotation. This includes every public mapping fact and
no dynamic perception fact.

Equal included facts therefore produce the same identity across process
restarts. Hotplug, main/ordinal reorder, fallback ID changes, scale, rotation,
origin, or any full/visible bounds change rotates it. Timestamps, cursors,
windows, apps, focus, labels, and UUID-backed runtime display IDs do not.

## DesktopWorld lifecycle generation is separate

DesktopWorld `topologyGeneration` / `topology_generation` is independently
scoped to a canvas and its lifecycle. It is non-content-addressed,
non-persistent, and not comparable across canvas lifecycles or processes. It is
not atomically correlated with `aos.display-topology.v1` and must never be used
as, compared with, or inferred from this content identity.
