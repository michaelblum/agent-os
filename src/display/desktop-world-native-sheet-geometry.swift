import CoreGraphics
import Foundation
import Metal

struct DesktopWorldNativeSheetGeometryMetrics: Equatable {
    let geometryBytes: Int
    let indexCount: Int
    let segmentCount: Int
    let triangleCount: Int
    let vertexCount: Int
}

struct DesktopWorldNativeSheetGeometryDescriptor: Equatable {
    static let standard = DesktopWorldNativeSheetGeometryDescriptor(columns: 64, rows: 64)
    static let maximumColumns = 512
    static let maximumRows = 512
    static let maximumSegments = 8
    static let maximumGeometryBytes = 16 * 1024 * 1024
    static let maximumTriangles = 262_144
    static let maximumVertices = 133_128

    let columns: Int
    let rows: Int

    init(columns: Int, rows: Int) {
        self.columns = columns
        self.rows = rows
    }

    func metrics(segmentCount: Int) throws -> DesktopWorldNativeSheetGeometryMetrics {
        guard columns > 0,
              rows > 0,
              columns <= Self.maximumColumns,
              rows <= Self.maximumRows,
              segmentCount > 0,
              segmentCount <= Self.maximumSegments else {
            throw DesktopWorldNativeSheetFailure.invalidGeometry
        }
        let verticesPerSegment = try Self.multiply(columns + 1, rows + 1)
        let trianglesPerSegment = try Self.multiply(try Self.multiply(columns, rows), 2)
        let vertexCount = try Self.multiply(verticesPerSegment, segmentCount)
        let triangleCount = try Self.multiply(trianglesPerSegment, segmentCount)
        let indexCount = try Self.multiply(triangleCount, 3)
        let vertexBytes = try Self.multiply(
            vertexCount,
            MemoryLayout<DesktopWorldNativeSheetVertex>.stride
        )
        let indexBytes = try Self.multiply(indexCount, MemoryLayout<UInt32>.stride)
        let geometryBytes = try Self.add(vertexBytes, indexBytes)
        guard vertexCount <= Self.maximumVertices,
              triangleCount <= Self.maximumTriangles,
              geometryBytes <= Self.maximumGeometryBytes else {
            throw DesktopWorldNativeSheetFailure.geometryBudgetExceeded
        }
        return DesktopWorldNativeSheetGeometryMetrics(
            geometryBytes: geometryBytes,
            indexCount: indexCount,
            segmentCount: segmentCount,
            triangleCount: triangleCount,
            vertexCount: vertexCount
        )
    }

    private static func add(_ left: Int, _ right: Int) throws -> Int {
        let (value, overflow) = left.addingReportingOverflow(right)
        guard !overflow else { throw DesktopWorldNativeSheetFailure.geometryBudgetExceeded }
        return value
    }

    private static func multiply(_ left: Int, _ right: Int) throws -> Int {
        let (value, overflow) = left.multipliedReportingOverflow(by: right)
        guard !overflow else { throw DesktopWorldNativeSheetFailure.geometryBudgetExceeded }
        return value
    }
}

struct DesktopWorldNativeSheetGeometryPatch: Equatable {
    let bounds: CGRect
    let descriptor: DesktopWorldNativeSheetGeometryDescriptor
}

struct DesktopWorldNativeSheetGeometryPlan: Equatable {
    let metrics: DesktopWorldNativeSheetGeometryMetrics
    let patches: [DesktopWorldNativeSheetGeometryPatch]
    let renderBounds: CGRect
    let segmentBounds: CGRect

    func localProjectionFrame(containerBounds: CGRect) throws -> CGRect {
        guard DesktopWorldNativeSheetGeometryRequest.valid(containerBounds),
              DesktopWorldNativeSheetGeometryRequest.valid(renderBounds),
              DesktopWorldNativeSheetGeometryRequest.valid(segmentBounds),
              segmentBounds.contains(renderBounds) else {
            throw DesktopWorldNativeSheetFailure.invalidGeometry
        }
        let scaleX = containerBounds.width / segmentBounds.width
        let scaleY = containerBounds.height / segmentBounds.height
        let width = renderBounds.width * scaleX
        let height = renderBounds.height * scaleY
        return CGRect(
            x: containerBounds.minX
                + (renderBounds.minX - segmentBounds.minX) * scaleX,
            y: containerBounds.minY
                + (segmentBounds.maxY - renderBounds.maxY) * scaleY,
            width: width,
            height: height
        )
    }
}

enum DesktopWorldNativeSheetGeometryRequest: Equatable {
    static let maximumPatchesPerSegment = 8
    static let maximumCellSize: CGFloat = 64
    static let minimumCellSize: CGFloat = 2

    case adaptive(cellSize: CGFloat, regions: [CGRect]?)
    case fixed(DesktopWorldNativeSheetGeometryDescriptor)

    static let standard = Self.fixed(.standard)

    func plan(segmentBounds: CGRect) throws -> DesktopWorldNativeSheetGeometryPlan? {
        guard Self.valid(segmentBounds) else {
            throw DesktopWorldNativeSheetFailure.invalidGeometry
        }
        switch self {
        case .fixed(let descriptor):
            return DesktopWorldNativeSheetGeometryPlan(
                metrics: try descriptor.metrics(segmentCount: 1),
                patches: [.init(bounds: segmentBounds, descriptor: descriptor)],
                renderBounds: segmentBounds,
                segmentBounds: segmentBounds
            )
        case .adaptive(let cellSize, let requestedRegions):
            guard cellSize.isFinite,
                  cellSize >= Self.minimumCellSize,
                  cellSize <= Self.maximumCellSize else {
                throw DesktopWorldNativeSheetFailure.invalidGeometry
            }
            let regions = try Self.mergedRegions(
                requestedRegions ?? [segmentBounds]
            ).compactMap { region -> CGRect? in
                let intersection = region.intersection(segmentBounds)
                return intersection.isNull || intersection.isEmpty ? nil : intersection
            }
            guard !regions.isEmpty else { return nil }
            guard regions.count <= Self.maximumPatchesPerSegment else {
                throw DesktopWorldNativeSheetFailure.geometryBudgetExceeded
            }
            var patches: [DesktopWorldNativeSheetGeometryPatch] = []
            var metrics: [DesktopWorldNativeSheetGeometryMetrics] = []
            for bounds in regions {
                let descriptor = DesktopWorldNativeSheetGeometryDescriptor(
                    columns: max(1, Int(ceil(bounds.width / cellSize))),
                    rows: max(1, Int(ceil(bounds.height / cellSize)))
                )
                patches.append(.init(bounds: bounds, descriptor: descriptor))
                metrics.append(try descriptor.metrics(segmentCount: 1))
            }
            return DesktopWorldNativeSheetGeometryPlan(
                metrics: try Self.aggregate(metrics, segmentCount: 1),
                patches: patches,
                renderBounds: patches.reduce(CGRect.null) { $0.union($1.bounds) },
                segmentBounds: segmentBounds
            )
        }
    }

    static func aggregate(
        _ metrics: [DesktopWorldNativeSheetGeometryMetrics],
        segmentCount: Int
    ) throws -> DesktopWorldNativeSheetGeometryMetrics {
        guard segmentCount > 0,
              segmentCount <= DesktopWorldNativeSheetGeometryDescriptor.maximumSegments else {
            throw DesktopWorldNativeSheetFailure.invalidGeometry
        }
        let result = DesktopWorldNativeSheetGeometryMetrics(
            geometryBytes: metrics.reduce(0) { $0 + $1.geometryBytes },
            indexCount: metrics.reduce(0) { $0 + $1.indexCount },
            segmentCount: segmentCount,
            triangleCount: metrics.reduce(0) { $0 + $1.triangleCount },
            vertexCount: metrics.reduce(0) { $0 + $1.vertexCount }
        )
        guard result.vertexCount <= DesktopWorldNativeSheetGeometryDescriptor.maximumVertices,
              result.triangleCount <= DesktopWorldNativeSheetGeometryDescriptor.maximumTriangles,
              result.geometryBytes <= DesktopWorldNativeSheetGeometryDescriptor.maximumGeometryBytes else {
            throw DesktopWorldNativeSheetFailure.geometryBudgetExceeded
        }
        return result
    }

    private static func mergedRegions(_ regions: [CGRect]) throws -> [CGRect] {
        guard !regions.isEmpty,
              regions.count <= maximumPatchesPerSegment,
              regions.allSatisfy(valid) else {
            throw DesktopWorldNativeSheetFailure.invalidGeometry
        }
        var merged: [CGRect] = []
        for region in regions.sorted(by: regionOrder) {
            if let index = merged.firstIndex(where: { $0.intersects(region) }) {
                merged[index] = merged[index].union(region)
            } else {
                merged.append(region)
            }
        }
        return merged.sorted(by: regionOrder)
    }

    private static func regionOrder(_ left: CGRect, _ right: CGRect) -> Bool {
        if left.minY != right.minY { return left.minY < right.minY }
        if left.minX != right.minX { return left.minX < right.minX }
        if left.height != right.height { return left.height < right.height }
        return left.width < right.width
    }

    static func valid(_ bounds: CGRect) -> Bool {
        !bounds.isNull
            && !bounds.isInfinite
            && !bounds.isEmpty
            && bounds.minX.isFinite
            && bounds.minY.isFinite
            && bounds.width.isFinite
            && bounds.height.isFinite
    }
}

struct DesktopWorldNativeSheetVertex {
    var clipPosition: SIMD4<Float>
    var worldAndUV: SIMD4<Float>
}

final class DesktopWorldNativeSheetMesh {
    let indexCount: Int
    let metrics: DesktopWorldNativeSheetGeometryMetrics
    let patchBounds: [CGRect]
    let renderBounds: CGRect
    let segmentBounds: CGRect
    private(set) var indexBuffer: MTLBuffer?
    private(set) var vertexBuffer: MTLBuffer?

    convenience init(
        descriptor: DesktopWorldNativeSheetGeometryDescriptor,
        device: MTLDevice,
        worldBounds: CGRect
    ) throws {
        let plan = try DesktopWorldNativeSheetGeometryRequest.fixed(descriptor)
            .plan(segmentBounds: worldBounds)
        guard let plan else { throw DesktopWorldNativeSheetFailure.invalidGeometry }
        try self.init(plan: plan, device: device)
    }

    init(
        plan: DesktopWorldNativeSheetGeometryPlan,
        device: MTLDevice
    ) throws {
        segmentBounds = plan.segmentBounds
        patchBounds = plan.patches.map(\.bounds)
        renderBounds = plan.renderBounds
        metrics = plan.metrics

        var vertices: [DesktopWorldNativeSheetVertex] = []
        vertices.reserveCapacity(metrics.vertexCount)
        var indices: [UInt32] = []
        indices.reserveCapacity(metrics.indexCount)
        for patch in plan.patches {
            let baseVertex = UInt32(vertices.count)
            let descriptor = patch.descriptor
            for row in 0...descriptor.rows {
                let vertical = Float(row) / Float(descriptor.rows)
                let worldY = Float(patch.bounds.minY) + vertical * Float(patch.bounds.height)
                for column in 0...descriptor.columns {
                    let horizontal = Float(column) / Float(descriptor.columns)
                    let worldX = Float(patch.bounds.minX) + horizontal * Float(patch.bounds.width)
                    let segmentU = Float(
                        (CGFloat(worldX) - plan.segmentBounds.minX) / plan.segmentBounds.width
                    )
                    let segmentV = Float(
                        (CGFloat(worldY) - plan.segmentBounds.minY) / plan.segmentBounds.height
                    )
                    let renderU = Float(
                        (CGFloat(worldX) - plan.renderBounds.minX) / plan.renderBounds.width
                    )
                    let renderV = Float(
                        (CGFloat(worldY) - plan.renderBounds.minY) / plan.renderBounds.height
                    )
                    let clipX = (2 * renderU) - 1
                    let clipY = 1 - (2 * renderV)
                    vertices.append(DesktopWorldNativeSheetVertex(
                        clipPosition: SIMD4<Float>(clipX, clipY, 0, 1),
                        worldAndUV: SIMD4<Float>(worldX, worldY, segmentU, segmentV)
                    ))
                }
            }
            let stride = descriptor.columns + 1
            for row in 0..<descriptor.rows {
                for column in 0..<descriptor.columns {
                    let topLeft = baseVertex + UInt32((row * stride) + column)
                    let topRight = topLeft + 1
                    let bottomLeft = baseVertex + UInt32(((row + 1) * stride) + column)
                    let bottomRight = bottomLeft + 1
                    indices.append(contentsOf: [
                        topLeft, bottomLeft, topRight,
                        topRight, bottomLeft, bottomRight,
                    ])
                }
            }
        }
        let vertexBuffer = vertices.withUnsafeBufferPointer { buffer in
            device.makeBuffer(
                bytes: buffer.baseAddress!,
                length: buffer.count * MemoryLayout<DesktopWorldNativeSheetVertex>.stride,
                options: .storageModeShared
            )
        }
        let indexBuffer = indices.withUnsafeBufferPointer { buffer in
            device.makeBuffer(
                bytes: buffer.baseAddress!,
                length: buffer.count * MemoryLayout<UInt32>.stride,
                options: .storageModeShared
            )
        }
        guard indices.count == metrics.indexCount,
              let vertexBuffer,
              let indexBuffer else {
            throw DesktopWorldNativeSheetFailure.geometryAllocationFailed
        }
        vertexBuffer.label = "AOS DesktopWorld native sheet vertices"
        indexBuffer.label = "AOS DesktopWorld native sheet indices"
        self.vertexBuffer = vertexBuffer
        self.indexBuffer = indexBuffer
        indexCount = indices.count
    }

    func dispose() {
        vertexBuffer = nil
        indexBuffer = nil
    }

    var retainedBufferCount: Int {
        (vertexBuffer == nil ? 0 : 1) + (indexBuffer == nil ? 0 : 1)
    }
}

enum DesktopWorldNativeSheetFailure: Error {
    case frameSetIncomplete
    case geometryAllocationFailed
    case geometryBudgetExceeded
    case invalidGeometry
    case rendererUnavailable
    case textureUnavailable
}
