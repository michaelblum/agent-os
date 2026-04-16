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
func flag(_ id: String, _ token: String, _ summary: String, type: ValueType = .string, required: Bool = false, default defaultVal: JSONValue? = nil) -> ArgDescriptor {
    ArgDescriptor(id: id, kind: .flag, token: token, summary: summary, valueType: type,
                  required: required, defaultValue: defaultVal, variadic: false, discovery: nil)
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
                flag("grid", "--grid", "Grid overlay (e.g. 4x3)"),
                flag("xray", "--xray", "AX element traversal overlay", type: .bool),
                flag("label", "--label", "Badge annotations (implies --xray)", type: .bool),
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
            constraints: ConstraintSet(requires: nil, conflicts: [["base64", "out"]], oneOf: nil, implies: ["label": ["xray"]]),
            execution: execReadOnly(permissions: true),
            output: outFile,
            examples: [
                "aos see capture main --out /tmp/screen.png",
                "aos see main --base64 --format jpg",
                "aos see capture user_active --window --xray",
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
        InvocationForm(id: "show-eval", usage: "aos show eval --id <name> --script <javascript>",
            args: [
                flag("id", "--id", "Canvas identifier", required: true),
                flag("script", "--script", "JavaScript to execute", required: true)
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos show eval --id avatar --script \"document.title\""]),
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
        InvocationForm(id: "show-exists", usage: "aos show exists --id <name>",
            args: [flag("id", "--id", "Canvas identifier", required: true)],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSON,
            examples: ["aos show exists --id avatar --json"]),
        InvocationForm(id: "show-get", usage: "aos show get --id <name>",
            args: [flag("id", "--id", "Canvas identifier", required: true)],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSON,
            examples: ["aos show get --id avatar --json"])
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

    // ── continued in Task 4 ──
    return reg
}
