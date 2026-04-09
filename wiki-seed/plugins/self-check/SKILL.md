---
name: self-check
description: >
  Run a health check on the aos runtime. Use when the user asks
  to check system status, verify the runtime is healthy, diagnose
  issues, or troubleshoot aos problems.
version: "1.0.0"
author: agent-os
tags: [diagnostics, health, runtime]
triggers: ["check system health", "is aos working", "diagnose issues", "run health check"]
requires: [aos-daemon]
---

# Self-Check — Runtime Health Verification

Run a comprehensive health check of the aos runtime and report status.

## Steps

1. Run `aos doctor --json` and parse the output
2. Check each section:
   - **Permissions**: accessibility and screen recording granted?
   - **Daemon**: running? Socket exists?
   - **Service**: launch agent installed and loaded?
3. If issues found, suggest specific fix commands
4. Report summary to the user

## Decision Tree

- If permissions missing → suggest `aos permissions setup --once`
- If daemon not running → suggest `aos service start`
- If service not installed → suggest `aos service install --mode repo`
- If everything healthy → confirm all systems operational

## Related
- [Daemon](../../entities/daemon.md)
- [Runtime Modes](../../concepts/runtime-modes.md)
