import Foundation

private func gatewayReporterPath(mode: AOSRuntimeMode) -> String {
    switch mode {
    case .repo:
        let base = aosCurrentRepoRoot() ?? FileManager.default.currentDirectoryPath
        return NSString(string: (base as NSString).appendingPathComponent("packages/gateway/dist/doctor-cli.js")).standardizingPath
    case .installed:
        return "\(aosInstallAppPath())/Contents/Resources/gateway/dist/doctor-cli.js"
    }
}

func doctorGatewayCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        print("""
        Usage: aos doctor gateway [--quick] [--json|--pretty] [--tail N]

        Health report for aos-gateway (MCP server + integration broker).
        JSON output by default when stdout is non-TTY; pretty text on TTY.
        Exit codes: 0=healthy, 1=warnings, 2=hard errors.
        """)
        exit(0)
    }

    let mode = aosCurrentRuntimeMode()
    let reporter = gatewayReporterPath(mode: mode)

    guard FileManager.default.fileExists(atPath: reporter) else {
        exitError("aos-gateway doctor reporter not found at \(reporter). In repo mode, run `npm run -w packages/gateway build` first.", code: "REPORTER_MISSING")
    }

    var forwarded: [String] = ["--mode", mode.rawValue]
    let stateRoot = aosStateRoot()
    forwarded.append(contentsOf: ["--state-root", stateRoot])
    forwarded.append(contentsOf: args)

    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    task.arguments = ["node", reporter] + forwarded
    task.standardInput = FileHandle.nullDevice
    task.standardOutput = FileHandle.standardOutput
    task.standardError = FileHandle.standardError

    do {
        try task.run()
    } catch {
        exitError("failed to spawn gateway doctor reporter: \(error.localizedDescription)", code: "SPAWN_FAILED")
    }
    task.waitUntilExit()
    exit(task.terminationStatus)
}
