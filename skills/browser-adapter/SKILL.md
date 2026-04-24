---
name: browser-adapter
description: Drive browsers (tabs, forms, clicks, navigation) through aos verbs. Trigger when a task requires reading or acting on web content — filling forms, extracting data, observing page state — and you want ref-based interaction that survives scroll.
---

# Browser Adapter

aos wraps `@playwright/cli` so browsers become targets for `aos see`, `aos do`, and `aos show`. The agent keeps using its familiar verbs; the adapter routes to `playwright-cli` under the hood.

## Setup

One-time:

```bash
npm install -g @playwright/cli@latest
```

Create a focus channel pointing at the user's running Chrome (primary co-presence mode):

```bash
aos focus create --id work --target browser://attach --extension
```

Or launch a fresh headed browser:

```bash
aos focus create --id bot --target browser://new --url https://example.com
```

The `<id>` you pick is both the aos focus channel id and the `playwright-cli -s=<id>` session name.

## Addressing

- `browser:<session>` — current tab of the session
- `browser:<session>/<ref>` — a specific element; refs come from `aos see capture browser:<session> --xray`
- Bare `browser:` resolves to `browser:$PLAYWRIGHT_CLI_SESSION` when the env var is set

## Common patterns

**Look at a page.**

```bash
aos see capture browser:work --xray
# Returns elements with role, title, ref. bounds is absent.
```

**Interact with an element.**

```bash
aos do click browser:work/e21
aos do fill browser:work/e34 "hello"
aos do key browser:work Enter
aos do navigate browser:work https://example.com
```

**Label elements visually.**

```bash
aos see capture browser:work --xray --label --out /tmp/labeled.png
# Slow: one eval call per ref to fetch bounds, then annotated PNG.
```

**Overlay a canvas on a page element (static v1).**

```bash
aos show create --id explainer --anchor-browser browser:work/e21 --offset 0,0,400,100 --html "<div>A tooltip</div>"
# Survives Chrome window movement; does NOT follow page scroll.
# Re-anchor after scroll: aos show update --id explainer --anchor-browser browser:work/e21
```

## Escape hatch

`playwright-cli` remains directly callable. Use it for primitives aos doesn't wrap in v1:
- `playwright-cli -s=work check e21` / `uncheck` / `select`
- `playwright-cli -s=work upload <file>`
- `playwright-cli -s=work tab-list` / `tab-select` / `tab-new`
- `playwright-cli -s=work tracing-start` / `video-start`
- `playwright-cli -s=work go-back` / `go-forward` / `reload`
- `playwright-cli -s=work run-code "<js>"` for arbitrary Playwright access

## Gotchas

- Refs are valid until the next structural DOM change. Re-snapshot if the page mutates.
- `show` anchoring requires a local visible browser window. Headless sessions and remote `--cdp=<url>` error with `BROWSER_HEADLESS` / `BROWSER_NOT_LOCAL`.
- Overlays do not follow scroll. Design for static anchors or re-issue `show update` on scroll.
- Multiple simultaneous `aos` invocations against one session serialize inside `playwright-cli`; aos does no additional coordination.

## See also
- Spec: `docs/superpowers/specs/2026-04-24-playwright-browser-adapter-design.md`
- Escape-hatch reference: https://github.com/microsoft/playwright-cli
