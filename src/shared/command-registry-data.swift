// command-registry-data.swift — Static command registry data

import Foundation

// MARK: - Convenience Builders

/// Shorthand for common execution profiles
func execReadOnly(daemon: Bool = false, permissions: Bool = false) -> ExecutionMeta {
    ExecutionMeta(readOnly: true, mutatesState: false, interactive: false, streaming: false,
                  autoStartsDaemon: daemon, requiresPermissions: permissions, supportsDryRun: false)
}

func execMutating(daemon: Bool = false, permissions: Bool = false, dryRun: Bool = false) -> ExecutionMeta {
    ExecutionMeta(readOnly: false, mutatesState: true, interactive: false, streaming: false,
                  autoStartsDaemon: daemon, requiresPermissions: permissions, supportsDryRun: dryRun)
}

func execStreaming(daemon: Bool = true, permissions: Bool = false) -> ExecutionMeta {
    ExecutionMeta(readOnly: true, mutatesState: false, interactive: false, streaming: true,
                  autoStartsDaemon: daemon, requiresPermissions: permissions, supportsDryRun: false)
}

func execInteractive(daemon: Bool = true, permissions: Bool = false) -> ExecutionMeta {
    ExecutionMeta(readOnly: false, mutatesState: false, interactive: true, streaming: true,
                  autoStartsDaemon: daemon, requiresPermissions: permissions, supportsDryRun: false)
}

/// Shorthand for common output profiles
let outJSON = OutputMeta(defaultMode: .json, streaming: false, supportsJsonFlag: false, errorMode: "json_stderr")
let outJSONFlag = OutputMeta(defaultMode: .text, streaming: false, supportsJsonFlag: true, errorMode: "json_stderr")
let outText = OutputMeta(defaultMode: .text, streaming: false, supportsJsonFlag: false, errorMode: "json_stderr")
let outNDJSON = OutputMeta(defaultMode: .ndjson, streaming: true, supportsJsonFlag: false, errorMode: "json_stderr")
let outNone = OutputMeta(defaultMode: .none, streaming: false, supportsJsonFlag: false, errorMode: "json_stderr")
let outFile = OutputMeta(defaultMode: .none, streaming: false, supportsJsonFlag: false, errorMode: "json_stderr")

/// Shorthand for a simple flag arg
func flag(_ id: String, _ token: String, _ summary: String, type: ValueType = .string, required: Bool = false, default defaultVal: JSONValue? = nil, variadic: Bool = false, discovery: [DiscoverySource]? = nil) -> ArgDescriptor {
    ArgDescriptor(id: id, kind: .flag, token: token, summary: summary, valueType: type,
                  required: required, defaultValue: defaultVal, variadic: variadic, discovery: discovery)
}

/// Shorthand for a positional arg
func pos(_ id: String, _ summary: String, type: ValueType = .string, required: Bool = true, variadic: Bool = false, discovery: [DiscoverySource]? = nil) -> ArgDescriptor {
    ArgDescriptor(id: id, kind: .positional, token: nil, summary: summary, valueType: type,
                  required: required, defaultValue: nil, variadic: variadic, discovery: discovery)
}

// MARK: - Registry Population

func buildCommandRegistry() -> [CommandDescriptor] {
    var reg: [CommandDescriptor] = []

    // ── see ───────────────────────────────────────────────
    let captureTargets: [DiscoverySource] = [
        .staticValues(["main", "external", "user_active", "selfie", "mouse", "all"]),
        .command(path: ["see", "zone"], formId: "zone-list")
    ]

    reg.append(CommandDescriptor(path: ["see"], summary: "Perception — query what's on screen", forms: [
        InvocationForm(id: "see-cursor", usage: "aos see cursor",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(permissions: true),
            output: outJSON,
            examples: ["aos see cursor"]),
        InvocationForm(id: "see-capture", usage: "aos see capture <target> [options]",
            args: [
                pos("target", "Capture target", discovery: captureTargets),
                flag("out", "--out", "Output file path", default: .string("./screenshot.png")),
                flag("base64", "--base64", "Output base64 instead of file", type: .bool),
                flag("format", "--format", "Image format",
                     type: .enumeration([
                        EnumValue(value: "png", summary: "Lossless PNG (default)"),
                        EnumValue(value: "jpg", summary: "Lossy JPEG"),
                        EnumValue(value: "heic", summary: "HEIC format")
                     ]), default: .string("png")),
                flag("quality", "--quality", "Image quality",
                     type: .enumeration([
                        EnumValue(value: "high", summary: "Full resolution (default)"),
                        EnumValue(value: "med", summary: "Medium resolution"),
                        EnumValue(value: "low", summary: "Low resolution")
                     ]), default: .string("high")),
                flag("window", "--window", "Capture window only", type: .bool),
                flag("crop", "--crop", "Crop spec: x,y,w,h or named region (top-half, etc.)"),
                flag("region", "--region", "Global CG region in points: x,y,w,h"),
                flag("canvas", "--canvas", "Capture a canvas by id"),
                flag("channel", "--channel", "Capture a focus channel by id"),
                flag("grid", "--grid", "Grid overlay (e.g. 4x3)"),
                flag("xray", "--xray", "AX element traversal overlay", type: .bool),
                flag("label", "--label", "Badge annotations (implies --xray)", type: .bool),
                flag("perception", "--perception", "Include topology + resolved surface geometry for the capture (segments when spanning displays)", type: .bool),
                flag("show-cursor", "--show-cursor", "Include cursor in capture", type: .bool),
                flag("highlight-cursor", "--highlight-cursor", "Highlight cursor position", type: .bool),
                flag("radius", "--radius", "Radius for mouse target capture", type: .int),
                flag("delay", "--delay", "Delay before capture in seconds", type: .float),
                flag("clipboard", "--clipboard", "Also copy to clipboard", type: .bool),
                flag("draw-rect", "--draw-rect", "Draw rectangle overlay: x,y,w,h color"),
                flag("interactive", "--interactive", "Native selection rectangle", type: .bool),
                flag("wait-for-click", "--wait-for-click", "Wait for click then capture", type: .bool)
            ],
            stdin: nil,
            constraints: ConstraintSet(requires: nil, conflicts: [["base64", "out"], ["crop", "region"], ["window", "region"], ["window", "canvas"], ["window", "channel"], ["region", "canvas", "channel"]], oneOf: nil, implies: ["label": ["xray"]]),
            execution: execReadOnly(permissions: true),
            output: outFile,
            examples: [
                "aos see capture main --out /tmp/screen.png",
                "aos see main --base64 --format jpg",
                "aos see capture user_active --window --xray",
                "aos see capture --canvas canvas-inspector --perception --out /tmp/inspector.png",
                "aos see capture --channel slack-msgs --perception --out /tmp/messages.png",
                "aos see capture --region 1172,442,320,480 --perception --out /tmp/inspector.png",
                "aos see mouse --radius 200"
            ]),
        InvocationForm(id: "see-observe", usage: "aos see observe [--depth N] [--rate mode]",
            args: [
                flag("depth", "--depth", "AX traversal depth 0-3", type: .int, default: .int(1)),
                flag("rate", "--rate", "Stream rate",
                     type: .enumeration([
                        EnumValue(value: "continuous", summary: "Continuous updates"),
                        EnumValue(value: "on-change", summary: "Only on change"),
                        EnumValue(value: "on-settle", summary: "After cursor settles")
                     ]))
            ],
            stdin: nil, constraints: nil,
            execution: execStreaming(daemon: true, permissions: true),
            output: outNDJSON,
            examples: ["aos see observe --depth 2"]),
        InvocationForm(id: "see-list", usage: "aos see list",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(permissions: true),
            output: outJSON,
            examples: ["aos see list"]),
        InvocationForm(id: "see-selection", usage: "aos see selection",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(permissions: true),
            output: outJSON,
            examples: ["aos see selection"])
    ]))

    // ── see zone ─────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["see", "zone"], summary: "Manage named capture zones", forms: [
        InvocationForm(id: "zone-save", usage: "aos see zone save <name> [--target <display>] <x,y,w,h>",
            args: [
                pos("name", "Zone name"),
                flag("target", "--target", "Target display"),
                pos("bounds", "Zone bounds as x,y,w,h")
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSON,
            examples: ["aos see zone save header --target main 0,0,1920,100"]),
        InvocationForm(id: "zone-define", usage: "aos see zone define <name> [--target <display>]",
            args: [
                pos("name", "Zone name"),
                flag("target", "--target", "Target display")
            ],
            stdin: nil, constraints: nil,
            execution: execInteractive(daemon: false, permissions: true),
            output: outJSON,
            examples: ["aos see zone define header"]),
        InvocationForm(id: "zone-list", usage: "aos see zone list",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSON,
            examples: ["aos see zone list"]),
        InvocationForm(id: "zone-delete", usage: "aos see zone delete <name>",
            args: [pos("name", "Zone name")],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSON,
            examples: ["aos see zone delete header"])
    ]))

    // ── show ──────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["show"], summary: "Display — manage overlays and render", forms: [
        InvocationForm(id: "show-create", usage: "aos show create --id <name> [positioning] [content] [options]",
            args: [
                flag("id", "--id", "Canvas identifier", required: true),
                flag("at", "--at", "Position as x,y,w,h"),
                flag("html", "--html", "Inline HTML content"),
                flag("file", "--file", "HTML file path"),
                flag("url", "--url", "URL to load (supports aos:// scheme)"),
                flag("interactive", "--interactive", "Allow mouse interaction", type: .bool),
                flag("focus", "--focus", "Focus the canvas", type: .bool),
                flag("ttl", "--ttl", "Time to live (e.g. 5s, 10m, none)"),
                flag("scope", "--scope", "Canvas scope",
                     type: .enumeration([
                        EnumValue(value: "connection", summary: "Removed when client disconnects"),
                        EnumValue(value: "global", summary: "Persists after disconnect")
                     ]), default: .string("connection")),
                flag("auto-project", "--auto-project", "Auto-projection mode",
                     type: .enumeration([
                        EnumValue(value: "none", summary: "No projection"),
                        EnumValue(value: "cursor", summary: "Follow cursor"),
                        EnumValue(value: "window", summary: "Follow window")
                     ])),
                flag("track", "--track", "Track target",
                     type: .enumeration([
                        EnumValue(value: "union", summary: "Track display union bounds")
                     ])),
                flag("anchor-window", "--anchor-window", "Anchor to window ID"),
                flag("anchor-channel", "--anchor-channel", "Anchor to focus channel ID"),
                flag("offset", "--offset", "Offset from anchor as x,y,w,h")
            ],
            stdin: nil,
            constraints: ConstraintSet(requires: nil, conflicts: [["at", "track"], ["html", "file", "url"]], oneOf: nil, implies: nil),
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: [
                "aos show create --id ball --at 100,100,200,200 --html \"<div>hello</div>\"",
                "aos show create --id avatar --url aos://sigil/renderer/index.html --track union"
            ]),
        InvocationForm(id: "show-update", usage: "aos show update --id <name> [options]",
            args: [
                flag("id", "--id", "Canvas identifier", required: true),
                flag("at", "--at", "New position as x,y,w,h"),
                flag("html", "--html", "New HTML content"),
                flag("file", "--file", "New HTML file path"),
                flag("url", "--url", "New URL"),
                flag("focus", "--focus", "Focus the canvas", type: .bool),
                flag("ttl", "--ttl", "New TTL"),
                flag("auto-project", "--auto-project", "New projection mode"),
                flag("track", "--track", "New track target"),
                flag("anchor-window", "--anchor-window", "New anchor window"),
                flag("offset", "--offset", "New offset")
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos show update --id ball --at 200,200,200,200"]),
        InvocationForm(id: "show-remove", usage: "aos show remove --id <name>",
            args: [flag("id", "--id", "Canvas identifier", required: true)],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos show remove --id ball"]),
        InvocationForm(id: "show-remove-all", usage: "aos show remove-all",
            args: [],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos show remove-all"]),
        InvocationForm(id: "show-list", usage: "aos show list",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(daemon: true),
            output: outJSON,
            examples: ["aos show list"]),
        InvocationForm(id: "show-render", usage: "aos show render [--html <html>] [--width N] [--height N] [--out path]",
            args: [
                flag("html", "--html", "HTML to render"),
                flag("width", "--width", "Image width in pixels", type: .int, default: .int(800)),
                flag("height", "--height", "Image height in pixels", type: .int, default: .int(600)),
                flag("out", "--out", "Output file path", default: .string("./render.png"))
            ],
            stdin: StdinDescriptor(supported: true, usedWhen: "no --html provided", contentType: "html"),
            constraints: nil,
            execution: execReadOnly(),
            output: outFile,
            examples: ["aos show render --html \"<h1>Hi</h1>\" --out /tmp/test.png"]),
        InvocationForm(id: "show-eval", usage: "aos show eval --id <name> --js <javascript>",
            args: [
                flag("id", "--id", "Canvas identifier", required: true),
                flag("js", "--js", "JavaScript to execute", required: true)
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos show eval --id avatar --js \"document.title\""]),
        InvocationForm(id: "show-listen", usage: "aos show listen",
            args: [],
            stdin: nil, constraints: nil,
            execution: execStreaming(daemon: true),
            output: outNDJSON,
            examples: ["aos show listen"]),
        InvocationForm(id: "show-ping", usage: "aos show ping",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(daemon: true),
            output: outJSON,
            examples: ["aos show ping"]),
        InvocationForm(id: "show-wait", usage: "aos show wait --id <name> [--manifest <name>] [--js <condition>] [--timeout <dur>] [--auto-start] [--json]",
            args: [
                flag("id", "--id", "Canvas identifier", required: true),
                flag("manifest", "--manifest", "Expected manifest name"),
                flag("js", "--js", "Additional JavaScript readiness condition"),
                flag("timeout", "--timeout", "Maximum wait duration", default: .string("5s")),
                flag("auto-start", "--auto-start", "Auto-start the daemon if needed", type: .bool),
                flag("json", "--json", "Emit JSON output", type: .bool)
            ],
            stdin: nil, constraints: nil,
            execution: execReadOnly(daemon: true),
            output: outJSONFlag,
            examples: [
                "aos show wait --id canvas-inspector --manifest canvas-inspector",
                "aos show wait --id sigil-workbench --js '!!document.querySelector(\".surface-frame\")'"
            ]),
        InvocationForm(id: "show-exists", usage: "aos show exists --id <name>",
            args: [flag("id", "--id", "Canvas identifier", required: true)],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSON,
            examples: ["aos show exists --id avatar"]),
        InvocationForm(id: "show-get", usage: "aos show get --id <name>",
            args: [flag("id", "--id", "Canvas identifier", required: true)],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSON,
            examples: ["aos show get --id avatar"]),
        InvocationForm(id: "show-to-front", usage: "aos show to-front --id <name>",
            args: [flag("id", "--id", "Canvas identifier", required: true)],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos show to-front --id avatar"]),
        InvocationForm(id: "show-post", usage: "aos show post --id <name> --event <json>",
            args: [
                flag("id", "--id", "Canvas identifier", required: true),
                flag("event", "--event", "JSON event payload to post", type: .json, required: true)
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos show post --id avatar --event '{\"type\":\"update\"}'"])
    ]))

    // ── do ────────────────────────────────────────────────
    let permAction = execMutating(permissions: true)

    reg.append(CommandDescriptor(path: ["do"], summary: "Action — execute mouse, keyboard, AX actions", forms: [
        InvocationForm(id: "do-click", usage: "aos do click <x,y> [--right] [--double] [--dwell N]",
            args: [
                pos("coords", "Click coordinates as x,y"),
                flag("right", "--right", "Right-click", type: .bool),
                flag("double", "--double", "Double-click", type: .bool),
                flag("dwell", "--dwell", "Dwell time in ms", type: .int)
            ],
            stdin: nil, constraints: nil,
            execution: permAction,
            output: outJSON,
            examples: ["aos do click 500,300", "aos do click 500,300 --right"]),
        InvocationForm(id: "do-hover", usage: "aos do hover <x,y>",
            args: [pos("coords", "Target coordinates as x,y")],
            stdin: nil, constraints: nil,
            execution: permAction,
            output: outJSON,
            examples: ["aos do hover 500,300"]),
        InvocationForm(id: "do-drag", usage: "aos do drag <x1,y1> <x2,y2> [--speed N]",
            args: [
                pos("from", "Start coordinates as x,y"),
                pos("to", "End coordinates as x,y"),
                flag("speed", "--speed", "Drag speed in pixels/sec", type: .int)
            ],
            stdin: nil, constraints: nil,
            execution: permAction,
            output: outJSON,
            examples: ["aos do drag 100,100 500,500"]),
        InvocationForm(id: "do-scroll", usage: "aos do scroll <x,y> [--dx N] [--dy N]",
            args: [
                pos("coords", "Scroll position as x,y"),
                flag("dx", "--dx", "Horizontal scroll amount", type: .int),
                flag("dy", "--dy", "Vertical scroll amount", type: .int)
            ],
            stdin: nil,
            constraints: ConstraintSet(requires: nil, conflicts: nil, oneOf: [["dx", "dy"]], implies: nil),
            execution: permAction,
            output: outJSON,
            examples: ["aos do scroll 500,300 --dy -3"]),
        InvocationForm(id: "do-type", usage: "aos do type <text> [--delay ms] [--variance N]",
            args: [
                pos("text", "Text to type", variadic: true),
                flag("delay", "--delay", "Inter-key delay in ms", type: .int),
                flag("variance", "--variance", "Delay variance for natural cadence", type: .int)
            ],
            stdin: nil, constraints: nil,
            execution: permAction,
            output: outJSON,
            examples: ["aos do type \"hello world\""]),
        InvocationForm(id: "do-key", usage: "aos do key <combo>",
            args: [pos("combo", "Key combination (e.g. cmd+s, ctrl+shift+tab)")],
            stdin: nil, constraints: nil,
            execution: permAction,
            output: outJSON,
            examples: ["aos do key \"cmd+s\"", "aos do key \"ctrl+shift+tab\""]),
        InvocationForm(id: "do-press", usage: "aos do press --pid <pid> --role <role> [filters]",
            args: [
                flag("pid", "--pid", "Process ID", type: .int, required: true),
                flag("role", "--role", "AX role to match", required: true),
                flag("title", "--title", "Filter by title"),
                flag("label", "--label", "Filter by label"),
                flag("identifier", "--identifier", "Filter by identifier"),
                flag("index", "--index", "Match by index", type: .int),
                flag("near", "--near", "Prefer element near x,y"),
                flag("match", "--match", "Regex match on value"),
                flag("depth", "--depth", "AX traversal depth", type: .int),
                flag("timeout", "--timeout", "Timeout in ms", type: .int)
            ],
            stdin: nil, constraints: nil,
            execution: permAction,
            output: outJSON,
            examples: ["aos do press --pid 1234 --role AXButton --title Save"]),
        InvocationForm(id: "do-set-value", usage: "aos do set-value --pid <pid> --role <role> --value <value> [filters]",
            args: [
                flag("pid", "--pid", "Process ID", type: .int, required: true),
                flag("role", "--role", "AX role to match", required: true),
                flag("value", "--value", "Value to set", required: true),
                flag("title", "--title", "Filter by title"),
                flag("label", "--label", "Filter by label"),
                flag("identifier", "--identifier", "Filter by identifier"),
                flag("index", "--index", "Match by index", type: .int),
                flag("near", "--near", "Prefer element near x,y"),
                flag("match", "--match", "Regex match on value"),
                flag("depth", "--depth", "AX traversal depth", type: .int),
                flag("timeout", "--timeout", "Timeout in ms", type: .int)
            ],
            stdin: nil, constraints: nil,
            execution: permAction,
            output: outJSON,
            examples: ["aos do set-value --pid 1234 --role AXTextField --value \"hello\""]),
        InvocationForm(id: "do-focus", usage: "aos do focus --pid <pid> --role <role> [filters]",
            args: [
                flag("pid", "--pid", "Process ID", type: .int, required: true),
                flag("role", "--role", "AX role to match", required: true),
                flag("title", "--title", "Filter by title"),
                flag("label", "--label", "Filter by label"),
                flag("identifier", "--identifier", "Filter by identifier"),
                flag("index", "--index", "Match by index", type: .int),
                flag("near", "--near", "Prefer element near x,y"),
                flag("match", "--match", "Regex match on value"),
                flag("depth", "--depth", "AX traversal depth", type: .int),
                flag("timeout", "--timeout", "Timeout in ms", type: .int)
            ],
            stdin: nil, constraints: nil,
            execution: permAction,
            output: outJSON,
            examples: ["aos do focus --pid 1234 --role AXTextField"]),
        InvocationForm(id: "do-raise", usage: "aos do raise --pid <pid> [--window id]",
            args: [
                flag("pid", "--pid", "Process ID", type: .int, required: true),
                flag("window", "--window", "Window ID", type: .int)
            ],
            stdin: nil, constraints: nil,
            execution: permAction,
            output: outJSON,
            examples: ["aos do raise --pid 1234"]),
        InvocationForm(id: "do-move", usage: "aos do move --pid <pid> --to <x,y> [--window id]",
            args: [
                flag("pid", "--pid", "Process ID", type: .int, required: true),
                flag("to", "--to", "Target position as x,y", required: true),
                flag("window", "--window", "Window ID", type: .int)
            ],
            stdin: nil, constraints: nil,
            execution: permAction,
            output: outJSON,
            examples: ["aos do move --pid 1234 --to 100,100"]),
        InvocationForm(id: "do-resize", usage: "aos do resize --pid <pid> --to <w,h> [--window id]",
            args: [
                flag("pid", "--pid", "Process ID", type: .int, required: true),
                flag("to", "--to", "Target size as w,h", required: true),
                flag("window", "--window", "Window ID", type: .int)
            ],
            stdin: nil, constraints: nil,
            execution: permAction,
            output: outJSON,
            examples: ["aos do resize --pid 1234 --to 800,600"]),
        InvocationForm(id: "do-tell", usage: "aos do tell <app> <script>",
            args: [
                pos("app", "Application name"),
                pos("script", "AppleScript body", variadic: true)
            ],
            stdin: nil, constraints: nil,
            execution: permAction,
            output: outJSON,
            examples: ["aos do tell \"Finder\" \"open POSIX file \\\"/tmp\\\"\""]),
        InvocationForm(id: "do-session", usage: "aos do session [--profile name]",
            args: [
                flag("profile", "--profile", "Behavior profile name", default: .string("natural"))
            ],
            stdin: nil, constraints: nil,
            execution: execInteractive(daemon: true, permissions: true),
            output: outNDJSON,
            examples: ["aos do session", "aos do session --profile precise"]),
        InvocationForm(id: "do-profiles", usage: "aos do profiles [name]",
            args: [
                pos("name", "Profile name to show details", required: false)
            ],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSON,
            examples: ["aos do profiles", "aos do profiles natural"])
    ]))

    // ── say ───────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["say"], summary: "Voice — speak text aloud (sugar for tell human)", forms: [
        InvocationForm(id: "say-text", usage: "aos say [--voice id] [--rate wpm] <text>",
            args: [
                flag("voice", "--voice", "Voice identifier", discovery: [.command(path: ["say"], formId: "say-list-voices")]),
                flag("rate", "--rate", "Speech rate in WPM", type: .int),
                pos("text", "Text to speak", required: false, variadic: true)
            ],
            stdin: StdinDescriptor(supported: true, usedWhen: "no text args provided", contentType: "text"),
            constraints: nil,
            execution: execMutating(),
            output: outJSON,
            examples: ["aos say \"Hello, I'm your agent\"", "echo 'status' | aos say"]),
        InvocationForm(id: "say-list-voices", usage: "aos say --list-voices",
            args: [flag("list-voices", "--list-voices", "List available system voices", type: .bool, required: true)],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSON,
            examples: ["aos say --list-voices"])
    ]))

    // ── voice ─────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["voice"], summary: "Voice system — inspect the curated session voice bank and active leases", forms: [
        InvocationForm(id: "voice-list", usage: "aos voice list",
            args: [
                pos("list", "List the curated session voice bank", required: false)
            ],
            stdin: nil, constraints: nil,
            execution: execReadOnly(daemon: true),
            output: outJSON,
            examples: ["aos voice list"]),
        InvocationForm(id: "voice-leases", usage: "aos voice leases",
            args: [
                pos("leases", "List active session voice leases", required: false)
            ],
            stdin: nil, constraints: nil,
            execution: execReadOnly(daemon: true),
            output: outJSON,
            examples: ["aos voice leases"]),
        InvocationForm(id: "voice-bind", usage: "aos voice bind --session-id <id> --voice <voice-id>",
            args: [
                flag("session-id", "--session-id", "Canonical session id", required: true),
                flag("voice", "--voice", "Voice identifier from `aos voice list`", required: true)
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos voice bind --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c --voice com.apple.voice.enhanced.en-US.Evan"])
    ]))

    // ── tell ──────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["tell"], summary: "Communication — send to human, channel, or session", forms: [
        InvocationForm(id: "tell-message", usage: "aos tell <audience>|--session-id <id> [--json <payload>] [--from <name>] [--from-session-id <id>] [--purpose <name>] [<text> | stdin]",
            args: [
                pos("audience", "Target: human, channel name, or canonical session id", discovery: [
                    .staticValues(["human"]),
                    .command(path: ["listen"], formId: "listen-channels"),
                    .command(path: ["tell"], formId: "tell-who")
                ]),
                flag("session-id", "--session-id", "Directly target a canonical session id"),
                flag("json", "--json", "Structured JSON payload", type: .json),
                flag("from", "--from", "Sender name"),
                flag("from-session-id", "--from-session-id", "Canonical sending session id for human delivery or channel metadata"),
                flag("purpose", "--purpose", "Delivery purpose (for example: final_response)"),
                pos("text", "Message text", required: false, variadic: true)
            ],
            stdin: StdinDescriptor(supported: true, usedWhen: "no text and no --json", contentType: "text"),
            constraints: ConstraintSet(requires: nil, conflicts: nil, oneOf: [["text", "stdin", "json"]], implies: nil),
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: [
                "aos tell human \"Found the bug\"",
                "printf '%s' \"$FINAL\" | aos tell human --from-session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c --purpose final_response",
                "aos tell --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c \"status update\"",
                "aos tell handoff \"task complete\" --from my-session",
                "echo 'update' | aos tell handoff"
            ]),
        InvocationForm(id: "tell-register", usage: "aos tell --register [<legacy-name>] [--session-id <id>] [--name <name>] [--role <role>] [--harness <harness>]",
            args: [
                flag("register", "--register", "Register session presence", required: true),
                flag("session-id", "--session-id", "Canonical session id (preferred)"),
                flag("name", "--name", "Human-readable display name"),
                flag("role", "--role", "Session role",
                     type: .enumeration([
                        EnumValue(value: "worker", summary: "Default worker session"),
                        EnumValue(value: "coordinator", summary: "Orchestrating session"),
                        EnumValue(value: "observer", summary: "Read-only monitoring session")
                     ]), default: .string("worker")),
                flag("harness", "--harness", "Agent harness identifier", default: .string("unknown"))
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: [
                "aos tell --register --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c --name canvas-runtime",
                "aos tell --register builder --role worker --harness claude-code"
            ]),
        InvocationForm(id: "tell-unregister", usage: "aos tell --unregister [<legacy-name>] [--session-id <id>]",
            args: [
                flag("unregister", "--unregister", "Remove session presence", required: true),
                flag("session-id", "--session-id", "Canonical session id (preferred)")
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos tell --unregister --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c", "aos tell --unregister my-session"]),
        InvocationForm(id: "tell-who", usage: "aos tell --who",
            args: [flag("who", "--who", "List online sessions", type: .bool, required: true)],
            stdin: nil, constraints: nil,
            execution: execReadOnly(daemon: true),
            output: outJSON,
            examples: ["aos tell --who"])
    ]))

    // ── listen ────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["listen"], summary: "Communication — receive from channels", forms: [
        InvocationForm(id: "listen-read", usage: "aos listen <channel>|--session-id <id> [--since id] [--limit N]",
            args: [
                pos("channel", "Channel to read from", discovery: [.command(path: ["listen"], formId: "listen-channels")]),
                flag("session-id", "--session-id", "Read direct messages for a canonical session id"),
                flag("since", "--since", "Read messages after this ID"),
                flag("limit", "--limit", "Max messages to return", type: .int, default: .int(50))
            ],
            stdin: nil, constraints: nil,
            execution: execReadOnly(daemon: true),
            output: outJSON,
            examples: ["aos listen handoff", "aos listen --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c", "aos listen handoff --limit 10"]),
        InvocationForm(id: "listen-follow", usage: "aos listen <channel>|--session-id <id> --follow [--since id]",
            args: [
                pos("channel", "Channel to follow"),
                flag("session-id", "--session-id", "Follow direct messages for a canonical session id"),
                flag("follow", "--follow", "Stream messages in real-time", type: .bool, required: true),
                flag("since", "--since", "Start after this message ID")
            ],
            stdin: nil, constraints: nil,
            execution: execStreaming(daemon: true),
            output: outNDJSON,
            examples: ["aos listen handoff --follow", "aos listen --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c --follow"]),
        InvocationForm(id: "listen-channels", usage: "aos listen --channels",
            args: [flag("channels", "--channels", "List known channels", type: .bool, required: true)],
            stdin: nil, constraints: nil,
            execution: execReadOnly(daemon: true),
            output: outJSON,
            examples: ["aos listen --channels"])
    ]))

    // ── config / set ──────────────────────────────────────
    reg.append(CommandDescriptor(path: ["config"], summary: "Configuration — inspect and mutate runtime config", forms: [
        InvocationForm(id: "config-dump", usage: "aos config",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSON,
            examples: ["aos config"]),
        InvocationForm(id: "config-get", usage: "aos config get <key> [--json]",
            args: [
                pos("key", "Config key (for example: voice.enabled, content.port)"),
                flag("json", "--json", "Emit JSON for the value", type: .bool)
            ],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSONFlag,
            examples: ["aos config get voice.enabled", "aos config get content.port --json"]),
        InvocationForm(id: "config-set", usage: "aos config set <key> <value>",
            args: [
                pos("key", "Config key (for example: voice.enabled, perception.default_depth)"),
                pos("value", "New value")
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSON,
            examples: ["aos config set voice.enabled true", "aos config set perception.default_depth 2"])
    ]))

    reg.append(CommandDescriptor(path: ["set"], summary: "Configure autonomic settings", forms: [
        InvocationForm(id: "set-value", usage: "aos set <key> <value>",
            args: [
                pos("key", "Config key (e.g. voice.enabled, perception.default_depth)"),
                pos("value", "New value")
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSON,
            examples: ["aos set voice.enabled true", "aos set perception.default_depth 2"]),
        InvocationForm(id: "set-dump", usage: "aos set",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSON,
            examples: ["aos set"])
    ]))

    // ── focus ─────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["focus"], summary: "Focus channels — track window AX trees", forms: [
        InvocationForm(id: "focus-create", usage: "aos focus create --id <name> --window <wid> [options]",
            args: [
                flag("id", "--id", "Channel name", required: true),
                flag("window", "--window", "Window ID to track", type: .int, required: true),
                flag("pid", "--pid", "Process ID", type: .int),
                flag("depth", "--depth", "AX traversal depth", type: .int),
                flag("subtree-role", "--subtree-role", "Filter by AX role"),
                flag("subtree-title", "--subtree-title", "Filter by title"),
                flag("subtree-identifier", "--subtree-identifier", "Filter by identifier")
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos focus create --id work --window 1234 --depth 2"]),
        InvocationForm(id: "focus-update", usage: "aos focus update --id <name> [options]",
            args: [
                flag("id", "--id", "Channel name", required: true),
                flag("depth", "--depth", "New traversal depth", type: .int),
                flag("subtree-role", "--subtree-role", "New role filter"),
                flag("subtree-title", "--subtree-title", "New title filter"),
                flag("subtree-identifier", "--subtree-identifier", "New identifier filter")
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos focus update --id work --depth 3"]),
        InvocationForm(id: "focus-list", usage: "aos focus list",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(daemon: true),
            output: outJSON,
            examples: ["aos focus list"]),
        InvocationForm(id: "focus-remove", usage: "aos focus remove --id <name>",
            args: [flag("id", "--id", "Channel name", required: true)],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos focus remove --id work"])
    ]))

    // ── graph ─────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["graph"], summary: "Graph navigation — display/window/depth control", forms: [
        InvocationForm(id: "graph-displays", usage: "aos graph displays",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(daemon: true),
            output: outJSON,
            examples: ["aos graph displays"]),
        InvocationForm(id: "graph-windows", usage: "aos graph windows [--display N]",
            args: [flag("display", "--display", "Display index", type: .int)],
            stdin: nil, constraints: nil,
            execution: execReadOnly(daemon: true),
            output: outJSON,
            examples: ["aos graph windows"]),
        InvocationForm(id: "graph-deepen", usage: "aos graph deepen --id <id> [options]",
            args: [
                flag("id", "--id", "Node ID to expand", required: true),
                flag("depth", "--depth", "Depth increment", type: .int),
                flag("subtree-role", "--subtree-role", "Filter by role"),
                flag("subtree-title", "--subtree-title", "Filter by title"),
                flag("subtree-identifier", "--subtree-identifier", "Filter by identifier")
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos graph deepen --id node-1 --depth 2"]),
        InvocationForm(id: "graph-collapse", usage: "aos graph collapse --id <id> [--depth N]",
            args: [
                flag("id", "--id", "Node ID to collapse", required: true),
                flag("depth", "--depth", "Depth decrement", type: .int)
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos graph collapse --id node-1"])
    ]))

    // ── daemon-snapshot ───────────────────────────────────
    reg.append(CommandDescriptor(path: ["daemon-snapshot"], summary: "Daemon state snapshot", forms: [
        InvocationForm(id: "daemon-snapshot", usage: "aos daemon-snapshot",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(daemon: true),
            output: outJSON,
            examples: ["aos daemon-snapshot"])
    ]))

    // ── serve ─────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["serve"], summary: "Start the unified daemon", forms: [
        InvocationForm(id: "serve", usage: "aos serve [--idle-timeout duration]",
            args: [flag("idle-timeout", "--idle-timeout", "Idle timeout (e.g. 5m, none)", default: .string("5m"))],
            stdin: nil, constraints: nil,
            execution: ExecutionMeta(readOnly: false, mutatesState: true, interactive: false, streaming: true,
                                     autoStartsDaemon: false, requiresPermissions: false, supportsDryRun: false),
            output: outNone,
            examples: ["aos serve", "aos serve --idle-timeout none"])
    ]))

    // ── content ───────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["content"], summary: "Content server management", forms: [
        InvocationForm(id: "content-status", usage: "aos content status [--json]",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(daemon: true),
            output: outJSONFlag,
            examples: ["aos content status", "aos content status --json"]),
        InvocationForm(id: "content-wait", usage: "aos content wait [--root <name> ...] [--timeout <dur>] [--auto-start] [--json]",
            args: [
                flag("root", "--root", "Required content root (repeatable)"),
                flag("timeout", "--timeout", "Maximum wait duration", default: .string("10s")),
                flag("auto-start", "--auto-start", "Auto-start the daemon if needed", type: .bool),
                flag("json", "--json", "Emit JSON output", type: .bool)
            ],
            stdin: nil, constraints: nil,
            execution: execReadOnly(daemon: true),
            output: outJSONFlag,
            examples: [
                "aos content wait --root toolkit --auto-start",
                "aos content wait --root toolkit --root sigil --timeout 10s"
            ])
    ]))

    // ── service ───────────────────────────────────────────
    let serviceMode = flag("mode", "--mode", "Runtime mode",
        type: .enumeration([
            EnumValue(value: "repo", summary: "Development repo mode"),
            EnumValue(value: "installed", summary: "Installed AOS.app mode")
        ]))

    reg.append(CommandDescriptor(path: ["service"], summary: "Manage the daemon as a launchd service", forms: [
        InvocationForm(id: "service-install", usage: "aos service install [--mode repo|installed] [--json]",
            args: [serviceMode],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos service install", "aos service install --mode repo --json"]),
        InvocationForm(id: "service-start", usage: "aos service start [--mode repo|installed] [--json]",
            args: [serviceMode],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos service start"]),
        InvocationForm(id: "service-stop", usage: "aos service stop [--mode repo|installed] [--json]",
            args: [serviceMode],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos service stop"]),
        InvocationForm(id: "service-restart", usage: "aos service restart [--mode repo|installed] [--json]",
            args: [serviceMode],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos service restart"]),
        InvocationForm(id: "service-status", usage: "aos service status [--mode repo|installed] [--json]",
            args: [serviceMode],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSONFlag,
            examples: ["aos service status --json"]),
        InvocationForm(id: "service-logs", usage: "aos service logs [--mode repo|installed] [--tail N]",
            args: [
                serviceMode,
                flag("tail", "--tail", "Number of lines to show", type: .int)
            ],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outText,
            examples: ["aos service logs --tail 50"])
    ]))

    // ── runtime ───────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["runtime"], summary: "Package/sign/install the stable AOS.app runtime", forms: [
        InvocationForm(id: "runtime-install", usage: "aos runtime install [--json]",
            args: [],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos runtime install"]),
        InvocationForm(id: "runtime-status", usage: "aos runtime status [--json]",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSONFlag,
            examples: ["aos runtime status --json"]),
        InvocationForm(id: "runtime-path", usage: "aos runtime path [--json]",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSONFlag,
            examples: ["aos runtime path"]),
        InvocationForm(id: "runtime-sign", usage: "aos runtime sign",
            args: [],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outText,
            examples: ["aos runtime sign"]),
        InvocationForm(id: "runtime-display-union", usage: "aos runtime display-union",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outText,
            examples: ["aos runtime display-union"])
    ]))

    // ── doctor ────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["doctor"], summary: "Runtime and permission health checks", forms: [
        InvocationForm(id: "doctor", usage: "aos doctor [--json]",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSON,
            examples: ["aos doctor --json"])
    ]))

    // ── reset ─────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["reset"], summary: "Deterministic cleanup for repo/installed runtime state", forms: [
        InvocationForm(id: "reset", usage: "aos reset [--mode current|repo|installed|all] [--json]",
            args: [
                flag("mode", "--mode", "Cleanup scope",
                     type: .enumeration([
                        EnumValue(value: "current", summary: "Current runtime mode only"),
                        EnumValue(value: "repo", summary: "Repo mode state"),
                        EnumValue(value: "installed", summary: "Installed mode state"),
                        EnumValue(value: "all", summary: "All modes")
                     ]), default: .string("current"))
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos reset", "aos reset --mode all --json"])
    ]))

    // ── clean ─────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["clean"], summary: "Session-boundary cleanup (stale daemons, orphaned canvases)", forms: [
        InvocationForm(id: "clean", usage: "aos clean [--dry-run] [--json]",
            args: [flag("dry-run", "--dry-run", "Show what would be cleaned without doing it", type: .bool)],
            stdin: nil, constraints: nil,
            execution: execMutating(dryRun: true),
            output: outJSONFlag,
            examples: ["aos clean", "aos clean --dry-run --json"])
    ]))

    // ── permissions ───────────────────────────────────────
    reg.append(CommandDescriptor(path: ["permissions"], summary: "Permission preflight and one-time onboarding", forms: [
        InvocationForm(id: "permissions-check", usage: "aos permissions check [--json]",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSON,
            examples: ["aos permissions check --json"]),
        InvocationForm(id: "permissions-preflight", usage: "aos permissions preflight [--json]",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSON,
            examples: ["aos permissions preflight --json"]),
        InvocationForm(id: "permissions-setup", usage: "aos permissions setup [--once] [--json]",
            args: [flag("once", "--once", "Run only if not already completed", type: .bool)],
            stdin: nil, constraints: nil,
            execution: execInteractive(daemon: false),
            output: outJSONFlag,
            examples: ["aos permissions setup --once"])
    ]))

    // ── inspect ───────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["inspect"], summary: "Live AX element inspector overlay", forms: [
        InvocationForm(id: "inspect", usage: "aos inspect [--at x,y,w,h] [--size w,h]",
            args: [
                flag("at", "--at", "Inspector position as x,y,w,h"),
                flag("size", "--size", "Inspector size as w,h")
            ],
            stdin: nil, constraints: nil,
            execution: execInteractive(daemon: true, permissions: true),
            output: outNDJSON,
            examples: ["aos inspect", "aos inspect --at 0,0,400,300"])
    ]))

    // ── log ───────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["log"], summary: "Display log console panel", forms: [
        InvocationForm(id: "log-stream", usage: "echo lines | aos log [--at x,y,w,h] [--level level]",
            args: [
                flag("at", "--at", "Log panel position as x,y,w,h"),
                flag("level", "--level", "Log level filter",
                     type: .enumeration([
                        EnumValue(value: "debug", summary: "All messages"),
                        EnumValue(value: "info", summary: "Info and above"),
                        EnumValue(value: "warn", summary: "Warnings and errors"),
                        EnumValue(value: "error", summary: "Errors only")
                     ]))
            ],
            stdin: StdinDescriptor(supported: true, usedWhen: "streaming mode (default)", contentType: "text"),
            constraints: nil,
            execution: execStreaming(daemon: true),
            output: outNDJSON,
            examples: ["echo 'hello' | aos log", "tail -f /var/log/app.log | aos log"]),
        InvocationForm(id: "log-push", usage: "aos log push <message> [--level level]",
            args: [
                pos("message", "Log message", variadic: true),
                flag("level", "--level", "Log level",
                     type: .enumeration([
                        EnumValue(value: "debug", summary: "Debug level"),
                        EnumValue(value: "info", summary: "Info level (default)"),
                        EnumValue(value: "warn", summary: "Warning level"),
                        EnumValue(value: "error", summary: "Error level")
                     ]), default: .string("info"))
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos log push \"test message\"", "aos log push \"error occurred\" --level error"]),
        InvocationForm(id: "log-clear", usage: "aos log clear",
            args: [],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos log clear"])
    ]))

    // ── wiki ──────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["wiki"], summary: "Knowledge base — browse, search, invoke workflow plugins", forms: [
        InvocationForm(id: "wiki-create-plugin", usage: "aos wiki create-plugin <name> [--json]",
            args: [pos("name", "Plugin name")],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos wiki create-plugin my-flow"]),
        InvocationForm(id: "wiki-add", usage: "aos wiki add <type> <name> [--json]",
            args: [
                pos("type", "Page type",
                    type: .enumeration([
                        EnumValue(value: "entity", summary: "Entity page (thing in the system)"),
                        EnumValue(value: "concept", summary: "Concept page (idea or pattern)")
                    ])),
                pos("name", "Page name")
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos wiki add entity gateway"]),
        InvocationForm(id: "wiki-rm", usage: "aos wiki rm <path> [--json]",
            args: [pos("path", "Page path or name")],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos wiki rm gateway"]),
        InvocationForm(id: "wiki-list", usage: "aos wiki list [--type type] [--plugin name] [--links-to path] [--links-from path] [--orphans] [--json]",
            args: [
                flag("type", "--type", "Filter by page type"),
                flag("plugin", "--plugin", "Filter by plugin"),
                flag("links-to", "--links-to", "Pages linking to this path"),
                flag("links-from", "--links-from", "Pages linked from this path"),
                flag("orphans", "--orphans", "Show orphaned pages", type: .bool)
            ],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSONFlag,
            examples: ["aos wiki list", "aos wiki list --type workflow --json"]),
        InvocationForm(id: "wiki-search", usage: "aos wiki search <query> [--type type] [--json]",
            args: [
                pos("query", "Search query", variadic: true),
                flag("type", "--type", "Filter by page type")
            ],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSONFlag,
            examples: ["aos wiki search \"IPC protocol\""]),
        InvocationForm(id: "wiki-show", usage: "aos wiki show <name> [--raw] [--json]",
            args: [
                pos("name", "Page path or name"),
                flag("raw", "--raw", "Show raw markdown", type: .bool)
            ],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSONFlag,
            examples: ["aos wiki show gateway --json"]),
        InvocationForm(id: "wiki-graph", usage: "aos wiki graph [--raw] [--json]",
            args: [
                flag("raw", "--raw", "Include raw markdown content for each page", type: .bool)
            ],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSONFlag,
            examples: ["aos wiki graph --json", "aos wiki graph --raw --json"]),
        InvocationForm(id: "wiki-link", usage: "aos wiki link <from> <to> [--json]",
            args: [
                pos("from", "Source page path"),
                pos("to", "Target page path")
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos wiki link gateway daemon"]),
        InvocationForm(id: "wiki-invoke", usage: "aos wiki invoke <plugin> [--json]",
            args: [pos("plugin", "Plugin name to invoke")],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSONFlag,
            examples: ["aos wiki invoke self-check"]),
        InvocationForm(id: "wiki-reindex", usage: "aos wiki reindex [--json]",
            args: [],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos wiki reindex"]),
        InvocationForm(id: "wiki-lint", usage: "aos wiki lint [--json]",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSONFlag,
            examples: ["aos wiki lint", "aos wiki lint --json"]),
        InvocationForm(id: "wiki-lint-fix", usage: "aos wiki lint --fix [--json]",
            args: [flag("fix", "--fix", "Auto-fix issues (reindexes)", type: .bool, required: true)],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos wiki lint --fix --json"]),
        InvocationForm(id: "wiki-seed", usage: "aos wiki seed [--force] [--namespace ns] [--file name:path ...] [--json]",
            args: [
                flag("force", "--force", "Overwrite existing pages", type: .bool),
                flag("namespace", "--namespace", "Target namespace"),
                flag("file", "--file", "File mappings (name:path)", variadic: true),
                flag("from", "--from", "Source directory path")
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos wiki seed", "aos wiki seed --force --namespace sigil"]),
        InvocationForm(id: "wiki-migrate-namespaces", usage: "aos wiki migrate-namespaces",
            args: [],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos wiki migrate-namespaces"])
    ]))

    // ── help ──────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["help"], summary: "Show help for commands", forms: [
        InvocationForm(id: "help-full", usage: "aos help [--json]",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSONFlag,
            examples: ["aos help", "aos help --json"]),
        InvocationForm(id: "help-command", usage: "aos help <command-path...> [--json]",
            args: [pos("command-path", "Command path to look up (e.g. show create)", variadic: true)],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSONFlag,
            examples: ["aos help show", "aos help show create --json", "aos help do click --json"])
    ]))

    return reg
}
