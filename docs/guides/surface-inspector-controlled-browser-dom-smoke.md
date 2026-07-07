# Surface Inspector Controlled Browser DOM Smoke

Use this bounded path to verify Browser DOM Element Picker targets inside
Surface Inspector without opening live websites.

1. From the repo root, run:

   ```bash
   node scripts/browser-dom-element-picker-surface-smoke.mjs --stdout
   ```

2. Confirm the JSON reports:
   - `local_fixture_only: true`
   - `late_attach_replayed: true`
   - `hero_card_projectable: true`
   - `offscreen_revealed: true`
   - `tooling_dom_not_published: true`

3. For a supervised AOS check, launch the controlled fixture publisher and
   Surface Inspector in that order. The only supported page is:

   ```text
   docs/design/fixtures/browser-dom-element-picker-v0/controlled-page.html
   ```

4. In Surface Inspector, turn on Annotation Mode, request/replay semantic
   targets if needed, then pin or comment the `section[data-testid="hero-card"]`
   target. Inspect the committed record and verify it remains an
   `element_target` with `surface_type: "browser_page"` and browser DOM
   precision.

5. Reveal `#offscreen-target`. The controlled harness should report
   `already_visible` for visible targets, `revealed` after `scrollIntoView` for
   the offscreen target, or an explicit `target_absent`, `adapter_error`, or
   `unsupported` blocker.

6. Clear annotations from Surface Inspector. The smoke path is ephemeral and
   must not mutate source fixture files.
