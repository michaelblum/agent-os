import CoreGraphics
import Foundation

@main
struct DesktopWorldDisplayGeometryTests {
    static func main() {
        precondition(
            AOSDesktopPixelDimensions(
                pointWidth: 1_512,
                pointHeight: 982,
                pointPixelScale: 2
            ) == AOSDesktopPixelDimensions(
                pointWidth: 3_024,
                pointHeight: 1_964,
                pointPixelScale: 1
            ),
            "Retina points did not resolve to exact native pixels"
        )
        precondition(
            AOSDesktopPixelDimensions(
                pointWidth: 1_001,
                pointHeight: 701,
                pointPixelScale: 1.5
            ) == AOSDesktopPixelDimensions(
                pointWidth: 1_502,
                pointHeight: 1_052,
                pointPixelScale: 1
            ),
            "fractional display scale did not resolve deterministically"
        )
        precondition(
            AOSDesktopPixelDimensions(
                pointWidth: 1_920,
                pointHeight: 1_080,
                pointPixelScale: .nan
            ) == nil,
            "invalid point-to-pixel scale produced dimensions"
        )

        guard let retina = AOSDesktopWorldDisplayGeometry(
            displayID: 42,
            index: 0,
            desktopWorldBounds: CGRect(x: 0, y: 0, width: 1_512, height: 982),
            nativePointBounds: CGRect(x: 0, y: 0, width: 1_512, height: 982),
            pointPixelScale: 2
        ), let external = AOSDesktopWorldDisplayGeometry(
            displayID: 43,
            index: 1,
            desktopWorldBounds: CGRect(x: 1_512, y: 100, width: 1_920, height: 1_080),
            nativePointBounds: CGRect(x: 1_512, y: -100, width: 1_920, height: 1_080),
            pointPixelScale: 1
        ), let layout = AOSDesktopWorldDisplayLayout(displays: [external, retina]) else {
            preconditionFailure("canonical display fixture was rejected")
        }

        precondition(layout.displayIDs == [42, 43])
        precondition(layout.matches(displayIDs: [43, 42]))
        precondition(layout.matches(indexedDisplays: [
            (displayID: 43, index: 1),
            (displayID: 42, index: 0),
        ]))
        precondition(retina.acceptsCaptureSource(
            pointWidth: 1_512,
            pointHeight: 982,
            pointPixelScale: 2
        ))
        precondition(!retina.acceptsCaptureSource(
            pointWidth: 1_512,
            pointHeight: 982,
            pointPixelScale: 1
        ))
        precondition(retina.backingPixelPoint(
            fromDesktopWorld: CGPoint(x: 756, y: 491)
        ) == CGPoint(x: 1_512, y: 982))
        precondition(retina.desktopWorldPoint(
            fromBackingPixel: CGPoint(x: 1_512, y: 982)
        ) == CGPoint(x: 756, y: 491))
        precondition(retina.backingPixelCount(
            intersectingDesktopWorld: CGRect(x: 100, y: 100, width: 80, height: 60)
        ) == 19_200)
        precondition(layout.totalBackingPixelCount == 8_012_736)
        precondition(layout.desktopWorldBounds == CGRect(
            x: 0, y: 0, width: 3_432, height: 1_180
        ))

        print("PASS DesktopWorld display geometry mapping")
    }
}
