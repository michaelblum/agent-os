# Sigil Interaction Trace

Use this diagnostic when a Sigil interaction bug only appears through real user
input.

## Operator Flow

1. Open the Sigil context menu and choose `Interaction Trace`, or launch it:

   ```bash
   apps/sigil/diagnostics/interaction-trace/launch.sh
   ```

2. Click `Arm Capture`.
3. Reproduce the interaction manually.
4. Tell the agent: "I just did the thing; take a look."

The agent can export the latest capture with:

```bash
apps/sigil/diagnostics/interaction-trace/dump.sh
```

The dump is JSON and includes the active Sigil runtime, menu state, hit-target
state, input events, routing decisions, and saved capture entries. The capture
is stored in the running avatar canvas so the operator does not need to copy
anything out of the panel.
