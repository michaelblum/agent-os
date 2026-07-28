# Desktop Pixel Native Baseline Evidence

Status: historical validation evidence, not a standing runtime guarantee.

## Tested State

- AOS source revision: `eb9010c0672b759b79f47ace4dcf4396a8d224ec`
- Base revision: `280433cf`
- Date: 2026-07-28
- Active displays: 2
- Capture and presentation: in memory only
- Permission state: existing Screen Recording authorization, explicitly approved

The raw repository binary was rebuilt from the tested source. The immediately
following `./aos help --json` checkpoint exited successfully. The live proof ran
only after permission readback and with the repo daemon stopped.

## Results

| Host | Result | Trigger to visible | Display skew | Oldest frame age |
| --- | --- | ---: | ---: | ---: |
| Standalone control | passed | 18.08 ms | 2.56 ms | 22.33 ms |
| DesktopWorld native sheet | passed | 12.91 ms | 2.30 ms | 21.60 ms |

The DesktopWorld result resolved `io.agent-os::native-sheet/main`, reported
canvas generation 1 and topology generation 1, and presented one coordinated
native segment on each display.

Both runs reported:

- no daemon, scene protocol, or desktop-pixel broker use;
- no public pixel exposure or captured-pixel persistence;

The pre-hardening executable also reported zero retained frames, textures,
geometry buffers, views, windows, sheets, pending retirements, and shared GPU
resources. Those cleanup counters did not yet wait for authoritative
ScreenCaptureKit stop settlement, so they are not final disposal evidence. The
corrected head must repeat this native checkpoint and independently report zero
unsettled capture streams before publication.

## Scope

This is one supervised machine result. It proves the native baseline and the
first DesktopWorld hosting increment on the tested head; it is not a latency
distribution, release acceptance result, or proof of a consumer effect API.
Static regression coverage owns source shape, full Swift typechecking, bounded
geometry, runtime Metal shader compilation, manifest routing, and cleanup
contracts. Future layers must preserve this native proof rather than infer it
from static tests.
