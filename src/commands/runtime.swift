// runtime.swift — packaged runtime install/sign/status helpers.

import Foundation

func runtimeCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["runtime"], json: args.contains("--json"))
        exit(0)
    }
    guard let sub = args.first else {
        exitError("runtime requires a subcommand. Usage: aos runtime <status|path|sign|install|display-union [--native]> ...",
                  code: "MISSING_SUBCOMMAND")
    }

    switch sub {
    case "display-union":
        runtimeDisplayUnionCommand(args: Array(args.dropFirst()))
    default:
        exitError("Unknown runtime subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}

/// Print the union bounding box of all connected displays as `x,y,w,h`
/// (comma-separated integers). Default output is the canonical DesktopWorld
/// shape — top-left of the arranged full-display union at (0,0). Pass
/// `--native` to print the legacy native desktop compatibility shape used
/// by AppKit/CG boundary callers (matches the `display_geometry` channel's
/// `global_bounds` field).
private func runtimeDisplayUnionCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        print("Usage: aos runtime display-union [--native]")
        print("")
        print("Print the bounding box of all connected displays as x,y,w,h")
        print("(integers, comma-separated). Default output is DesktopWorld")
        print("(top-left of the arranged full-display union = 0,0).")
        print("")
        print("Flags:")
        print("  --native   Print native desktop compatibility coordinates")
        print("             (top-left of the macOS main display = 0,0).")
        return
    }
    var asNative = false
    for arg in args {
        switch arg {
        case "--native":
            asNative = true
        default:
            exitError("Unknown flag: \(arg). Usage: aos runtime display-union [--native]",
                      code: "UNKNOWN_FLAG")
        }
    }
    print(runtimeDisplayUnion(native: asNative))
}

/// Compute the current display union as `x,y,w,h` comma-separated integers.
/// Reuses `snapshotDisplayGeometry()` so the output matches the
/// `display_geometry` channel payload. When `native` is true, returns the
/// native-compat `global_bounds` shape; otherwise returns the canonical
/// DesktopWorld shape (`desktop_world_bounds`, which is `0,0,w,h` by
/// construction). Returns `"0,0,0,0"` when no displays are attached.
func runtimeDisplayUnion(native: Bool = false) -> String {
    let snapshot = snapshotDisplayGeometry()
    let key = native ? "global_bounds" : "desktop_world_bounds"
    guard let rect = snapshot[key] as? [String: Double] else {
        return "0,0,0,0"
    }
    let x = Int(rect["x"] ?? 0)
    let y = Int(rect["y"] ?? 0)
    let w = Int(rect["w"] ?? 0)
    let h = Int(rect["h"] ?? 0)
    return "\(x),\(y),\(w),\(h)"
}
