import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 3,
      let pid = Int32(CommandLine.arguments[1]),
      let keyCode = UInt16(CommandLine.arguments[2]),
      let source = CGEventSource(stateID: .hidSystemState) else {
    fputs("usage: post-key-to-pid <pid> <key-code>\n", stderr)
    exit(2)
}

setbuf(stdout, nil)

while let command = readLine(strippingNewline: true) {
    if command == "quit" { break }
    guard command == "post" else {
        fputs("unsupported command\n", stderr)
        exit(2)
    }
    guard let down = CGEvent(
        keyboardEventSource: source,
        virtualKey: CGKeyCode(keyCode),
        keyDown: true
    ), let up = CGEvent(
        keyboardEventSource: source,
        virtualKey: CGKeyCode(keyCode),
        keyDown: false
    ) else {
        fputs("failed to create targeted key event\n", stderr)
        exit(1)
    }
    down.postToPid(pid_t(pid))
    usleep(10_000)
    up.postToPid(pid_t(pid))
    print("ok")
}
