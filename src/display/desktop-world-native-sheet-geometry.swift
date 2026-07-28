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
    static let maximumColumns = 128
    static let maximumRows = 128
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

struct DesktopWorldNativeSheetVertex {
    var clipPosition: SIMD4<Float>
    var worldAndUV: SIMD4<Float>
}

final class DesktopWorldNativeSheetMesh {
    let descriptor: DesktopWorldNativeSheetGeometryDescriptor
    let indexCount: Int
    let metrics: DesktopWorldNativeSheetGeometryMetrics
    let worldBounds: CGRect
    private(set) var indexBuffer: MTLBuffer?
    private(set) var vertexBuffer: MTLBuffer?

    init(
        descriptor: DesktopWorldNativeSheetGeometryDescriptor,
        device: MTLDevice,
        worldBounds: CGRect
    ) throws {
        guard worldBounds.width > 0,
              worldBounds.height > 0,
              worldBounds.width.isFinite,
              worldBounds.height.isFinite,
              worldBounds.minX.isFinite,
              worldBounds.minY.isFinite else {
            throw DesktopWorldNativeSheetFailure.invalidGeometry
        }
        self.descriptor = descriptor
        self.worldBounds = worldBounds
        metrics = try descriptor.metrics(segmentCount: 1)

        var vertices: [DesktopWorldNativeSheetVertex] = []
        vertices.reserveCapacity(metrics.vertexCount)
        for row in 0...descriptor.rows {
            let vertical = Float(row) / Float(descriptor.rows)
            let clipY = 1 - (2 * vertical)
            let worldY = Float(worldBounds.minY) + vertical * Float(worldBounds.height)
            for column in 0...descriptor.columns {
                let horizontal = Float(column) / Float(descriptor.columns)
                let clipX = (2 * horizontal) - 1
                let worldX = Float(worldBounds.minX) + horizontal * Float(worldBounds.width)
                vertices.append(DesktopWorldNativeSheetVertex(
                    clipPosition: SIMD4<Float>(clipX, clipY, 0, 1),
                    worldAndUV: SIMD4<Float>(worldX, worldY, horizontal, vertical)
                ))
            }
        }

        var indices: [UInt32] = []
        indices.reserveCapacity(metrics.indexCount)
        let stride = descriptor.columns + 1
        for row in 0..<descriptor.rows {
            for column in 0..<descriptor.columns {
                let topLeft = UInt32((row * stride) + column)
                let topRight = topLeft + 1
                let bottomLeft = UInt32(((row + 1) * stride) + column)
                let bottomRight = bottomLeft + 1
                indices.append(contentsOf: [
                    topLeft, bottomLeft, topRight,
                    topRight, bottomLeft, bottomRight,
                ])
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
    case geometryAllocationFailed
    case geometryBudgetExceeded
    case invalidGeometry
    case projectionOccupied
}
