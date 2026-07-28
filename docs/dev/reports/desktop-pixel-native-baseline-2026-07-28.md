# Desktop Pixel Native Baseline Evidence

Status: supervised validation evidence, not a standing runtime guarantee.

## Corrected-Head Validation

- Tested tree before this evidence-only update: `adcc162e`
- Native executable source revision: `d9c65fc9`
- Runtime-read command manifest revision: `adcc162e`
- Base revision: `280433cf`
- Date: 2026-07-28
- Active displays: 2
- Capture and presentation: in memory only
- Permission state: existing Screen Recording authorization, explicitly approved

The raw repository binary was rebuilt from `d9c65fc9`. The build exited zero,
the required untouched 15-second pause completed, and the immediately following
`./aos help --json` checkpoint exited zero. The native lifecycle implementation
did not change after that build. `adcc162e` changed only the runtime-read
external command manifest so the public command uses the existing
signal-forwarding stdio path; it did not require another binary or TCC cycle.
The live proof ran only after all five permissions and `ready=true` were read
back from the daemon, then the exact repo service was stopped.

## Results

| Host | Result | Trigger to visible | Display skew | Oldest frame age |
| --- | --- | ---: | ---: | ---: |
| Standalone control | passed | 11.35 ms | 1.91 ms | 15.83 ms |
| DesktopWorld native sheet | passed | 26.96 ms | 4.87 ms | 44.30 ms |

The DesktopWorld result resolved `io.agent-os::native-sheet/main`, reported
canvas generation 1 and topology generation 1, and presented one coordinated
native segment on each display.

Both runs reported:

- no daemon, scene protocol, or desktop-pixel broker use;
- no public pixel exposure or captured-pixel persistence;
- zero retained capture streams, frames, textures, geometry buffers, views,
  windows, sheets, pending retirements, and shared GPU resources after cleanup.

The public DesktopWorld command was also interrupted with `SIGINT` after its
sheet became visible. It exited 130 with
`DESKTOP_PIXEL_BASELINE_CANCELED` and reported the same complete set of zero
retained-resource counters. A pre-correction reproduction showed why the
manifest change was necessary: buffered external dispatch let SIGINT kill the
public parent before the child could return its cleanup evidence. The hidden
native route already settled correctly; `adcc162e` restores that behavior to
the supported public command and adds a manifest regression.

## Historical Pre-Hardening Result

Revision `eb9010c0672b759b79f47ace4dcf4396a8d224ec` previously measured
18.08 ms / 2.56 ms for the standalone host and 12.91 ms / 2.30 ms for the
DesktopWorld host. Its zero-cleanup counters predated authoritative
ScreenCaptureKit stop settlement and are retained only as historical timing
evidence. The corrected-head results above supersede its disposal claims.

## Scope

This is one supervised machine result. It proves the native baseline and the
first DesktopWorld hosting increment on the tested head; it is not a latency
distribution, release acceptance result, or proof of a consumer effect API.
Static regression coverage owns source shape, full Swift typechecking, bounded
geometry, runtime Metal shader compilation, manifest routing, and cleanup
contracts. Future layers must preserve this native proof rather than infer it
from static tests.
