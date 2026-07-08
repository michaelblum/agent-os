// window-frame-store.swift — Saved frame persistence for exact window lifecycle controls.

import CoreGraphics
import Foundation

struct SavedWindowFrame: Codable {
    let pid: Int
    let window_id: Int
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

private func windowLifecycleFramePath(pid: Int, windowID: Int) -> String {
    let dir = (aosStateDir() as NSString).appendingPathComponent("window-frames")
    try? FileManager.default.createDirectory(
        atPath: dir,
        withIntermediateDirectories: true,
        attributes: nil
    )
    return (dir as NSString).appendingPathComponent("\(pid)-\(windowID).json")
}

func saveWindowFrame(pid: Int, windowID: Int, frame: CGRect) {
    let saved = SavedWindowFrame(
        pid: pid,
        window_id: windowID,
        x: Double(frame.origin.x),
        y: Double(frame.origin.y),
        width: Double(frame.size.width),
        height: Double(frame.size.height)
    )
    guard let data = try? JSONEncoder().encode(saved) else { return }
    try? data.write(to: URL(fileURLWithPath: windowLifecycleFramePath(pid: pid, windowID: windowID)), options: [.atomic])
}

func loadWindowFrame(pid: Int, windowID: Int) -> SavedWindowFrame? {
    let path = windowLifecycleFramePath(pid: pid, windowID: windowID)
    guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)) else { return nil }
    return try? JSONDecoder().decode(SavedWindowFrame.self, from: data)
}
