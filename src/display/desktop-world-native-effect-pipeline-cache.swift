import Foundation

enum AOSDesktopWorldNativeEffectPipelineCacheFailure: Error {
    case limitExceeded
}

struct AOSDesktopWorldNativeEffectPipelineCache<Pipeline> {
    private var pipelines: [String: Pipeline] = [:]
    private let maximumCount: Int

    init(maximumCount: Int = 32) {
        self.maximumCount = max(1, maximumCount)
    }

    mutating func reconcile(
        programs: [AOSDesktopWorldNativeEffectProgram],
        compile: (AOSDesktopWorldNativeEffectProgram) throws -> Pipeline
    ) throws {
        let programsByDigest = Dictionary(
            programs.map { ($0.digest, $0) },
            uniquingKeysWith: { first, _ in first }
        )
        guard programsByDigest.count <= maximumCount else {
            throw AOSDesktopWorldNativeEffectPipelineCacheFailure.limitExceeded
        }

        var candidate: [String: Pipeline] = [:]
        candidate.reserveCapacity(programsByDigest.count)
        for digest in programsByDigest.keys.sorted() {
            guard let program = programsByDigest[digest] else { continue }
            candidate[digest] = try pipelines[digest] ?? compile(program)
        }
        pipelines = candidate
    }

    func pipeline(for digest: String) -> Pipeline? {
        pipelines[digest]
    }

    mutating func removeAll() {
        pipelines.removeAll(keepingCapacity: false)
    }

    var count: Int { pipelines.count }
}
