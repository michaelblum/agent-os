# Sigil Session Vitality Lab

This is a manual visual test harness for Sigil's session telemetry expression.
It sends synthetic `agent.session.telemetry` and `agent.session.lifecycle`
events to a running Sigil avatar canvas, then reads back
`window.__sigilDebug.snapshot().sessionVitality`.

Launch manually from repo mode:

```bash
./aos ready
./aos set content.roots.toolkit packages/toolkit
./aos set content.roots.sigil apps/sigil
./aos show remove --id avatar-main 2>/dev/null || true
./aos show create --id avatar-main --url 'aos://sigil/renderer/index.html' --track union
./aos show wait --id avatar-main --js '!!window.__sigilDebug?.snapshot'
./aos show create \
  --id sigil-session-vitality-lab \
  --url 'aos://sigil/tests/session-vitality/index.html?target=avatar-main' \
  --at 80,80,760,720 \
  --interactive \
  --focus
```

Run the automated smoke:

```bash
bash tests/scenarios/sigil/session-vitality/smoke.sh
```

In a clean git worktree without a local `./aos` binary, point the scenario at
the built repo binary:

```bash
AOS=/path/to/agent-os/aos bash tests/scenarios/sigil/session-vitality/smoke.sh
```

For unmerged worktree verification against a temporary static server, override
the canvas URLs:

```bash
AOS=/path/to/agent-os/aos \
AOS_SIGIL_RENDERER_URL='http://127.0.0.1:18784/sigil/renderer/index.html' \
AOS_SIGIL_VITALITY_LAB_URL='http://127.0.0.1:18784/sigil/tests/session-vitality/index.html?target=sigil-session-vitality-avatar' \
bash tests/scenarios/sigil/session-vitality/smoke.sh
```
