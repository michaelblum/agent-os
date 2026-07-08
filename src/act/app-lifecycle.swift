// app-lifecycle.swift — AppKit process lifecycle controls for `aos do`.

import AppKit
import Foundation

/// `aos do activate|quit|hide|unhide` — app lifecycle controls by process id.
func cliAppLifecycle(action: String, args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")

    guard let pid = parseInt(getArg(args, "--pid")) else {
        exitError("\(action) requires --pid", code: "MISSING_ARG")
    }

    guard let app = NSRunningApplication(processIdentifier: pid_t(pid)) else {
        exitError("No running application found for pid \(pid)", code: "APP_NOT_FOUND")
    }
    var target = LegacyTargetInfo(pid: pid)
    target.app = app.localizedName

    if dryRun {
        cliPrintLegacy(action: action, backend: "appkit", target: target, dryRun: true)
        return
    }

    let ok: Bool
    switch action {
    case "activate":
        ok = app.activate(options: [.activateAllWindows])
    case "quit":
        ok = app.terminate()
    case "hide":
        ok = app.hide()
    case "unhide":
        ok = app.unhide()
    default:
        exitError("Unknown app lifecycle action: \(action)", code: "UNKNOWN_SUBCOMMAND")
    }

    guard ok else {
        exitError("App lifecycle action \(action) failed for pid \(pid)", code: "APP_ACTION_FAILED")
    }

    cliPrintLegacy(action: action, backend: "appkit", target: target, dryRun: false)
}
