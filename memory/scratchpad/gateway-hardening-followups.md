---
name: gateway-hardening follow-ups
status: validated-deferred
connects_to: packages/gateway/, ./aos CLI, docs/ (wiki + help text), AGENTS.md, shared/swift/ipc/runtime-paths.swift, tests/doctor-gateway.sh
updated: 2026-04-22
---

## What

Two follow-ups surfaced during `gateway-hardening` brainstorm (spec:
`docs/superpowers/specs/2026-04-22-gateway-hardening-design.md`). Neither
belongs in that spec's scope, but both are real.

## 1. Doc/help audit + alignment pass (last ~week of changes)

**Why it matters**: recent landings (gateway singleton fix #102, issue
hygiene skill, plan-retirement audit tweaks, Slack gateway surfacing, timeline
API fix) likely changed CLI surfaces, skills, or behaviors without
corresponding updates to:

- `./aos` help text
- wiki entries under `~/.config/aos/{mode}/wiki/`
- README/AGENTS.md/package CLAUDE.md
- any onboarding flow that still references retired paths

**Why not now**: orthogonal to gateway hardening. Needs its own sweep with a
diff range (e.g., `git log --since='1 week ago' --name-only`) and an
audit-driven plan. Scope includes gateway-hardening's new `./aos doctor
gateway` subcommand once that lands — so this pin naturally absorbs the new
work too.

**Revisit trigger**: after gateway-hardening lands, OR next time Michael hits
a doc that references something retired. Whichever comes first.

**Keywords**: doc drift, help audit, wiki alignment, post-landing sweep,
retirement hygiene.

## 2. Repo dev instructions for agents: CLI > MCP philosophy

**Why it matters**: during gateway-hardening brainstorm, I (Claude Opus 4.7)
proposed adding an MCP `doctor` tool without surfacing the repo rule "aos CLI
is canonical, MCP tools are optional adapter, not for dev work" (AGENTS.md
Repo-Wide Methods). Michael had to flag it. The rule IS in AGENTS.md, but it
didn't jump out to the agent at design-time — it reads as a runtime-usage
rule, not a design-time constraint.

**What to address**: make the CLI-first philosophy unmissable at design time.
Options (pick one during the pin-review session):

- Elevate to a "Design Principles" sibling of "Primitives First" in AGENTS.md
  — explicit line: "design-time: every new dev-facing affordance defaults to
  `./aos <verb>`; MCP tool only if external harness needs it."
- Add to `docs/SESSION_CONTRACT.md` as a bootstrap-visible rule.
- Fold into brainstorming-skill checklist so the question "could this be CLI
  instead of MCP?" is forced.

**Why not now**: this is meta-process work. Needs a small, deliberate edit
rather than a mid-task distraction. Also interacts with the doc-audit pin (1)
— may fold into that sweep.

**Revisit trigger**: alongside (1), or next time an agent proposes MCP-first
for dev-facing work.

**Keywords**: CLI-first, MCP adapter, agent instructions, design-time rule,
AGENTS.md.

## 3. `--quick` assertion in tests/doctor-gateway.sh is trivially-passing

**Connects to**: `tests/doctor-gateway.sh`, `packages/gateway/src/doctor.ts`,
Task 10 of `docs/superpowers/plans/2026-04-22-gateway-hardening.md`.

**Why it matters**: the Task 12 smoke asserts `--quick` mode omits
`.db.integrity`, but full mode also omits it when the db is empty — so under
the isolated root the assertion passes in both modes. The assertion is
supposed to prove `--quick` takes a faster path, but it can't distinguish
quick from full when the test fixture is an empty state root. Surfaced during
Task 12 advisor review.

**Why not now**: fixing it requires either (a) populating the isolated gateway
db before the doctor call, or (b) asserting on a different shape difference
that actually varies between quick and full. Both are Task 10 territory — the
doctor.ts output shape is the real subject — not Task 12's integration scope.
Attempted fix during the session would have expanded Task 12's blast radius.

**Revisit trigger**: next `./aos doctor gateway` iteration (help surface,
schema change, new fields) OR next time someone relies on `--quick` perf
claim in practice.

**Keywords**: quick mode, doctor assertion, test coverage gap, Task 10,
db.integrity, integration test.

## 4. Bundle-derive `aosInstallAppPath()` default for packaged-binary runs

**Connects to**: `shared/swift/ipc/runtime-paths.swift:71-73`,
`scripts/package-aos-runtime`, Task 14 of gateway-hardening plan.

**Why it matters**: `aosInstallAppPath()` defaults to
`~/Applications/AOS.app`. Any packaged binary launched from somewhere else
(smoke test against `dist/AOS.app`, VM, CI runner, user who installs to a
custom path) has to set `AOS_INSTALL_PATH` explicitly — otherwise installed-
mode path resolution silently targets the user-installed bundle. Task 14's
smoke hit this. Obvious bundle-derivation fix: when running inside an `.app`,
return the containing bundle path (mirroring `aosBundledRepoRoot`'s walk
pattern), with `~/Applications/AOS.app` as the fallback only when the
executable isn't inside a bundle. Env override still wins.

**Why not now**: too much blast radius for Task 14's scope. Other callers of
`aosInstallAppPath()` include `doctor.swift` reporting the expected install
path in `runtime.installed_app_path`, which currently reports the canonical
install location — bundle-derivation would change what users see there. Needs
deliberate design pass, not a mid-task patch. Task 14's `AOS_INSTALL_PATH`
override is the correct workaround for the immediate smoke need.

**Revisit trigger**: second caller hits the same friction (packaging-test
infrastructure grows, CI runs the packaged binary, or a second installed-mode
smoke for a different subsystem). OR when a real bug report surfaces from a
user installing outside the default path.

**Keywords**: aosInstallAppPath, bundle derivation, AOS_INSTALL_PATH,
packaged binary, Task 14, install path resolution, runtime-paths.swift.
