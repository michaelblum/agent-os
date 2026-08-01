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

        let aggregateMaximum = try DesktopWorldNativeSheetGeometryDescriptor(
            columns: 128,
            rows: 128
        ).metrics(segmentCount: DesktopWorldNativeSheetGeometryDescriptor.maximumSegments)
        precondition(aggregateMaximum.vertexCount == DesktopWorldNativeSheetGeometryDescriptor.maximumVertices)
        precondition(aggregateMaximum.triangleCount == DesktopWorldNativeSheetGeometryDescriptor.maximumTriangles)
        precondition(aggregateMaximum.geometryBytes <= DesktopWorldNativeSheetGeometryDescriptor.maximumGeometryBytes)

        let left = CGRect(x: 0, y: 0, width: 1_440, height: 900)
        let right = CGRect(x: 1_440, y: 0, width: 2_560, height: 1_440)
        let route = DesktopWorldNativeSheetGeometryRequest.adaptive(
            cellSize: 8,
            regions: [CGRect(x: 1_200, y: 300, width: 1_000, height: 300)]
        )
        let leftPlan = try route.plan(segmentBounds: left)
        let rightPlan = try route.plan(segmentBounds: right)
        precondition(leftPlan?.patches.map(\.bounds) == [
            CGRect(x: 1_200, y: 300, width: 240, height: 300),
        ])
        precondition(leftPlan?.renderBounds == CGRect(
            x: 1_200, y: 300, width: 240, height: 300
        ))
        let leftProjectionFrame = try leftPlan?.localProjectionFrame(
            containerBounds: CGRect(x: 0, y: 0, width: 1_440, height: 900)
        )
        precondition(leftProjectionFrame == CGRect(
            x: 1_200, y: 300, width: 240, height: 300
        ))
        precondition(rightPlan?.patches.map(\.bounds) == [
            CGRect(x: 1_440, y: 300, width: 760, height: 300),
        ])
        precondition(rightPlan?.renderBounds == CGRect(
            x: 1_440, y: 300, width: 760, height: 300
        ))
        let rightProjectionFrame = try rightPlan?.localProjectionFrame(
            containerBounds: CGRect(x: 0, y: 0, width: 2_560, height: 1_440)
        )
        precondition(rightProjectionFrame == CGRect(
            x: 0, y: 840, width: 760, height: 300
        ))
        let routeMetrics = try DesktopWorldNativeSheetGeometryRequest.aggregate(
            [leftPlan!.metrics, rightPlan!.metrics],
            segmentCount: 2
        )
        precondition(routeMetrics.segmentCount == 2)
        precondition(routeMetrics.triangleCount < standard.triangleCount * 4)

        let inactive = try DesktopWorldNativeSheetGeometryRequest.adaptive(
            cellSize: 8,
            regions: [CGRect(x: 5_000, y: 0, width: 100, height: 100)]
        ).plan(segmentBounds: left)
        precondition(inactive == nil)

        let scaledFrame = try leftPlan!.localProjectionFrame(
            containerBounds: CGRect(x: 0, y: 0, width: 720, height: 450)
        )
        precondition(scaledFrame == CGRect(x: 600, y: 150, width: 120, height: 150))

        expectFailure(.invalidGeometry) {
            _ = try DesktopWorldNativeSheetGeometryDescriptor(columns: 0, rows: 64).metrics(segmentCount: 1)
        }
        expectFailure(.invalidGeometry) {
            _ = try DesktopWorldNativeSheetGeometryDescriptor(columns: 64, rows: 64).metrics(segmentCount: 0)
        }
        expectFailure(.invalidGeometry) {
            _ = try DesktopWorldNativeSheetGeometryDescriptor(columns: 513, rows: 64).metrics(segmentCount: 1)
        }
        expectFailure(.invalidGeometry) {
            _ = try DesktopWorldNativeSheetGeometryDescriptor(columns: 64, rows: 64).metrics(segmentCount: 9)
        }
        expectFailure(.geometryBudgetExceeded) {
            _ = try DesktopWorldNativeSheetGeometryDescriptor(columns: 512, rows: 512).metrics(segmentCount: 1)
        }
        expectFailure(.geometryBudgetExceeded) {
            let fullLeft = try DesktopWorldNativeSheetGeometryRequest.adaptive(
                cellSize: 4,
                regions: nil
            ).plan(segmentBounds: left)!
            _ = try DesktopWorldNativeSheetGeometryRequest.aggregate(
                [fullLeft.metrics, fullLeft.metrics],
                segmentCount: 2
            )
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
