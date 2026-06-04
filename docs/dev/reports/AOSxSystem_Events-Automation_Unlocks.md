# AOS × System Events: What the TCC Automation Grant Unlocks

## Executive Summary

Granting AOS the TCC `kTCCServiceAppleEvents` permission with `com.apple.systemevents` as the target is one of the highest-leverage single automation grants available on macOS. System Events is the OS's own scripting agent — not just another scriptable app. Its dictionary spans eight distinct capability domains: process/UI control, system preferences scripting, file and property list manipulation, folder actions, input event synthesis, network location management, login item management, and disk/volume operations. Because Accessibility (AX) is routed *through* System Events for GUI scripting, a single `AOS → System Events` Automation grant gives AOS a broad substrate that partially overlaps with, and in several areas *extends beyond*, what raw Accessibility alone provides. The key insight is that many System Events capabilities are **Apple-Event-native** — they do not require the Accessibility permission at all — so they represent a genuinely additive surface.

***

## What System Events Actually Is

System Events (`/System/Library/CoreServices/System Events.app`, bundle ID `com.apple.systemevents`) is a persistent background process Apple ships as part of macOS. It is the scripting backbone for the entire platform: it exposes the macOS Accessibility framework to AppleScript via its **Processes Suite**, and independently exposes platform-level capabilities like preferences, login items, network locations, and plist manipulation through separate named suites.[1][2]

The critical architectural point: System Events is not just a conduit to the AX layer. Many of its suites operate entirely via Apple Events without touching the Accessibility stack. This means AOS needs different, non-overlapping TCC grants to access different System Events capabilities:

- **`kTCCServiceAppleEvents` → `com.apple.systemevents`**: Unlocks all Apple-Event-native suites (preferences, login items, network, plists, folder actions, disk events, keystroke synthesis via the UI Scripting pathway)
- **`kTCCServiceAccessibility`**: Required separately if AOS wants to introspect *arbitrary* AX elements on arbitrary processes via direct AXUIElement calls

The two permissions complement each other and should both be held by AOS, but they are distinct grants with different capability footprints.[3][4]

***

## The System Events Scripting Dictionary: Suite-by-Suite Breakdown

System Events ships with eight major suites. What follows is a precise capability inventory relevant to AOS architecture.

### 1. Processes Suite (UI/GUI Scripting)

This is the suite that routes GUI scripting through the Accessibility frameworks. With the Automation grant to System Events, AOS can:[2][5]

- **Enumerate all running GUI processes** — get name, PID, bundle ID, frontmost status of every window-server-connected process[6]
- **Traverse the full AX hierarchy** of any process: windows → groups → buttons → text fields → menu bars → menus → menu items → toolbars, etc.[2]
- **Click buttons, select menu items, navigate submenus, toggle checkboxes, enter text into fields** on any app — even apps with no native AppleScript dictionary[7][2]
- **Key code and keystroke injection**: `keystroke`, `key code`, with modifier key composition (`command down`, `shift down`, etc.) — sent to the frontmost process or a targeted process[8][9]
- **Read UI element attributes**: `value`, `title`, `description`, `enabled`, `focused`, `accessibility description`, `role`, `subrole`, `AXActions`
- **Perform AXActions directly**: `click`, `press`, `increment`, `decrement`, `confirm`, `pick`, `select`, `show default UI`

**Interaction with AX permission**: The Processes Suite *uses* the Accessibility frameworks internally. This means that if AOS has the Automation grant to System Events but lacks a separate Accessibility grant for itself, it can still do GUI scripting — but only through the System Events process intermediary. Some corner cases (e.g., observing AX notifications) still require a direct Accessibility grant on AOS itself.[10]

**AOS architectural implication**: `automation.send("com.apple.systemevents", uiScript)` is the clean path for all GUI scripting actions today. The agent does not need to manage AX handles directly for common click/read/type operations.

### 2. System Preferences / System Settings Suites

System Events has built-in AppleScript suites for reading and writing system-level preferences, many of which are **not reachable through the Accessibility layer alone**:[1]

| Suite / Object | Read | Write | Notes |
|---|---|---|---|
| `appearance preferences` | ✓ | ✓ | Scroll bar behavior, highlight color, font smoothing, dock minimize effect |
| `dock preferences` | ✓ | ✓ | Size, magnification, position (left/bottom/right), autohide, animate |
| `desktop` (per-display) | ✓ | ✓ | Desktop picture, rotation interval, random order |
| `security preferences` | ✓ | ✓ | Require password to wake, automatic login, log-out-when-inactive |
| `expose preferences` | ✓ | ✓ | Hot corners, Mission Control shortcuts, Spaces bindings |
| `CD and DVD preferences` | ✓ | ✓ | Insertion actions per disc type |
| `accounts` (current user) | ✓ | partial | Read all users; write only current user's picture |
| `network preferences` | ✓ | ✓ | Get/set current network location by name |

These are **direct Apple Events against system state** — not UI-scripted clicks on the Settings app. This makes them faster, more reliable, and immune to UI layout changes between macOS versions. An agent that has the Automation grant to System Events can, for example, change the current network location in a single, reliable command rather than navigating through multiple Settings panes.[1]

### 3. Network Locations

System Events exposes `network preferences` with full location enumeration and switching:[11][1]

```applescript
tell application "System Events"
  tell network preferences
    get name of every location
    -- {"Automatic", "Work VPN", "Home"}
    set current location to location "Work VPN"
  end tell
end tell
```

This is a meaningful capability for an agent managing its own execution environment or a user's context. It also underpins more complex automation: switching to a specific network profile before initiating a workflow that requires particular network access.

### 4. Login Items Suite

System Events is the canonical, TCC-governed path for managing user login items:[12][1]

- `get login items` — enumerate all login items (name, path, hidden status)
- `make new login item at end of login items with properties {path:..., hidden:...}` — add a login item
- `delete login item named "..."` — remove a login item

**AOS relevance**: This allows AOS to install or remove its own daemon or helper tools as login items, and to manage user-installed agents, without needing root or a separate installer mechanism. This is a persistence and lifecycle management primitive for the agent itself.

### 5. Property List (Plist) Suite

System Events can read and write arbitrary `.plist` files at the scripting level:[13][14]

```applescript
tell application "System Events"
  tell property list file "/Users/mike/Library/Preferences/com.example.app.plist"
    set value of property list item "SomePreference" to true
  end tell
end tell
```

This is a high-value capability for an agentic system because:
- **App preferences can be modified without launching the app** — AOS can configure app behavior before handing off control
- **User defaults can be read for state inference** — many macOS apps store their entire configuration state in `~/Library/Preferences/`
- **AOS can manage its own configuration plists** directly, reading and writing structured data without shell commands
- Plists under `/Library/Preferences/` (system-wide) require elevated privileges, but `~/Library/Preferences/` (user scope) is fully accessible

### 6. Folder Actions Suite

System Events manages the macOS Folder Actions subsystem, which attaches AppleScript handlers to directories:[15][16]

- Enable/disable folder actions globally
- Attach scripts to specific folders (triggered on add/remove/open events)
- Remove attached folder action scripts
- List all folder-action-enabled folders and their scripts

**AOS relevance**: Folder Actions are a **reactive automation primitive** — AOS can register a behavior to trigger whenever content appears in or leaves a watched directory. This is a building block for watch-folder workflows, file processing pipelines, and drop-zone patterns: "whenever a file lands in `~/Desktop/IncomingScans/`, run this processing workflow."

### 7. Disk Events Suite

System Events can respond to disk mount/unmount events and enumerate volumes. While unmounting volumes directly is typically handled via `diskutil` shell commands, System Events provides the AppleScript-native path to:[15]

- Get properties of mounted volumes (disk, POSIX path, name, free space, capacity, ejectable status)
- Enumerate all mounted disks and volumes
- Handle disk-related folder actions

### 8. Keystroke and Key Code Synthesis

One of the most operationally significant capabilities: System Events synthesizes **keyboard events at the application level** using the `keystroke` and `key code` commands:[17][8]

```applescript
tell application "System Events"
  keystroke "v" using {command down}  -- paste
  keystroke return                     -- confirm dialog
  key code 53                          -- Escape
  keystroke tab                        -- tab to next field
end tell
```

These events are sent to the **frontmost application** unless scoped inside a `tell process "..."` block. This is a critical distinction from `PostEvent` (CGEventPost), which is a lower-level synthesizer: System Events `keystroke` is higher-level, handles character mapping, and works through the standard input pipeline.

**When to prefer this over PostEvent**: For text input and menu navigation, System Events `keystroke` is more reliable across different keyboard layouts and application input models. PostEvent is better for synthesizing raw hardware-level events (e.g., precise mouse coordinates).

***

## The Indirect Amplifier: System Events → Other Apps

As the prior agent discussion noted, System Events is itself a **target** for further Apple Events escalation. If AOS gets Automation access to System Events, and System Events can in turn reach other processes through the AX layer, this creates a form of transitive capability. The critical cases:[18][3]

**Keyboard Macro Amplification**: By using `tell process "..." of application "System Events"`, AOS can target keystroke injection at any running process without that process being the frontmost window — which means AOS can drive background apps without disrupting the user's active context.

**System Settings Navigation**: On macOS Ventura/Sonoma/Sequoia, System Settings became a single SwiftUI app that is only partially scriptable via Apple Events. The reliable path for accessing Settings panes is now UI scripting via System Events. This means `AOS → System Events (Automation) + AOS (Accessibility)` is the combination that unlocks programmatic access to all system preferences.[19][20]

**Security Limits**: Certain operations remain sandboxed regardless of System Events access:
- Adding an app to the Automation TCC table itself requires user interaction — this cannot be scripted[21]
- SIP-protected paths (`/System`, `/usr`) cannot be written even through System Events
- The `accounts preferences` suite is read-only except for the current user's picture
- Keychain access still requires a separate TCC grant or user authentication

***

## The Automation Grant + Accessibility Synergy for AOS

The most powerful configuration for AOS is holding both `kTCCServiceAccessibility` (already present) and `kTCCServiceAppleEvents → com.apple.systemevents`. This is because the two permissions cover different access patterns:

| Operation | Accessibility Only | Automation (SE) Only | Both |
|---|---|---|---|
| Click a button in a running app | ✓ (direct AX) | ✓ (via SE Process Suite) | ✓ |
| Inspect arbitrary AX element properties | ✓ | ✓ (via SE) | ✓ |
| Observe AX notifications (element focus change) | ✓ | ✗ | ✓ |
| Change Dock position | ✗ | ✓ (SE dock preferences) | ✓ |
| Switch network location | ✗ | ✓ (SE network preferences) | ✓ |
| Add/remove login item | ✗ | ✓ (SE login items) | ✓ |
| Read/write arbitrary plist | ✗ | ✓ (SE plist suite) | ✓ |
| Manage folder actions | ✗ | ✓ (SE folder actions) | ✓ |
| Synthesize keystrokes (high-level) | partial | ✓ (SE keystroke) | ✓ |
| Synthesize mouse events (low-level) | ✓ (PostEvent) | ✗ | ✓ |
| Drive apps with no AX hierarchy | ✗ | ✗ | ✗ |
| Modify TCC database directly | ✗ | ✗ | ✗ |

The table shows that the Automation → System Events grant adds an entirely new set of **system-state management operations** that Accessibility alone cannot reach.

***

## AOS Architecture Recommendations

### Capability Model

Following the `automation.facts / automation.prompt / automation.send` pattern already suggested, System Events should be modeled as a **special first-class target** with a richer capability taxonomy than other targets:

```
automation.target("com.apple.systemevents") {
  .ui_scripting          // Process Suite — GUI scripting on any app
  .input_synthesis       // keystroke, key code
  .preferences           // dock, appearance, security, desktop, etc.
  .network_locations     // get/set current location
  .login_items           // add/remove/list
  .plist_rw              // read/write ~/Library/Preferences/**
  .folder_actions        // attach/detach/enable/disable
  .disk_events           // volume enumeration
}
```

Each sub-capability should have its own policy gate, because the risk profiles differ substantially: `plist_rw` on a target app's preference file is a high-impact, persistent write; `input_synthesis` is ephemeral. The agent policy layer should require explicit approval at the sub-capability level, not just a blanket "has System Events."

### Prompt Design

When AOS needs to prompt the user for the Automation grant to System Events, the prompt should communicate *which sub-capabilities* are being requested, since the grant is all-or-nothing at the TCC level but the agent can self-limit at runtime:

> "AOS wants to control System Events to: switch your network location based on context, manage login items, and script your app interfaces. This does not give AOS access to your Keychain or TCC settings."

### Triggering the TCC Dialog

The TCC permission dialog for `AOS → System Events` is triggered automatically the first time AOS sends an Apple Event to `com.apple.systemevents` from a process that has the `NSAppleEventsUsageDescription` key in its `Info.plist` and the `com.apple.security.automation.apple-events` entitlement. The minimal trigger:[22][18]

```swift
// Swift — triggering the dialog
let script = NSAppleScript(source: "tell application \"System Events\" to get name")
var error: NSDictionary?
script?.executeAndReturnError(&error)
// First run: dialog fires for AOS → System Events
```

The `osascript` CLI equivalent:
```bash
osascript -e 'tell application "System Events" to get name'
```

Both approaches will surface the TCC prompt if the grant does not yet exist.[23][4]

### Security Posture

Holding `AOS → System Events` Automation access is a meaningful capability surface. For threat modeling:

- **Plist writes are persistent**: modifying `~/Library/Preferences/` plists changes application behavior on next launch — this is a non-ephemeral side effect
- **Login item manipulation is persistent**: adding a login item survives reboots
- **Keystroke synthesis is high-risk in agentic context**: prompt injection attacks against an LLM-powered agent with keystroke synthesis access can type arbitrary content into any app[24]
- **Network location switching affects all network traffic**: changing the active location is a system-wide, immediate effect

The recommendation is to implement **confirmation gates** for the persistent and system-wide operations (plist writes, login item changes, network location switches) and keep keystroke synthesis ephemeral and session-scoped. Read-only operations (enumerating processes, reading preferences, listing login items) can run without confirmation.

***

## What System Events Cannot Do

For completeness, the operations that remain outside the `AOS → System Events` Automation scope, even with both Accessibility and Automation grants:

- **Cannot add apps to TCC tables** — requires user interaction at the OS level; cannot be scripted by any means[21]
- **Cannot write to SIP-protected paths** — `/System`, `/usr`, `/bin` remain protected
- **Cannot access Keychain** — requires `kTCCServiceKeychainAccess` or SecKeychainAPI with user confirmation
- **Cannot manage system daemons or launchd units** — requires `launchctl` with appropriate privilege
- **Cannot change TCC-protected hardware** (microphone, camera) — those are separate TCC grants
- **Cannot send Apple Events to other apps without additional per-app grants** — `AOS → System Events` does not cascade to `AOS → Finder` or `AOS → Safari`; those require separate Automation grants[4][3]
- **Cannot access Full Disk Access paths** — `~/Library/Application Support/` for other apps, Time Machine backups, etc. require `kTCCServiceSystemPolicyAllFiles`

***

## Relationship to the Broader AOS Automation Taxonomy

In the agent's existing framing — Accessibility as the general fallback for arbitrary UI, Automation as a target-scoped higher-level path — System Events represents a special case: it is an Automation target that **acts as a meta-layer**. Granting `AOS → System Events` is architecturally equivalent to granting a combination of:

1. A system preferences API
2. A login persistence manager
3. A network context manager
4. A plist database engine
5. A folder-watch subsystem
6. A keyboard input synthesizer
7. A GUI scripting broker for all other apps

This is why the prior agent analysis correctly identified System Events as a "powerful target" and why its Automation grant deserves dedicated modeling rather than being treated as one Automation grant among many. The right framing is: `AOS → Finder` and `AOS → Safari` are leaf-node Automation grants. `AOS → System Events` is a trunk-node grant whose capability surface touches most other automation concerns.
