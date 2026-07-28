import Foundation

@main
struct DesktopWorldNativeSheetGeometryTests {
    static func main() throws {
        let standard = try DesktopWorldNativeSheetGeometryDescriptor.standard.metrics(
            segmentCount: 2
        )
        precondition(standard.segmentCount == 2)
        precondition(standard.vertexCount == 8_450)
        precondition(standard.triangleCount == 16_384)
        precondition(standard.indexCount == 49_152)
        precondition(standard.geometryBytes == 467_008)

        let maximum = try DesktopWorldNativeSheetGeometryDescriptor(
            columns: DesktopWorldNativeSheetGeometryDescriptor.maximumColumns,
            rows: DesktopWorldNativeSheetGeometryDescriptor.maximumRows
        ).metrics(segmentCount: DesktopWorldNativeSheetGeometryDescriptor.maximumSegments)
        precondition(maximum.vertexCount == DesktopWorldNativeSheetGeometryDescriptor.maximumVertices)
        precondition(maximum.triangleCount == DesktopWorldNativeSheetGeometryDescriptor.maximumTriangles)
        precondition(maximum.geometryBytes <= DesktopWorldNativeSheetGeometryDescriptor.maximumGeometryBytes)

        expectFailure(.invalidGeometry) {
            _ = try DesktopWorldNativeSheetGeometryDescriptor(columns: 0, rows: 64).metrics(segmentCount: 1)
        }
        expectFailure(.invalidGeometry) {
            _ = try DesktopWorldNativeSheetGeometryDescriptor(columns: 64, rows: 64).metrics(segmentCount: 0)
        }
        expectFailure(.invalidGeometry) {
            _ = try DesktopWorldNativeSheetGeometryDescriptor(columns: 129, rows: 64).metrics(segmentCount: 1)
        }
        expectFailure(.invalidGeometry) {
            _ = try DesktopWorldNativeSheetGeometryDescriptor(columns: 64, rows: 64).metrics(segmentCount: 9)
        }

        print("PASS DesktopWorld native sheet geometry budgets")
    }

    private static func expectFailure(
        _ expected: DesktopWorldNativeSheetFailure,
        operation: () throws -> Void
    ) {
        do {
            try operation()
            preconditionFailure("expected \(expected)")
        } catch let observed as DesktopWorldNativeSheetFailure {
            precondition(String(describing: observed) == String(describing: expected))
        } catch {
            preconditionFailure("unexpected error: \(error)")
        }
    }
}
