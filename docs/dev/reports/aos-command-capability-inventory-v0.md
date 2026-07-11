# AOS Command Capability Inventory

Generated from `manifests/commands/source/aos/`,
`manifests/commands/aos-commands.json`, and
`manifests/commands/aos-external-commands.json`.

Do not hand-edit this report. Update source command manifests or
`scripts/generate-command-inventory.mjs`, then run:

```bash
node scripts/generate-command-inventory.mjs
```

This is a development inventory, not a consumer API contract. Use
`docs/api/aos-capabilities.md` for the public desktop-agent capability map.
The "group" column is a proposed capability classification used to audit the
current command tree before public CLI and self-hosting boundary changes.

## Summary

- Command paths: 41
- Concrete forms: 197
- Consumer-discoverable forms: 188
- Internal/transitional command paths: 1
- Mutating or conditionally mutating forms: 108
- Forms with unspecified mutability metadata: 0
- Forms with JSON output path: 192
- Forms with dry-run support: 37

## Capability Group Counts

| Group | Forms |
| --- | --- |
| Browser companion | 15 |
| Canvas and vision | 5 |
| Capture and perception | 7 |
| CLI metadata | 2 |
| Content/wiki | 17 |
| Core desktop | 9 |
| Core readiness | 7 |
| Desktop discovery | 4 |
| Desktop/native control | 18 |
| Diagnostics/debug | 6 |
| Operator input | 6 |
| Operator messaging | 7 |
| Overlay/display | 15 |
| Pointer and keyboard | 9 |
| Runtime/service | 15 |
| Saved workspace | 6 |
| Skills and recipes | 7 |
| Storage/config | 5 |
| Verification/evidence | 28 |
| Voice and speech | 9 |

## Command Paths

| Command path | Forms | Group | Public | Mutability | JSON | Source manifest | External implementation | Doc owner(s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `launch` | 1 | Core desktop | yes | mutates | --json | `manifests/commands/source/aos/01-launch.json` | `node scripts/aos-launch.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `experience` | 0 | Core desktop | yes | family only | family only | `manifests/commands/source/aos/02-experience.json` | `node scripts/aos-experience.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `experience status` | 1 | Core desktop | yes | read-only | --json | `manifests/commands/source/aos/02-experience.json` | `node scripts/aos-experience.mjs status` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `experience activate` | 1 | Core desktop | yes | mutates | --json | `manifests/commands/source/aos/02-experience.json` | `node scripts/aos-experience.mjs activate` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `experience menu invoke` | 1 | Core desktop | yes | mutates | --json | `manifests/commands/source/aos/02-experience.json` | `node scripts/aos-experience.mjs menu invoke` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `experience deactivate` | 1 | Core desktop | yes | mutates | --json | `manifests/commands/source/aos/02-experience.json` | `node scripts/aos-experience.mjs deactivate` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see` | 13 | Capture and perception, Saved workspace | yes | conditional --save, mutates, read-only | --json, default | `manifests/commands/source/aos/03-see-01-capture.json, manifests/commands/source/aos/03-see-02-workspace.json` | `node scripts/aos-help-proxy.mjs see [missing child]; node scripts/aos-see-native.mjs capture [not capture/observe/cursor/list...]` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see zone` | 4 | Canvas and vision | yes | mutates | default | `manifests/commands/source/aos/03-see-03-zone.json` | `node scripts/aos-subcommand-router.mjs see zone MISSING_SUBCOMMAND see zone requires a subcommand. Usage: aos see zone <save\|define\|list\|delete> ... UNKNOWN_SUBCOMMAND see zone subcommand` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see annotation` | 6 | Operator input | yes | mutates, read-only | --json | `manifests/commands/source/aos/03-see-04-annotation.json` | `node scripts/aos-subcommand-router.mjs see annotation MISSING_SUBCOMMAND see annotation requires a subcommand. Usage: aos see annotation <create\|list\|read\|consume\|link-work-record\|delete> ... UNKNOWN_SUBCOMMAND see annotation subcommand` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `show` | 15 | Overlay/display | yes | mutates, read-only | --json, default, no | `manifests/commands/source/aos/04-show.json` | `node scripts/aos-family-router.mjs show UNKNOWN_SUBCOMMAND show subcommand [not render/create/update/remove...]` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `recipe` | 4 | Skills and recipes | yes | mutates, read-only | --json | `manifests/commands/source/aos/06-recipe.json` | `node scripts/aos-recipe.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do` | 32 | Pointer and keyboard, Canvas and vision, Browser companion, Desktop/native control | yes | mutates, read-only | default | `manifests/commands/source/aos/07-do-01-pointing.json, manifests/commands/source/aos/07-do-02-text.json, manifests/commands/source/aos/07-do-03-controls.json, manifests/commands/source/aos/07-do-04-window.json, manifests/commands/source/aos/07-do-05-script-session.json, manifests/commands/source/aos/07-do-06-app-lifecycle.json, manifests/commands/source/aos/07-do-07-menu.json` | `node scripts/aos-help-proxy.mjs do [missing child]; node scripts/aos-family-router.mjs do UNKNOWN_SUBCOMMAND do subcommand [not click/hover/drag/fill...]` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `say` | 2 | Voice and speech | yes | mutates, read-only | default | `manifests/commands/source/aos/08-say.json` | `node scripts/aos-say.mjs` | `docs/api/aos.md` |
| `voice` | 7 | Voice and speech | yes | mutates, read-only | default | `manifests/commands/source/aos/09-voice.json` | `node scripts/aos-family-router.mjs voice UNKNOWN_COMMAND voice command [child 0]` | `docs/api/aos.md` |
| `gate` | 5 | Verification/evidence | yes | mutates, read-only | default | `manifests/commands/source/aos/10-gate.json` | `node scripts/aos-family-router.mjs gate UNKNOWN_SUBCOMMAND gate subcommand [child 0]` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `tell` | 4 | Operator messaging | yes | mutates, read-only | default | `manifests/commands/source/aos/11-tell.json` | `node scripts/aos-tell-listen.mjs tell` | `docs/api/aos.md` |
| `listen` | 3 | Operator messaging | yes | read-only | default | `manifests/commands/source/aos/12-listen.json` | `node scripts/aos-tell-listen.mjs listen` | `docs/api/aos.md` |
| `config` | 3 | Storage/config | yes | mutates, read-only | --json, default | `manifests/commands/source/aos/13-config.json` | `node scripts/aos-config-command.mjs dump` | `docs/api/aos.md` |
| `set` | 2 | Storage/config | yes | mutates, read-only | default | `manifests/commands/source/aos/14-set.json` | `node scripts/aos-config-command.mjs set-shorthand` | `docs/api/aos.md` |
| `focus` | 4 | Core desktop | yes | mutates, read-only | default | `manifests/commands/source/aos/15-focus.json` | `node scripts/aos-focus-graph.mjs focus` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `graph` | 4 | Desktop discovery | yes | mutates, read-only | default | `manifests/commands/source/aos/16-graph.json` | `node scripts/aos-focus-graph.mjs graph` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `daemon-snapshot` | 1 | Diagnostics/debug | yes | read-only | default | `manifests/commands/source/aos/17-daemon-snapshot.json` | `node scripts/aos-focus-graph.mjs daemon-snapshot` | `docs/api/aos.md, docs/api/aos-capabilities.md, docs/dev/command-surface.md` |
| `serve` | 1 | Runtime/service | yes | mutates | no | `manifests/commands/source/aos/18-serve.json` | `__serve` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `content` | 2 | Content/wiki | yes | read-only | --json | `manifests/commands/source/aos/19-content.json` | `node scripts/aos-family-router.mjs content UNKNOWN_COMMAND content command [child 0]` | `docs/api/aos.md` |
| `service` | 6 | Runtime/service | yes | mutates, read-only | --json, no | `manifests/commands/source/aos/20-service.json` | `node scripts/aos-subcommand-router.mjs service MISSING_SUBCOMMAND service requires a subcommand. Usage: aos service <install\|start\|stop\|restart\|status\|logs> ... UNKNOWN_SUBCOMMAND service subcommand` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `runtime` | 5 | Runtime/service | yes | mutates, read-only | --json, no | `manifests/commands/source/aos/21-runtime.json` | `node scripts/aos-subcommand-router.mjs runtime MISSING_SUBCOMMAND runtime requires a subcommand. Usage: aos runtime <status\|path\|sign\|install\|display-union [--native]> ... UNKNOWN_SUBCOMMAND runtime subcommand` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `status` | 1 | Core readiness | yes | read-only | --json | `manifests/commands/source/aos/23-status.json` | `node scripts/aos-status.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `ready` | 1 | Core readiness | yes | conditional --repair | --json | `manifests/commands/source/aos/24-ready.json` | `node scripts/aos-ready.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `doctor` | 2 | Core readiness | yes | read-only | --json | `manifests/commands/source/aos/25-doctor.json` | `node scripts/aos-doctor.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `reset` | 1 | Runtime/service | yes | mutates | --json | `manifests/commands/source/aos/26-reset.json` | `node scripts/aos-reset.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `clean` | 1 | Runtime/service | yes | mutates | --json | `manifests/commands/source/aos/27-clean.json` | `node scripts/aos-clean.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `introspect` | 1 | Diagnostics/debug | yes | read-only | --json | `manifests/commands/source/aos/28-introspect.json` | `node scripts/aos-family-router.mjs introspect UNKNOWN_SUBCOMMAND introspect subcommand [child 0]` | `docs/api/aos.md, docs/api/aos-capabilities.md, docs/dev/command-surface.md` |
| `permissions` | 4 | Core readiness, Runtime/service | yes | mutates, read-only | --json | `manifests/commands/source/aos/29-permissions.json` | `node scripts/aos-permissions.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `inspect` | 1 | Diagnostics/debug | yes | mutates | default | `manifests/commands/source/aos/30-inspect.json` | `node scripts/aos-inspect.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md, docs/dev/command-surface.md` |
| `log` | 3 | Diagnostics/debug | yes | mutates, read-only | default | `manifests/commands/source/aos/31-log.json` | `node scripts/aos-log.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md, docs/dev/command-surface.md` |
| `wiki` | 15 | Content/wiki | yes | mutates, read-only | --json | `manifests/commands/source/aos/32-wiki.json` | `node scripts/aos-wiki-router.mjs` | `docs/api/aos.md` |
| `browser` | 9 | Browser companion | no | mutates, read-only | --json, default | `manifests/commands/source/aos/33-browser.json` | `node scripts/aos-browser-internal.mjs` | `docs/api/aos-capabilities.md, docs/dev/command-surface.md` |
| `help` | 2 | CLI metadata | yes | read-only | --json | `manifests/commands/source/aos/34-help.json` | `node scripts/aos-help-proxy.mjs` | `docs/api/aos.md` |
| `work-record` | 23 | Verification/evidence | yes | mutates, read-only | --json | `manifests/commands/source/aos/35-work-record.json, manifests/commands/source/aos/36-work-record-supersession.json, manifests/commands/source/aos/37-work-record-finalization.json` | `node scripts/aos-work-record.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `skills` | 3 | Skills and recipes | yes | mutates, read-only | --json | `manifests/commands/source/aos/38-skills.json` | `node scripts/aos-skills.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `skills companion` | 2 | Browser companion | yes | read-only | --json | `manifests/commands/source/aos/38-skills.json` | `node scripts/aos-skills.mjs companion` | `docs/api/aos.md, docs/api/aos-capabilities.md` |

## Concrete Forms

| Concrete command | Form id | Group | Public | Mutability | JSON | Dry-run | Source manifest | External implementation | Doc owner(s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `launch` | `launch-app` | Core desktop | yes | mutates | --json | yes | `manifests/commands/source/aos/01-launch.json` | `node scripts/aos-launch.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `experience status` | `experience-status` | Core desktop | yes | read-only | --json | no | `manifests/commands/source/aos/02-experience.json` | `node scripts/aos-experience.mjs status` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `experience activate` | `activate-experience` | Core desktop | yes | mutates | --json | yes | `manifests/commands/source/aos/02-experience.json` | `node scripts/aos-experience.mjs activate` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `experience menu invoke` | `experience-menu-invoke` | Core desktop | yes | mutates | --json | yes | `manifests/commands/source/aos/02-experience.json` | `node scripts/aos-experience.mjs menu invoke` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `experience deactivate` | `deactivate-experience` | Core desktop | yes | mutates | --json | yes | `manifests/commands/source/aos/02-experience.json` | `node scripts/aos-experience.mjs deactivate` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see cursor` | `see-cursor` | Capture and perception | yes | read-only | default | no | `manifests/commands/source/aos/03-see-01-capture.json` | `node scripts/aos-see-native.mjs cursor` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see capture` | `see-capture` | Capture and perception | yes | conditional --save | default | no | `manifests/commands/source/aos/03-see-01-capture.json` | `node scripts/aos-see-native.mjs capture` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see capture` | `see-capture-save` | Capture and perception | yes | mutates | default | no | `manifests/commands/source/aos/03-see-01-capture.json` | `node scripts/aos-see-native.mjs capture` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see observe` | `see-observe` | Capture and perception | yes | read-only | default | no | `manifests/commands/source/aos/03-see-01-capture.json` | `node scripts/aos-see-observe.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see list` | `see-list` | Capture and perception | yes | read-only | default | no | `manifests/commands/source/aos/03-see-01-capture.json` | `node scripts/aos-see-native.mjs list` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see selection` | `see-selection` | Capture and perception | yes | read-only | default | no | `manifests/commands/source/aos/03-see-01-capture.json` | `node scripts/aos-see-native.mjs selection` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see snapshots` | `see-snapshots` | Capture and perception | yes | read-only | --json | no | `manifests/commands/source/aos/03-see-02-workspace.json` | `node scripts/aos-agent-workspace.mjs snapshots` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see refs` | `see-refs` | Saved workspace | yes | read-only | --json | no | `manifests/commands/source/aos/03-see-02-workspace.json` | `node scripts/aos-agent-workspace.mjs refs` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see workspaces` | `see-workspaces` | Saved workspace | yes | read-only | --json | no | `manifests/commands/source/aos/03-see-02-workspace.json` | `node scripts/aos-agent-workspace.mjs workspaces` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see workspace` | `see-workspace` | Saved workspace | yes | read-only | --json | no | `manifests/commands/source/aos/03-see-02-workspace.json` | `node scripts/aos-agent-workspace.mjs workspace` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see workspace prune` | `see-workspace-prune` | Saved workspace | yes | mutates | --json | yes | `manifests/commands/source/aos/03-see-02-workspace.json` | `node scripts/aos-agent-workspace.mjs workspace prune` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see workspace delete` | `see-workspace-delete` | Saved workspace | yes | mutates | --json | no | `manifests/commands/source/aos/03-see-02-workspace.json` | `node scripts/aos-agent-workspace.mjs workspace delete` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see snapshot delete` | `see-snapshot-delete` | Saved workspace | yes | mutates | --json | no | `manifests/commands/source/aos/03-see-02-workspace.json` | `node scripts/aos-agent-workspace.mjs snapshot delete` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see zone save` | `zone-save` | Canvas and vision | yes | mutates | default | no | `manifests/commands/source/aos/03-see-03-zone.json` | `node scripts/aos-see-zone.mjs save` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see zone define` | `zone-define` | Canvas and vision | yes | mutates | default | no | `manifests/commands/source/aos/03-see-03-zone.json` | `node scripts/aos-see-zone.mjs define` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see zone list` | `zone-list` | Canvas and vision | yes | mutates | default | no | `manifests/commands/source/aos/03-see-03-zone.json` | `node scripts/aos-see-zone.mjs list` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see zone delete` | `zone-delete` | Canvas and vision | yes | mutates | default | no | `manifests/commands/source/aos/03-see-03-zone.json` | `node scripts/aos-see-zone.mjs delete` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see annotation create` | `see-annotation-create` | Operator input | yes | mutates | --json | no | `manifests/commands/source/aos/03-see-04-annotation.json` | `node scripts/aos-pending-annotation.mjs create` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see annotation list` | `see-annotation-list` | Operator input | yes | read-only | --json | no | `manifests/commands/source/aos/03-see-04-annotation.json` | `node scripts/aos-pending-annotation.mjs list` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see annotation read` | `see-annotation-read` | Operator input | yes | read-only | --json | no | `manifests/commands/source/aos/03-see-04-annotation.json` | `node scripts/aos-pending-annotation.mjs read` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see annotation consume` | `see-annotation-consume` | Operator input | yes | mutates | --json | no | `manifests/commands/source/aos/03-see-04-annotation.json` | `node scripts/aos-pending-annotation.mjs consume` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see annotation link-work-record` | `see-annotation-link-work-record` | Operator input | yes | mutates | --json | no | `manifests/commands/source/aos/03-see-04-annotation.json` | `node scripts/aos-pending-annotation.mjs link-work-record` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `see annotation delete` | `see-annotation-delete` | Operator input | yes | mutates | --json | no | `manifests/commands/source/aos/03-see-04-annotation.json` | `node scripts/aos-pending-annotation.mjs delete` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `show create` | `show-create` | Overlay/display | yes | mutates | default | no | `manifests/commands/source/aos/04-show.json` | `node scripts/aos-show-client.mjs create` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `show update` | `show-update` | Overlay/display | yes | mutates | default | no | `manifests/commands/source/aos/04-show.json` | `node scripts/aos-show-client.mjs update` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `show remove` | `show-remove` | Overlay/display | yes | mutates | default | no | `manifests/commands/source/aos/04-show.json` | `node scripts/aos-show-client.mjs remove` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `show remove-all` | `show-remove-all` | Overlay/display | yes | mutates | default | no | `manifests/commands/source/aos/04-show.json` | `node scripts/aos-show-client.mjs remove-all` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `show list` | `show-list` | Overlay/display | yes | read-only | default | no | `manifests/commands/source/aos/04-show.json` | `node scripts/aos-show-client.mjs list` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `show audit` | `show-audit` | Overlay/display | yes | read-only | --json | no | `manifests/commands/source/aos/04-show.json` | `node scripts/aos-show-client.mjs audit` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `show render` | `show-render` | Overlay/display | yes | mutates | no | no | `manifests/commands/source/aos/04-show.json` | `node scripts/aos-show-render.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `show eval` | `show-eval` | Overlay/display | yes | mutates | default | no | `manifests/commands/source/aos/04-show.json` | `node scripts/aos-show-client.mjs eval` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `show listen` | `show-listen` | Overlay/display | yes | read-only | default | no | `manifests/commands/source/aos/04-show.json` | `node scripts/aos-show-client.mjs listen` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `show ping` | `show-ping` | Overlay/display | yes | read-only | default | no | `manifests/commands/source/aos/04-show.json` | `node scripts/aos-show-client.mjs ping` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `show wait` | `show-wait` | Overlay/display | yes | read-only | --json | no | `manifests/commands/source/aos/04-show.json` | `node scripts/aos-show-client.mjs wait` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `show exists` | `show-exists` | Overlay/display | yes | read-only | default | no | `manifests/commands/source/aos/04-show.json` | `node scripts/aos-show-lookup.mjs exists` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `show get` | `show-get` | Overlay/display | yes | read-only | default | no | `manifests/commands/source/aos/04-show.json` | `node scripts/aos-show-lookup.mjs get` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `show to-front` | `show-to-front` | Overlay/display | yes | mutates | default | no | `manifests/commands/source/aos/04-show.json` | `node scripts/aos-show-client.mjs to-front` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `show post` | `show-post` | Overlay/display | yes | mutates | default | no | `manifests/commands/source/aos/04-show.json` | `node scripts/aos-show-client.mjs post` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `recipe list` | `recipe-list` | Skills and recipes | yes | read-only | --json | no | `manifests/commands/source/aos/06-recipe.json` | `node scripts/aos-recipe.mjs list` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `recipe explain` | `recipe-explain` | Skills and recipes | yes | read-only | --json | no | `manifests/commands/source/aos/06-recipe.json` | `node scripts/aos-recipe.mjs explain` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `recipe dry-run` | `recipe-dry-run` | Skills and recipes | yes | read-only | --json | no | `manifests/commands/source/aos/06-recipe.json` | `node scripts/aos-recipe.mjs dry-run` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `recipe run` | `recipe-run` | Skills and recipes | yes | mutates | --json | no | `manifests/commands/source/aos/06-recipe.json` | `node scripts/aos-recipe.mjs run` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do click` | `do-click` | Pointer and keyboard | yes | mutates | default | yes | `manifests/commands/source/aos/07-do-01-pointing.json` | `node scripts/aos-do-ref.mjs click [prefix ref:]; node scripts/aos-do-browser.mjs click [prefix browser:]; node scripts/aos-do-canvas.mjs click [prefix canvas:]; node scripts/aos-do-native.mjs click [not browser:/ref:/canvas:]` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do hover` | `do-hover` | Pointer and keyboard | yes | mutates | default | yes | `manifests/commands/source/aos/07-do-01-pointing.json` | `node scripts/aos-do-ref.mjs hover [prefix ref:]; node scripts/aos-do-browser.mjs hover [prefix browser:]; node scripts/aos-do-native.mjs hover [not browser:/ref:]` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do drag` | `do-drag` | Pointer and keyboard | yes | mutates | default | yes | `manifests/commands/source/aos/07-do-01-pointing.json` | `node scripts/aos-do-ref.mjs drag [prefix ref:]; node scripts/aos-do-browser.mjs drag [prefix browser:]; node scripts/aos-do-canvas.mjs drag [prefix canvas:]; node scripts/aos-do-native.mjs drag [not browser:/ref:/canvas:]` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do drag` | `do-drag-canvas` | Canvas and vision | yes | mutates | default | yes | `manifests/commands/source/aos/07-do-01-pointing.json` | `node scripts/aos-do-ref.mjs drag [prefix ref:]; node scripts/aos-do-browser.mjs drag [prefix browser:]; node scripts/aos-do-canvas.mjs drag [prefix canvas:]; node scripts/aos-do-native.mjs drag [not browser:/ref:/canvas:]` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do drag` | `do-drag-native` | Pointer and keyboard | yes | mutates | default | yes | `manifests/commands/source/aos/07-do-01-pointing.json` | `node scripts/aos-do-ref.mjs drag [prefix ref:]; node scripts/aos-do-browser.mjs drag [prefix browser:]; node scripts/aos-do-canvas.mjs drag [prefix canvas:]; node scripts/aos-do-native.mjs drag [not browser:/ref:/canvas:]` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do scroll` | `do-scroll` | Pointer and keyboard | yes | mutates | default | yes | `manifests/commands/source/aos/07-do-01-pointing.json` | `node scripts/aos-do-ref.mjs scroll [prefix ref:]; node scripts/aos-do-browser.mjs scroll [prefix browser:]; node scripts/aos-do-native.mjs scroll [not browser:/ref:]` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do type` | `do-type` | Pointer and keyboard | yes | mutates | default | no | `manifests/commands/source/aos/07-do-02-text.json` | `node scripts/aos-do-ref.mjs type [prefix ref:]; node scripts/aos-do-browser.mjs type [prefix browser:]; node scripts/aos-do-native.mjs type [not browser:/ref:]` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do type` | `do-type-browser` | Browser companion | yes | mutates | default | no | `manifests/commands/source/aos/07-do-02-text.json` | `node scripts/aos-do-ref.mjs type [prefix ref:]; node scripts/aos-do-browser.mjs type [prefix browser:]; node scripts/aos-do-native.mjs type [not browser:/ref:]` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do type` | `do-type-ref` | Pointer and keyboard | yes | mutates | default | yes | `manifests/commands/source/aos/07-do-02-text.json` | `node scripts/aos-do-ref.mjs type [prefix ref:]; node scripts/aos-do-browser.mjs type [prefix browser:]; node scripts/aos-do-native.mjs type [not browser:/ref:]` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do key` | `do-key` | Pointer and keyboard | yes | mutates | default | no | `manifests/commands/source/aos/07-do-02-text.json` | `node scripts/aos-do-ref.mjs key [prefix ref:]; node scripts/aos-do-browser.mjs key [prefix browser:]; node scripts/aos-do-native.mjs key [not browser:/ref:]` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do key` | `do-key-browser` | Browser companion | yes | mutates | default | no | `manifests/commands/source/aos/07-do-02-text.json` | `node scripts/aos-do-ref.mjs key [prefix ref:]; node scripts/aos-do-browser.mjs key [prefix browser:]; node scripts/aos-do-native.mjs key [not browser:/ref:]` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do key` | `do-key-ref` | Pointer and keyboard | yes | mutates | default | yes | `manifests/commands/source/aos/07-do-02-text.json` | `node scripts/aos-do-ref.mjs key [prefix ref:]; node scripts/aos-do-browser.mjs key [prefix browser:]; node scripts/aos-do-native.mjs key [not browser:/ref:]` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do fill` | `do-fill` | Browser companion | yes | mutates | default | yes | `manifests/commands/source/aos/07-do-02-text.json` | `node scripts/aos-do-ref.mjs fill [prefix ref:]; node scripts/aos-do-browser.mjs fill [not ref:]` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do navigate` | `do-navigate` | Browser companion | yes | mutates | default | no | `manifests/commands/source/aos/07-do-02-text.json` | `node scripts/aos-do-browser.mjs navigate` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do press` | `do-press` | Desktop/native control | yes | mutates | default | yes | `manifests/commands/source/aos/07-do-03-controls.json` | `node scripts/aos-do-ref.mjs press [prefix ref:]; node scripts/aos-do-native.mjs press [not ref:]` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do set-value` | `do-set-value` | Desktop/native control | yes | mutates | default | yes | `manifests/commands/source/aos/07-do-03-controls.json` | `node scripts/aos-do-ref.mjs set-value [prefix ref:]; node scripts/aos-do-canvas.mjs set-value [prefix canvas:]; node scripts/aos-do-native.mjs set-value [not ref:/canvas:]` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do focus` | `do-focus` | Desktop/native control | yes | mutates | default | yes | `manifests/commands/source/aos/07-do-03-controls.json` | `node scripts/aos-do-ref.mjs focus [prefix ref:]; node scripts/aos-do-native.mjs focus [not ref:]` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do raise` | `do-raise` | Desktop/native control | yes | mutates | default | yes | `manifests/commands/source/aos/07-do-04-window.json` | `node scripts/aos-do-native.mjs raise` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do move` | `do-move` | Desktop/native control | yes | mutates | default | yes | `manifests/commands/source/aos/07-do-04-window.json` | `node scripts/aos-do-native.mjs move` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do resize` | `do-resize` | Desktop/native control | yes | mutates | default | yes | `manifests/commands/source/aos/07-do-04-window.json` | `node scripts/aos-do-native.mjs resize` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do close` | `do-close` | Desktop/native control | yes | mutates | default | yes | `manifests/commands/source/aos/07-do-04-window.json` | `node scripts/aos-do-native.mjs close` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do minimize` | `do-minimize` | Desktop/native control | yes | mutates | default | yes | `manifests/commands/source/aos/07-do-04-window.json` | `node scripts/aos-do-native.mjs minimize` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do maximize` | `do-maximize` | Desktop/native control | yes | mutates | default | yes | `manifests/commands/source/aos/07-do-04-window.json` | `node scripts/aos-do-native.mjs maximize` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do restore` | `do-restore` | Desktop/native control | yes | mutates | default | yes | `manifests/commands/source/aos/07-do-04-window.json` | `node scripts/aos-do-native.mjs restore` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do tell` | `do-tell` | Desktop/native control | yes | mutates | default | no | `manifests/commands/source/aos/07-do-05-script-session.json` | `node scripts/aos-do-native.mjs tell` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do session` | `do-session` | Desktop/native control | yes | mutates | default | no | `manifests/commands/source/aos/07-do-05-script-session.json` | `node scripts/aos-do-native.mjs session` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do profiles` | `do-profiles` | Desktop/native control | yes | read-only | default | no | `manifests/commands/source/aos/07-do-05-script-session.json` | `node scripts/aos-do-profiles.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do activate` | `do-activate` | Desktop/native control | yes | mutates | default | yes | `manifests/commands/source/aos/07-do-06-app-lifecycle.json` | `node scripts/aos-do-native.mjs activate` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do quit` | `do-quit` | Desktop/native control | yes | mutates | default | yes | `manifests/commands/source/aos/07-do-06-app-lifecycle.json` | `node scripts/aos-do-native.mjs quit` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do hide` | `do-hide` | Desktop/native control | yes | mutates | default | yes | `manifests/commands/source/aos/07-do-06-app-lifecycle.json` | `node scripts/aos-do-native.mjs hide` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do unhide` | `do-unhide` | Desktop/native control | yes | mutates | default | yes | `manifests/commands/source/aos/07-do-06-app-lifecycle.json` | `node scripts/aos-do-native.mjs unhide` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `do menu` | `do-menu` | Desktop/native control | yes | mutates | default | yes | `manifests/commands/source/aos/07-do-07-menu.json` | `node scripts/aos-do-native.mjs menu` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `say` | `say-text` | Voice and speech | yes | mutates | default | no | `manifests/commands/source/aos/08-say.json` | `node scripts/aos-say.mjs` | `docs/api/aos.md` |
| `say` | `say-list-voices` | Voice and speech | yes | read-only | default | no | `manifests/commands/source/aos/08-say.json` | `node scripts/aos-say.mjs` | `docs/api/aos.md` |
| `voice list` | `voice-list` | Voice and speech | yes | read-only | default | no | `manifests/commands/source/aos/09-voice.json` | `node scripts/aos-voice.mjs list` | `docs/api/aos.md` |
| `voice assignments` | `voice-assignments` | Voice and speech | yes | read-only | default | no | `manifests/commands/source/aos/09-voice.json` | `node scripts/aos-voice.mjs assignments` | `docs/api/aos.md` |
| `voice refresh` | `voice-refresh` | Voice and speech | yes | mutates | default | no | `manifests/commands/source/aos/09-voice.json` | `node scripts/aos-voice.mjs refresh` | `docs/api/aos.md` |
| `voice providers` | `voice-providers` | Voice and speech | yes | read-only | default | no | `manifests/commands/source/aos/09-voice.json` | `node scripts/aos-voice.mjs providers` | `docs/api/aos.md` |
| `voice bind` | `voice-bind` | Voice and speech | yes | mutates | default | no | `manifests/commands/source/aos/09-voice.json` | `node scripts/aos-voice.mjs bind` | `docs/api/aos.md` |
| `voice next` | `voice-next` | Voice and speech | yes | mutates | default | no | `manifests/commands/source/aos/09-voice.json` | `node scripts/aos-voice.mjs next` | `docs/api/aos.md` |
| `voice final-response` | `voice-final-response` | Voice and speech | yes | mutates | default | no | `manifests/commands/source/aos/09-voice.json` | `node scripts/aos-voice.mjs final-response` | `docs/api/aos.md` |
| `gate ask` | `gate-ask` | Verification/evidence | yes | mutates | default | no | `manifests/commands/source/aos/10-gate.json` | `node packages/cli/verbs/gate-ask.js` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `gate defer` | `gate-defer` | Verification/evidence | yes | mutates | default | no | `manifests/commands/source/aos/10-gate.json` | `node packages/cli/verbs/gate-defer.js` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `gate submit` | `gate-submit` | Verification/evidence | yes | mutates | default | no | `manifests/commands/source/aos/10-gate.json` | `node packages/cli/verbs/gate-submit.js` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `gate continuations` | `gate-continuations` | Verification/evidence | yes | read-only | default | no | `manifests/commands/source/aos/10-gate.json` | `node packages/cli/verbs/gate-continuations.js` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `gate records` | `gate-records` | Verification/evidence | yes | read-only | default | no | `manifests/commands/source/aos/10-gate.json` | `node packages/cli/verbs/gate-records.js` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `tell` | `tell-message` | Operator messaging | yes | mutates | default | no | `manifests/commands/source/aos/11-tell.json` | `node scripts/aos-tell-listen.mjs tell` | `docs/api/aos.md` |
| `tell` | `tell-register` | Operator messaging | yes | mutates | default | no | `manifests/commands/source/aos/11-tell.json` | `node scripts/aos-tell-listen.mjs tell` | `docs/api/aos.md` |
| `tell` | `tell-unregister` | Operator messaging | yes | mutates | default | no | `manifests/commands/source/aos/11-tell.json` | `node scripts/aos-tell-listen.mjs tell` | `docs/api/aos.md` |
| `tell` | `tell-who` | Operator messaging | yes | read-only | default | no | `manifests/commands/source/aos/11-tell.json` | `node scripts/aos-tell-listen.mjs tell` | `docs/api/aos.md` |
| `listen` | `listen-read` | Operator messaging | yes | read-only | default | no | `manifests/commands/source/aos/12-listen.json` | `node scripts/aos-tell-listen.mjs listen` | `docs/api/aos.md` |
| `listen` | `listen-follow` | Operator messaging | yes | read-only | default | no | `manifests/commands/source/aos/12-listen.json` | `node scripts/aos-tell-listen.mjs listen` | `docs/api/aos.md` |
| `listen` | `listen-channels` | Operator messaging | yes | read-only | default | no | `manifests/commands/source/aos/12-listen.json` | `node scripts/aos-tell-listen.mjs listen` | `docs/api/aos.md` |
| `config` | `config-dump` | Storage/config | yes | read-only | default | no | `manifests/commands/source/aos/13-config.json` | `node scripts/aos-config-command.mjs dump` | `docs/api/aos.md` |
| `config get` | `config-get` | Storage/config | yes | read-only | --json | no | `manifests/commands/source/aos/13-config.json` | `node scripts/aos-config-command.mjs get` | `docs/api/aos.md` |
| `config set` | `config-set` | Storage/config | yes | mutates | default | no | `manifests/commands/source/aos/13-config.json` | `node scripts/aos-config-command.mjs set` | `docs/api/aos.md` |
| `set` | `set-value` | Storage/config | yes | mutates | default | no | `manifests/commands/source/aos/14-set.json` | `node scripts/aos-config-command.mjs set-shorthand` | `docs/api/aos.md` |
| `set` | `set-dump` | Storage/config | yes | read-only | default | no | `manifests/commands/source/aos/14-set.json` | `node scripts/aos-config-command.mjs set-shorthand` | `docs/api/aos.md` |
| `focus create` | `focus-create` | Core desktop | yes | mutates | default | no | `manifests/commands/source/aos/15-focus.json` | `node scripts/aos-focus-graph.mjs focus create` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `focus update` | `focus-update` | Core desktop | yes | mutates | default | no | `manifests/commands/source/aos/15-focus.json` | `node scripts/aos-focus-graph.mjs focus update` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `focus list` | `focus-list` | Core desktop | yes | read-only | default | no | `manifests/commands/source/aos/15-focus.json` | `node scripts/aos-focus-graph.mjs focus list` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `focus remove` | `focus-remove` | Core desktop | yes | mutates | default | no | `manifests/commands/source/aos/15-focus.json` | `node scripts/aos-focus-graph.mjs focus remove` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `graph displays` | `graph-displays` | Desktop discovery | yes | read-only | default | no | `manifests/commands/source/aos/16-graph.json` | `node scripts/aos-focus-graph.mjs graph displays` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `graph windows` | `graph-windows` | Desktop discovery | yes | read-only | default | no | `manifests/commands/source/aos/16-graph.json` | `node scripts/aos-focus-graph.mjs graph windows` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `graph deepen` | `graph-deepen` | Desktop discovery | yes | mutates | default | no | `manifests/commands/source/aos/16-graph.json` | `node scripts/aos-focus-graph.mjs graph deepen` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `graph collapse` | `graph-collapse` | Desktop discovery | yes | mutates | default | no | `manifests/commands/source/aos/16-graph.json` | `node scripts/aos-focus-graph.mjs graph collapse` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `daemon-snapshot` | `daemon-snapshot` | Diagnostics/debug | yes | read-only | default | no | `manifests/commands/source/aos/17-daemon-snapshot.json` | `node scripts/aos-focus-graph.mjs daemon-snapshot` | `docs/api/aos.md, docs/api/aos-capabilities.md, docs/dev/command-surface.md` |
| `serve` | `serve` | Runtime/service | yes | mutates | no | no | `manifests/commands/source/aos/18-serve.json` | `__serve` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `content status` | `content-status` | Content/wiki | yes | read-only | --json | no | `manifests/commands/source/aos/19-content.json` | `node scripts/aos-content.mjs status` | `docs/api/aos.md` |
| `content wait` | `content-wait` | Content/wiki | yes | read-only | --json | no | `manifests/commands/source/aos/19-content.json` | `node scripts/aos-content.mjs wait` | `docs/api/aos.md` |
| `service install` | `service-install` | Runtime/service | yes | mutates | --json | no | `manifests/commands/source/aos/20-service.json` | `node scripts/aos-service.mjs install` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `service start` | `service-start` | Runtime/service | yes | mutates | --json | no | `manifests/commands/source/aos/20-service.json` | `node scripts/aos-service.mjs start` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `service stop` | `service-stop` | Runtime/service | yes | mutates | --json | no | `manifests/commands/source/aos/20-service.json` | `node scripts/aos-service.mjs stop` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `service restart` | `service-restart` | Runtime/service | yes | mutates | --json | no | `manifests/commands/source/aos/20-service.json` | `node scripts/aos-service.mjs restart` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `service status` | `service-status` | Runtime/service | yes | read-only | --json | no | `manifests/commands/source/aos/20-service.json` | `node scripts/aos-service.mjs status` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `service logs` | `service-logs` | Runtime/service | yes | read-only | no | no | `manifests/commands/source/aos/20-service.json` | `node scripts/aos-service.mjs logs` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `runtime install` | `runtime-install` | Runtime/service | yes | mutates | --json | no | `manifests/commands/source/aos/21-runtime.json` | `scripts/aos-runtime-install` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `runtime status` | `runtime-status` | Runtime/service | yes | read-only | --json | no | `manifests/commands/source/aos/21-runtime.json` | `scripts/aos-runtime-status` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `runtime path` | `runtime-path` | Runtime/service | yes | read-only | --json | no | `manifests/commands/source/aos/21-runtime.json` | `scripts/aos-runtime-path` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `runtime sign` | `runtime-sign` | Runtime/service | yes | mutates | no | no | `manifests/commands/source/aos/21-runtime.json` | `scripts/sign-aos-runtime` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `runtime display-union` | `runtime-display-union` | Runtime/service | yes | read-only | no | no | `manifests/commands/source/aos/21-runtime.json` | `scripts/aos-runtime-display-union` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `status` | `status` | Core readiness | yes | read-only | --json | no | `manifests/commands/source/aos/23-status.json` | `node scripts/aos-status.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `ready` | `ready` | Core readiness | yes | conditional --repair | --json | no | `manifests/commands/source/aos/24-ready.json` | `node scripts/aos-ready.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `doctor` | `doctor` | Core readiness | yes | read-only | --json | no | `manifests/commands/source/aos/25-doctor.json` | `node scripts/aos-doctor.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `doctor gateway` | `doctor-gateway` | Core readiness | yes | read-only | --json | no | `manifests/commands/source/aos/25-doctor.json` | `node packages/gateway/dist/doctor-cli.js --mode $AOS_RUNTIME_MODE --state-root $AOS_STATE_ROOT` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `reset` | `reset` | Runtime/service | yes | mutates | --json | no | `manifests/commands/source/aos/26-reset.json` | `node scripts/aos-reset.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `clean` | `clean` | Runtime/service | yes | mutates | --json | yes | `manifests/commands/source/aos/27-clean.json` | `node scripts/aos-clean.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `introspect review` | `introspect-review` | Diagnostics/debug | yes | read-only | --json | no | `manifests/commands/source/aos/28-introspect.json` | `node scripts/aos-introspect-review.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md, docs/dev/command-surface.md` |
| `permissions check` | `permissions-check` | Core readiness | yes | read-only | --json | no | `manifests/commands/source/aos/29-permissions.json` | `node scripts/aos-permissions.mjs check` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `permissions preflight` | `permissions-preflight` | Core readiness | yes | read-only | --json | no | `manifests/commands/source/aos/29-permissions.json` | `node scripts/aos-permissions.mjs preflight` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `permissions setup` | `permissions-setup` | Core readiness | yes | mutates | --json | no | `manifests/commands/source/aos/29-permissions.json` | `node scripts/aos-permissions.mjs setup` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `permissions reset-runtime` | `permissions-reset-runtime` | Runtime/service | yes | mutates | --json | no | `manifests/commands/source/aos/29-permissions.json` | `node scripts/aos-permissions.mjs reset-runtime` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `inspect` | `inspect` | Diagnostics/debug | yes | mutates | default | no | `manifests/commands/source/aos/30-inspect.json` | `node scripts/aos-inspect.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md, docs/dev/command-surface.md` |
| `log` | `log-stream` | Diagnostics/debug | yes | read-only | default | no | `manifests/commands/source/aos/31-log.json` | `node scripts/aos-log.mjs` | `docs/api/aos.md, docs/api/aos-capabilities.md, docs/dev/command-surface.md` |
| `log push` | `log-push` | Diagnostics/debug | yes | mutates | default | no | `manifests/commands/source/aos/31-log.json` | `node scripts/aos-log.mjs push` | `docs/api/aos.md, docs/api/aos-capabilities.md, docs/dev/command-surface.md` |
| `log clear` | `log-clear` | Diagnostics/debug | yes | mutates | default | no | `manifests/commands/source/aos/31-log.json` | `node scripts/aos-log.mjs clear` | `docs/api/aos.md, docs/api/aos-capabilities.md, docs/dev/command-surface.md` |
| `wiki create-plugin` | `wiki-create-plugin` | Content/wiki | yes | mutates | --json | no | `manifests/commands/source/aos/32-wiki.json` | `node scripts/aos-wiki-mutate.mjs create-plugin` | `docs/api/aos.md` |
| `wiki add` | `wiki-add` | Content/wiki | yes | mutates | --json | no | `manifests/commands/source/aos/32-wiki.json` | `node scripts/aos-wiki-mutate.mjs add` | `docs/api/aos.md` |
| `wiki rm` | `wiki-rm` | Content/wiki | yes | mutates | --json | no | `manifests/commands/source/aos/32-wiki.json` | `node scripts/aos-wiki-mutate.mjs rm` | `docs/api/aos.md` |
| `wiki list` | `wiki-list` | Content/wiki | yes | read-only | --json | no | `manifests/commands/source/aos/32-wiki.json` | `python3 scripts/aos-wiki-query.py list` | `docs/api/aos.md` |
| `wiki search` | `wiki-search` | Content/wiki | yes | read-only | --json | no | `manifests/commands/source/aos/32-wiki.json` | `python3 scripts/aos-wiki-query.py search` | `docs/api/aos.md` |
| `wiki show` | `wiki-show` | Content/wiki | yes | read-only | --json | no | `manifests/commands/source/aos/32-wiki.json` | `node scripts/aos-wiki-read.mjs show` | `docs/api/aos.md` |
| `wiki graph` | `wiki-graph` | Content/wiki | yes | read-only | --json | no | `manifests/commands/source/aos/32-wiki.json` | `python3 scripts/aos-wiki-graph.py` | `docs/api/aos.md` |
| `wiki link` | `wiki-link` | Content/wiki | yes | mutates | --json | no | `manifests/commands/source/aos/32-wiki.json` | `node scripts/aos-wiki-mutate.mjs link` | `docs/api/aos.md` |
| `wiki invoke` | `wiki-invoke` | Content/wiki | yes | read-only | --json | no | `manifests/commands/source/aos/32-wiki.json` | `node scripts/aos-wiki-read.mjs invoke` | `docs/api/aos.md` |
| `wiki reindex` | `wiki-reindex` | Content/wiki | yes | mutates | --json | no | `manifests/commands/source/aos/32-wiki.json` | `python3 scripts/aos-wiki-reindex.py` | `docs/api/aos.md` |
| `wiki lint` | `wiki-lint` | Content/wiki | yes | read-only | --json | no | `manifests/commands/source/aos/32-wiki.json` | `python3 scripts/aos-wiki-lint.py` | `docs/api/aos.md` |
| `wiki lint` | `wiki-lint-fix` | Content/wiki | yes | mutates | --json | no | `manifests/commands/source/aos/32-wiki.json` | `python3 scripts/aos-wiki-lint.py` | `docs/api/aos.md` |
| `wiki seed` | `wiki-seed` | Content/wiki | yes | mutates | --json | no | `manifests/commands/source/aos/32-wiki.json` | `node scripts/aos-wiki-seed.mjs` | `docs/api/aos.md` |
| `wiki project-docs` | `wiki-project-docs` | Content/wiki | yes | mutates | --json | no | `manifests/commands/source/aos/32-wiki.json` | `node scripts/aos-wiki-project-docs.mjs` | `docs/api/aos.md` |
| `wiki migrate-namespaces` | `wiki-migrate-namespaces` | Content/wiki | yes | mutates | --json | no | `manifests/commands/source/aos/32-wiki.json` | `node scripts/aos-wiki-migrate-namespaces.mjs` | `docs/api/aos.md` |
| `browser _parse-target` | `browser-parse-target` | Browser companion | no | read-only | default | no | `manifests/commands/source/aos/33-browser.json` | `node scripts/aos-browser-internal.mjs _parse-target` | `docs/api/aos-capabilities.md, docs/dev/command-surface.md` |
| `browser _check-version` | `browser-check-version` | Browser companion | no | read-only | default | no | `manifests/commands/source/aos/33-browser.json` | `scripts/aos-browser-check-version` | `docs/api/aos-capabilities.md, docs/dev/command-surface.md` |
| `browser _run` | `browser-run` | Browser companion | no | mutates | default | no | `manifests/commands/source/aos/33-browser.json` | `node scripts/aos-browser-internal.mjs _run` | `docs/api/aos-capabilities.md, docs/dev/command-surface.md` |
| `browser _parse-snapshot` | `browser-parse-snapshot` | Browser companion | no | read-only | default | no | `manifests/commands/source/aos/33-browser.json` | `node scripts/aos-browser-internal.mjs _parse-snapshot` | `docs/api/aos-capabilities.md, docs/dev/command-surface.md` |
| `browser _registry list` | `browser-registry-list` | Browser companion | no | read-only | default | no | `manifests/commands/source/aos/33-browser.json` | `node scripts/aos-browser-internal.mjs _registry list` | `docs/api/aos-capabilities.md, docs/dev/command-surface.md` |
| `browser _registry add` | `browser-registry-add` | Browser companion | no | mutates | default | no | `manifests/commands/source/aos/33-browser.json` | `node scripts/aos-browser-internal.mjs _registry add` | `docs/api/aos-capabilities.md, docs/dev/command-surface.md` |
| `browser _registry remove` | `browser-registry-remove` | Browser companion | no | mutates | default | no | `manifests/commands/source/aos/33-browser.json` | `node scripts/aos-browser-internal.mjs _registry remove` | `docs/api/aos-capabilities.md, docs/dev/command-surface.md` |
| `browser _registry find` | `browser-registry-find` | Browser companion | no | read-only | default | no | `manifests/commands/source/aos/33-browser.json` | `node scripts/aos-browser-internal.mjs _registry find` | `docs/api/aos-capabilities.md, docs/dev/command-surface.md` |
| `browser _resolve-anchor` | `browser-resolve-anchor` | Browser companion | no | read-only | --json | no | `manifests/commands/source/aos/33-browser.json` | `node scripts/aos-browser-internal.mjs _resolve-anchor` | `docs/api/aos-capabilities.md, docs/dev/command-surface.md` |
| `help` | `help-full` | CLI metadata | yes | read-only | --json | no | `manifests/commands/source/aos/34-help.json` | `node scripts/aos-help-proxy.mjs` | `docs/api/aos.md` |
| `help` | `help-command` | CLI metadata | yes | read-only | --json | no | `manifests/commands/source/aos/34-help.json` | `node scripts/aos-help-proxy.mjs` | `docs/api/aos.md` |
| `work-record list` | `work-record-list` | Verification/evidence | yes | read-only | --json | no | `manifests/commands/source/aos/35-work-record.json` | `node scripts/aos-work-record.mjs list` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `work-record read` | `work-record-read` | Verification/evidence | yes | read-only | --json | no | `manifests/commands/source/aos/35-work-record.json` | `node scripts/aos-work-record.mjs read` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `work-record verify` | `work-record-verify` | Verification/evidence | yes | read-only | --json | no | `manifests/commands/source/aos/35-work-record.json` | `node scripts/aos-work-record.mjs verify` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `work-record status` | `work-record-status` | Verification/evidence | yes | read-only | --json | no | `manifests/commands/source/aos/35-work-record.json` | `node scripts/aos-work-record.mjs status` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `work-record plan-repair` | `work-record-plan-repair` | Verification/evidence | yes | read-only | --json | no | `manifests/commands/source/aos/35-work-record.json` | `node scripts/aos-work-record.mjs plan-repair` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `work-record plan-attempt` | `work-record-plan-attempt` | Verification/evidence | yes | read-only | --json | no | `manifests/commands/source/aos/35-work-record.json` | `node scripts/aos-work-record.mjs plan-attempt` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `work-record repair execute` | `work-record-repair-execute` | Verification/evidence | yes | mutates | --json | yes | `manifests/commands/source/aos/35-work-record.json` | `node scripts/aos-work-record.mjs repair execute` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `work-record attempt-artifact validate` | `work-record-attempt-artifact-validate` | Verification/evidence | yes | read-only | --json | no | `manifests/commands/source/aos/35-work-record.json` | `node scripts/aos-work-record.mjs attempt-artifact validate` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `work-record attempt-artifact build` | `work-record-attempt-artifact-build` | Verification/evidence | yes | read-only | --json | no | `manifests/commands/source/aos/35-work-record.json` | `node scripts/aos-work-record.mjs attempt-artifact build` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `work-record replacement-proposal build` | `work-record-replacement-proposal-build` | Verification/evidence | yes | read-only | --json | no | `manifests/commands/source/aos/35-work-record.json` | `node scripts/aos-work-record.mjs replacement-proposal build` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `work-record replacement-proposal validate` | `work-record-replacement-proposal-validate` | Verification/evidence | yes | read-only | --json | no | `manifests/commands/source/aos/35-work-record.json` | `node scripts/aos-work-record.mjs replacement-proposal validate` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `work-record replacement-proposal write` | `work-record-replacement-proposal-write` | Verification/evidence | yes | mutates | --json | yes | `manifests/commands/source/aos/35-work-record.json` | `node scripts/aos-work-record.mjs replacement-proposal write` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `work-record gate-request` | `work-record-gate-request` | Verification/evidence | yes | read-only | --json | no | `manifests/commands/source/aos/35-work-record.json` | `node scripts/aos-work-record.mjs gate-request` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `work-record gate-check` | `work-record-gate-check` | Verification/evidence | yes | read-only | --json | no | `manifests/commands/source/aos/35-work-record.json` | `node scripts/aos-work-record.mjs gate-check` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `work-record export` | `work-record-export` | Verification/evidence | yes | read-only | --json | no | `manifests/commands/source/aos/35-work-record.json` | `node scripts/aos-work-record.mjs export` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `work-record supersession write` | `work-record-supersession-write` | Verification/evidence | yes | mutates | --json | yes | `manifests/commands/source/aos/36-work-record-supersession.json` | `node scripts/aos-work-record.mjs supersession write` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `work-record supersession lookup` | `work-record-supersession-lookup` | Verification/evidence | yes | read-only | --json | no | `manifests/commands/source/aos/36-work-record-supersession.json` | `node scripts/aos-work-record.mjs supersession lookup` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `work-record supersession validate` | `work-record-supersession-validate` | Verification/evidence | yes | read-only | --json | no | `manifests/commands/source/aos/36-work-record-supersession.json` | `node scripts/aos-work-record.mjs supersession validate` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `work-record repair guide` | `work-record-repair-guide` | Verification/evidence | yes | read-only | --json | no | `manifests/commands/source/aos/37-work-record-finalization.json` | `node scripts/aos-work-record.mjs repair guide` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `work-record repair bundle` | `work-record-repair-bundle` | Verification/evidence | yes | mutates | --json | yes | `manifests/commands/source/aos/37-work-record-finalization.json` | `node scripts/aos-work-record.mjs repair bundle` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `work-record repair bundle status` | `work-record-repair-bundle-status` | Verification/evidence | yes | read-only | --json | no | `manifests/commands/source/aos/37-work-record-finalization.json` | `node scripts/aos-work-record.mjs repair bundle status` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `work-record repair bundle inspect` | `work-record-repair-bundle-inspect` | Verification/evidence | yes | read-only | --json | no | `manifests/commands/source/aos/37-work-record-finalization.json` | `node scripts/aos-work-record.mjs repair bundle inspect` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `work-record repair finalize` | `work-record-repair-finalize` | Verification/evidence | yes | mutates | --json | yes | `manifests/commands/source/aos/37-work-record-finalization.json` | `node scripts/aos-work-record.mjs repair finalize` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `skills list` | `skills-list` | Skills and recipes | yes | read-only | --json | no | `manifests/commands/source/aos/38-skills.json` | `node scripts/aos-skills.mjs list` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `skills check` | `skills-check` | Skills and recipes | yes | read-only | --json | no | `manifests/commands/source/aos/38-skills.json` | `node scripts/aos-skills.mjs check` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `skills install` | `skills-install` | Skills and recipes | yes | mutates | --json | yes | `manifests/commands/source/aos/38-skills.json` | `node scripts/aos-skills.mjs install` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `skills companion check` | `skills-companion-check` | Browser companion | yes | read-only | --json | no | `manifests/commands/source/aos/38-skills.json` | `node scripts/aos-skills.mjs companion check` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
| `skills companion install` | `skills-companion-install` | Browser companion | yes | read-only | --json | yes | `manifests/commands/source/aos/38-skills.json` | `node scripts/aos-skills.mjs companion install` | `docs/api/aos.md, docs/api/aos-capabilities.md` |
