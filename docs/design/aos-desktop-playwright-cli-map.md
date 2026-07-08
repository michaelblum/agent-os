# AOS Desktop Playwright CLI Map

Date: 2026-07-07

This is the M0 baseline for issue #587. It maps the current AOS command surface
to the "Playwright CLI, but for the desktop" product model without changing
runtime behavior.

## Current Readback

Authoritative sources for this map:

- `./aos help --json`
- `./aos skills list --json`
- `docs/api/aos.md`
- `docs/adr/0018-installable-aos-skills.md`
- `manifests/commands/source/aos/`

## Concept Map

| Playwright CLI concept | AOS desktop analogue |
| --- | --- |
| Browser/session | Focus channel, app/window/display target, or browser companion channel |
| Snapshot/screenshot | `aos see capture`, `--xray`, labels, regions, windows, and `--save` |
| Locator | Saved ref, native AX ref, canvas ref, browser ref, or coordinate fallback |
| Click/fill/type/key/hover/drag/scroll | `aos do ...` action matrix |
| Vision mode | Region capture, coordinate fallback, labels, xray, and canvas/visual proof |
| Capabilities | AOS capability groups in `docs/api/aos-capabilities.md` |
| Testing/assertions | Recapture, `aos see refs --diff`, `--expect`, gates, and Work Records |
| Skills | Installable AOS root skills plus upstream Playwright CLI companion skills |
| Trace/video/codegen | Upstream Playwright CLI escape hatch, not vendored by AOS |

## Current Strengths

| Area | Current AOS evidence |
| --- | --- |
| Readiness | `ready`, `status`, `doctor`, `permissions`, `service` |
| Discovery | `graph displays`, `graph windows`, `see list`, `see cursor`, `see selection` |
| Capture | `see capture`, `--window`, `--region`, `--canvas`, `--channel`, `--xray`, `--label`, `--save` |
| Locator-like refs | `see snapshots`, `see refs`, `ref:<snapshot-id>:<ref>`, browser/canvas/native saved-ref classes |
| Actions | `do click/hover/drag/scroll/type/key/fill/navigate`, `do press/focus/set-value`, `do raise/move/resize` |
| Sessions | `focus create/update/list/remove` |
| Browser companion | `aos-browser` skill and `aos skills companion check --name playwright-cli` |
| Evidence | `see refs --diff --expect`, `gate`, `work-record` read/verify/status/repair planning |

## Gap Table

| Gap | Type | Owner surface | Severity | Current action |
| --- | --- | --- | --- | --- |
| Missing public capability map | Capability-map gap | `docs/api/aos-capabilities.md` | High | Added as the M1 public map. |
| Desktop action inventory not public | Docs gap | `docs/api/aos-capabilities.md` | High | Added as the M2 inventory matrix. |
| No focused desktop/app/window skill | Skill wording gap | `skills/aos-desktop/` | High | Add installable skill. |
| No focused canvas/vision fallback skill | Skill wording gap | `skills/aos-canvas-vision/` | Medium | Add installable skill. |
| No focused focus/session lifecycle skill | Skill wording gap | `skills/aos-focus-sessions/` | Medium | Add installable skill. |
| No focused verification/assertion skill | Skill wording gap | `skills/aos-verification/` | High | Add installable skill. |
| App activate/quit/hide/unhide need command-truth coverage | Shipped as pid-scoped semantic `aos do` forms | `manifests/commands/source/aos/` and runtime adapter | Low | Keep dry-run/readback coverage current; use `aos do tell` only as explicit escape hatch for app-specific scripts. |
| Window close/minimize/maximize/restore need command-truth coverage; fullscreen remains deferred | Shipped exact-window `aos do` forms for close/minimize/maximize/restore | `manifests/commands/source/aos/` and runtime adapter | Medium | Keep fullscreen as a follow-up card seed until Space behavior is proven. |
| Space detection/switching is not first-class | Missing underlying primitive | native runtime + command manifest | High | Follow-up card seed; fail closed until TCC/Space behavior is proven. |
| Mission Control / app expose is not first-class | Missing stable global UI-mode readback | native runtime + command manifest | High | Keep unsupported until the command can prove before/after UI mode without relying on shortcuts alone. |
| Menu-item invocation needs command-truth coverage | Shipped as pid-scoped `aos do menu --path ...` | native AX/runtime adapter | Low | Keep dry-run path and enabled-leaf readback current. |
| Browser-only primitives can look like AOS scope | Boundary wording gap | `aos-browser` skill and capability map | High | Explicitly delegate network mocking, storage/auth state, console/eval, tracing, video, PDF, locator/test generation, test debugging, uploads, select/check/uncheck, navigation history, reload, and tab management to upstream Playwright CLI. |

## Follow-Up Card Seeds

These are explicit issue/card seeds under epic #587 plus maintenance notes for
the verbs that have graduated into first-class command truth.

| Card | Desired command shape | Fail-closed requirement |
| --- | --- | --- |
| Maintain semantic app lifecycle verbs | `aos do activate`, `quit`, `hide`, `unhide` | Dry-run must identify app, required permissions, and whether the action would affect the frontmost app. |
| Maintain semantic window lifecycle verbs | `aos do close`, `minimize`, `maximize`, `restore`; future `fullscreen-window` remains deferred | Must require a resolved pid/window id and report minimized/off-Space ambiguity before mutation. |
| Maintain menu item invocation | `aos do menu --pid <pid> --path File,Save` | Must validate the menu path and enabled state before dispatch. |
| Add Space readback before switching | `aos graph spaces` or `aos do switch-space --dry-run` | Must fail closed when macOS does not expose reliable current-Space identity. |
| Add Mission Control readback before showing global UI modes | `aos do show-mission-control --dry-run`, `aos do show-app-windows --pid <pid> --dry-run` | Must prove target UI mode before/after and provide a restore path. |

## Decision

For the first slice, keep `see` / `do` / `focus` / `show` as the stable
primitive model. Do not add a new `aos desktop` noun yet. The capability map and
skills should teach the desktop Playwright mental model first; any alias or
semantic verb should come after the inventory proves it can be represented in
manifests, help, parser gates, and fail-closed runtime behavior.

See `docs/design/aos-desktop-command-vocabulary-decision.md` for the M4
decision note.
