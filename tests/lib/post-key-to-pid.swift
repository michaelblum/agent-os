import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 3,
      let pid = Int32(CommandLine.arguments[1]),
      let keyCode = UInt16(CommandLine.arguments[2]) else {
    fputs("usage: post-key-to-pid <pid> <key-code>\n", stderr)
    exit(2)
}

for keyDown in [true, false] {
    guard let event = CGEvent(
        keyboardEventSource: nil,
        virtualKey: CGKeyCode(keyCode),
        keyDown: keyDown
    ) else {
        fputs("failed to create targeted key event\n", stderr)
        exit(1)
    }
    event.postToPid(pid_t(pid))
    usleep(10_000)
}
