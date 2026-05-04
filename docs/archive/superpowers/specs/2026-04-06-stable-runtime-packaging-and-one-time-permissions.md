# Stable Runtime Packaging and One-Time Permissions

**Date:** 2026-04-06  
**Status:** Draft  
**Scope:** Reduce repeated macOS permission prompts by packaging agent-os around one stable privileged runtime identity.

## Problem

Today, agent-os is typically run from a development checkout under `~/Documents`, with multiple raw binaries invoking protected macOS APIs directly. That creates repeated privacy and security prompts because macOS sees:

- a protected filesystem location (`~/Documents`)
- unstable executable identity (rebuilt binaries in a repo)
- multiple executables touching TCC-governed APIs
- launch contexts that vary between terminal, shell tool, and `launchd`

This leads to recurring prompts for:

- Documents folder access
- Accessibility / keystroke monitoring
- Screen Recording

It also makes behavior inconsistent across `aos`, Sigil, and other cohorts.

## Goal

Move agent-os to a model where:

1. one stable packaged runtime owns privileged macOS capabilities
2. permission grants happen once per capability for that runtime
3. other tools become unprivileged clients wherever possible
4. `launchd` runs the packaged runtime, not a raw repo binary

## Design Principles

- **One privileged identity.** Prefer a single trusted runtime over many binaries asking for the same permissions.
- **Stable path and bundle identity.** macOS permission state is far more durable when the executable identity is stable.
- **Client/server separation.** Sigil and other tools should consume privileged behavior through `aos`, not duplicate it.
- **Minimize TCC surface area.** Only the process that truly needs a protected capability should invoke it directly.
- **Incremental migration.** Start with packaging and install flow before deeper runtime refactors.

## Non-Goals

- Eliminating the initial macOS approval clicks entirely
- Bypassing TCC with unsupported scripting tricks
- Full notarization/distribution work in this phase
- Rewriting the runtime around XPC before the boundary is stable

## Root Causes

### 1. Protected Repo Location

The repository currently lives in a protected user folder (`~/Documents`). That triggers Files & Folders prompts for binaries accessing repo files or resources.

### 2. Unstable Executable Identity

Rebuilt raw binaries in a working tree do not present a stable app identity to macOS in the same way a packaged, signed app bundle does.

### 3. Multiple Permission Owners

More than one binary may currently touch:

- Accessibility APIs
- CGEvent taps / keystroke monitoring
- screen capture
- protected filesystem locations

That multiplies prompts and makes policy harder to reason about.

### 4. Mixed Launch Contexts

The same binary may be launched:

- directly from a terminal
- by an agent shell tool
- via `launchd`

Those contexts do not behave identically for TCC or endpoint tooling.

## Target Architecture

## Part 1: One Privileged Runtime

Define `aos` as the only runtime that should directly own privileged capabilities:

- Accessibility
- Input Monitoring / keystroke capture
- Screen Recording
- protected file access where unavoidable

Everything else should consume those capabilities through the daemon/control plane.

Examples:

- Sigil subscribes to `aos` instead of owning event taps where possible
- capture/perception requests go through `aos`
- future helper tools talk to the daemon instead of hitting protected APIs directly

## Part 2: Stable Packaged Identity

Create a packaged runtime with:

- a fixed bundle identifier, e.g. `com.agent-os.aos`
- a fixed install location, e.g. `/Applications/AOS.app` or `~/Applications/AOS.app`
- a consistent executable path inside the bundle
- consistent code signing for development use

Recommended shape:

- `AOS.app`
- executable at `Contents/MacOS/aos`

The packaged runtime becomes the canonical permission owner and service target.

## Part 3: Repo Separation from Protected Folders

Move the development repo out of `~/Documents`.

Recommended locations:

- `~/Code/agent-os`
- `~/Developer/agent-os`

This should eliminate the recurring Documents-folder prompt class for normal development and testing.

## Part 4: Service Management Targets the Installed Runtime

`aos service install/start/stop/restart` should eventually target the installed packaged runtime, not `./aos` in the working tree.

The service plist should point at the stable installed binary path, not a path inside the repo checkout.

## Part 5: Client Demotion

Sigil and similar tools should be reviewed for direct TCC-triggering calls and demoted where possible.

Priority categories to remove from clients:

- direct CGEventTap ownership
- direct screen-capture calls
- direct access to protected user folders

If a client must remain privileged temporarily, treat that as an explicit exception rather than the default model.

## Delivery Plan

### Phase 1: Stop the Worst Trigger

1. Move the repo out of `~/Documents`
2. Rebuild and retest
3. Confirm Files & Folders prompts stop recurring for normal repo access

### Phase 2: Package `aos`

1. Create a stable app bundle or packaged helper for `aos`
2. Assign a fixed bundle ID
3. Add a repeatable packaging script
4. Install to a stable path

Suggested commands:

```bash
aos runtime install
aos runtime status --json
aos runtime path
```

### Phase 3: Sign the Runtime

1. Sign the packaged runtime with an Apple Development certificate
2. Reuse the same identity on subsequent installs
3. Retest permission persistence across rebuild/update cycles

### Phase 4: Service Retargeting

1. Update `aos service install` to reference the installed packaged runtime
2. Stop using repo-local `./aos` as the `launchd` program target
3. Verify service behavior through the packaged path only

### Phase 5: Permission Ownership Audit

1. Audit Sigil and other cohorts for direct use of:
   - AX APIs
   - CGEvent taps
   - screen capture
   - protected folder access
2. Move those capabilities behind `aos` where feasible
3. Retest whether only the packaged runtime needs TCC approval

### Phase 6: Runtime Install UX

Create an explicit runtime-install flow that:

1. builds `aos`
2. packages it
3. signs it
4. installs it to the stable location
5. prints remaining required manual approvals

Suggested interface:

```bash
aos runtime install
aos runtime sign
aos runtime doctor --json
```

## Expected Outcome

After migration:

- macOS permissions are granted to one stable runtime identity
- repeated prompts should largely stop
- agents and cohorts operate through that trusted runtime
- service management uses the installed runtime rather than a mutable dev binary

The initial permission approvals still need to happen once, but they should not recur on every rebuild or launch pattern change.

## Open Questions

1. Should the stable runtime be a full `AOS.app` bundle or a signed helper binary plus wrapper?
2. How much privileged behavior can be removed from Sigil without regressing interactivity?
3. Should `aos runtime install` live inside the Swift CLI or begin as a repo script?
4. Is Apple Development signing sufficient for the intended local workflow, or do endpoint tools in this environment require a stricter signing/notarization path?

## Recommendation

Implement this in the following order:

1. Move the repo out of `~/Documents`
2. Package/sign `aos` as the single privileged runtime
3. Point `launchd` service management at the installed runtime
4. Reduce direct privilege ownership in Sigil and other cohorts

That order gives the fastest path to “approve once, then stop fighting recurring prompts.”
