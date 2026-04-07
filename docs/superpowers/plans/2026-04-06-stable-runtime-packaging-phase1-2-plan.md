# Stable Runtime Packaging Phase 1-2 Plan

**Date:** 2026-04-06  
**Depends on:** `docs/superpowers/specs/2026-04-06-stable-runtime-packaging-and-one-time-permissions.md`  
**Scope:** Execute the first two phases of the stable-runtime migration:

1. remove the protected-folder trigger (`~/Documents`)
2. package `aos` into a stable installable runtime identity

## Outcome for This Plan

At the end of this plan:

- the repo no longer depends on being located in `~/Documents`
- `aos` can be packaged into a stable app/runtime location
- there is a repeatable install flow for the packaged runtime
- later service-control work can target the installed runtime instead of `./aos`

This plan does **not** yet retarget launchd or fully demote Sigil privileges. It creates the foundation for those changes.

## Milestone 1: Remove `~/Documents` Assumptions

### Objective

Make the project runnable from any normal developer path such as:

- `~/Code/agent-os`
- `~/Developer/agent-os`

### Tasks

1. Audit hardcoded repo paths.
   Check for paths like:
   - `~/Documents/GitHub/agent-os/...`
   - absolute paths to local HTML/assets/scripts
   - launchd/service paths derived from the current checkout

2. Replace hardcoded repo-root assumptions with computed paths.
   Preferred approach:
   - derive repo root from the current executable or script location
   - pass explicit paths through config/CLI where appropriate

3. Prioritize the current known offenders.
   Expected hotspots:
   - `apps/sigil/avatar-sub.swift`
   - `apps/sigil/avatar-spatial.swift`
   - any wrapper scripts that reference the repo by absolute path
   - launchd/service code using current working directory as identity

4. Rebuild and test from a non-Documents path.
   Minimum test:
   - clone or move repo to `~/Code/agent-os`
   - build `aos`
   - build `apps/sigil/build/avatar-sub`
   - run basic `aos doctor --json`
   - run `aos see capture ...`

### Acceptance Criteria

- no required runtime path contains `~/Documents/GitHub/agent-os`
- Sigil asset loading works without hardcoded repo paths
- the repo builds and runs from a non-protected folder

### Risks

- Sigil currently uses repo-local HTML/assets directly
- some scripts may assume the checkout root is the working directory

## Milestone 2: Package `aos` as a Stable Runtime

### Objective

Create a packaged runtime identity for `aos` with a fixed bundle ID and stable installed path.

### Deliverable

A repeatable build/install artifact such as:

- `dist/AOS.app`

installed to:

- `~/Applications/AOS.app`

or:

- `/Applications/AOS.app`

### Tasks

1. Choose the packaging shape.
   Recommended:
   - full `.app` bundle
   - executable at `Contents/MacOS/aos`
   - metadata in `Contents/Info.plist`

2. Add a packaging script.
   Suggested path:
   - `scripts/package-aos-runtime`

   Responsibilities:
   - build `aos`
   - create app bundle directories
   - copy executable into bundle
   - write `Info.plist`
   - optionally stage entitlements/signing inputs

3. Define stable identity values.
   Recommended initial values:
   - bundle ID: `com.agent-os.aos`
   - app name: `AOS`

4. Add a runtime install script or command.
   Suggested first pass:
   - `scripts/install-aos-runtime`

   Responsibilities:
   - package the app
   - copy to stable install location
   - print installed path
   - print next-step permission checklist

5. Add runtime status inspection.
   First pass can be script-based.
   Suggested output:
   - installed path
   - bundle ID
   - whether executable exists
   - whether signature is present

6. Verify launchability from the installed app path.
   Minimum test:
   - install packaged runtime
   - launch packaged executable directly
   - run `doctor --json`
   - confirm outputs match repo binary behavior

### Acceptance Criteria

- packaged runtime exists at a stable path
- bundle ID is fixed and inspectable
- executable can be launched from inside the app bundle
- installation can be repeated without manual file surgery

### Risks

- AppKit-based binaries sometimes behave differently inside bundles than from repo binaries
- packaging alone will not fix recurring prompts if clients still own privileged APIs

## Milestone 3: Signing Prep

### Objective

Prepare the packaged runtime for consistent local signing, without blocking packaging progress.

### Tasks

1. Add placeholders for signing configuration.
   Suggested inputs:
   - signing identity name
   - optional entitlements plist

2. Add a scriptable signing step.
   Suggested path:
   - `scripts/sign-aos-runtime`

3. Make signing optional for the first pass.
   Packaging should work before signing is fully integrated.

### Acceptance Criteria

- packaging and install do not depend on signing
- signing can be added without changing bundle structure

## Proposed Repo Additions

### New Scripts

- `scripts/package-aos-runtime`
- `scripts/install-aos-runtime`
- `scripts/sign-aos-runtime`

### Possible Future CLI Surface

Do not implement in Swift first unless the scripts prove too clumsy.

Later candidates:

- `aos runtime install`
- `aos runtime status --json`
- `aos runtime path`
- `aos runtime sign`

## Execution Order

1. Remove hardcoded `~/Documents` assumptions
2. Verify repo runs from `~/Code/agent-os`
3. Package `aos` into `AOS.app`
4. Install packaged runtime into a stable location
5. Add optional signing step
6. Only then retarget `aos service` to the installed runtime

## Recommended Owner Split

### Track A: Repo Path Audit

Focus:
- Sigil path cleanup
- repo-root discovery
- removing absolute checkout assumptions

### Track B: Runtime Packaging

Focus:
- app bundle creation
- Info.plist
- install location
- repeatable packaging/install scripts

These tracks can run in parallel because they touch mostly different files.

## Verification Checklist

### Phase 1 Verification

- repo moved or cloned to `~/Code/agent-os`
- `bash build.sh`
- `bash apps/sigil/build-avatar.sh`
- `./aos doctor --json`
- `./aos see capture main --out /tmp/aos-test.png`

### Phase 2 Verification

- package script creates `AOS.app`
- install script places app in stable location
- packaged executable launches successfully
- packaged executable can run `doctor --json`
- bundle metadata reports expected bundle ID

## Recommendation

Start with Milestone 1 immediately. It is the fastest path to reducing prompt churn and will expose the hardcoded path debt that must be removed before packaging can be trustworthy.

Then implement Milestone 2 as scripts, not native CLI commands. Once the packaging/install flow is stable, fold it into `aos runtime ...` if that still feels justified.
