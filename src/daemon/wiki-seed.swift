import Foundation

enum WikiSeed {
    /// For each (relativePath, contentURL) in files, write contentURL's bytes
    /// to wikiRoot/<namespace>/<relativePath> iff the target doesn't exist.
    /// Never overwrites. Returns count of files actually written.
    @discardableResult
    static func seedIfAbsent(wikiRoot: URL, namespace: String, files: [(String, URL)]) throws -> Int {
        let fm = FileManager.default
        var written = 0
        for (rel, source) in files {
            let dst = wikiRoot.appendingPathComponent(namespace).appendingPathComponent(rel)
            if fm.fileExists(atPath: dst.path) { continue }
            try fm.createDirectory(at: dst.deletingLastPathComponent(),
                                   withIntermediateDirectories: true)
            try fm.copyItem(at: source, to: dst)
            written += 1
        }
        return written
    }
}
