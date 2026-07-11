import CoreGraphics
import Foundation

private let aosInputReceiptPrefix: UInt64 = 0x41A0
private let aosInputReceiptPrefixMask: UInt64 = 0xFFFF_0000_0000_0000

func aosInputReceiptMarker(processID: Int32, counter: UInt32) -> Int64 {
    let value = (aosInputReceiptPrefix << 48)
        | (UInt64(UInt16(truncatingIfNeeded: processID)) << 32)
        | UInt64(counter)
    return Int64(bitPattern: value)
}

func aosInputReceiptID(marker: Int64) -> String? {
    let value = UInt64(bitPattern: marker)
    guard value & aosInputReceiptPrefixMask == aosInputReceiptPrefix << 48 else {
        return nil
    }
    return String(format: "aos-input-%016llx", value)
}

func aosInputReceiptID(event: CGEvent) -> String? {
    aosInputReceiptID(marker: event.getIntegerValueField(.eventSourceUserData))
}
