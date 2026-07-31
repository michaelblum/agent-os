import CoreGraphics
import Foundation
import Metal

enum AOSDesktopWorldNativeEffectEmitterTrajectory {
    static func progress(
        _ value: Double,
        easing: AOSDesktopWorldNativeEffectHeightFieldState.Emitter.TrajectoryEasing
    ) -> Double {
        let linear = min(1, max(0, value))
        switch easing {
        case .easeOutQuart:
            return 1 - pow(1 - linear, 4)
        case .linear:
            return linear
        }
    }
}

@MainActor
struct AOSDesktopWorldNativeEffectHeightFieldLease {
    let generation: Int
    let slotIndex: Int
    let texture: MTLTexture
}

@MainActor
final class AOSDesktopWorldNativeEffectHeightField {
    private struct TextureSlot {
        let texture: MTLTexture
        var inFlightCount = 0
    }

    private static let bufferedTextureCount = 3
    private static let maximumBrushSamples = 2_048
    private static let maximumCellCount = 65_536
    private static let maximumCellVisitsPerAdvance = 524_288

    private let bounds: CGRect
    private let damping: Float
    private let descriptor: AOSDesktopWorldNativeEffectHeightFieldState
    private let duration: TimeInterval
    private var heights: [Float]
    private var laplacian: [Float]
    private var nextHeights: [Float]
    private let pressure: Float
    private let propagation: Float
    private let radius: CGFloat
    private let lead: CGFloat
    private let surfaceTension: Float
    private var textureSlots: [TextureSlot]
    private var velocities: [Float]
    private let width: Int
    private let height: Int
    private let displayIDs: Set<UInt32>
    private var currentGeneration = 0
    private var currentTextureIndex: Int?
    private var disposed = false
    private var inputs: AOSDesktopWorldNativeEffectInputs
    private var lastInjectedPoint: CGPoint
    private var lastSteppedTick = -1
    private var pendingDisplayIDs: Set<UInt32> = []
    private var workloadRejected = false

    init(
        device: MTLDevice,
        instance: AOSDesktopWorldNativeEffectProgramInstance,
        inputs: AOSDesktopWorldNativeEffectInputs,
        bounds: CGRect,
        displayIDs: Set<UInt32>
    ) throws {
        guard let descriptor = instance.program.heightFieldState,
              !bounds.isNull,
              !bounds.isInfinite,
              bounds.width > 0,
              bounds.height > 0,
              let damping = instance.parameterValue(descriptor.dampingParameter),
              let duration = instance.parameterValue(
                descriptor.emitter.durationParameter
              ),
              let lead = instance.parameterValue(descriptor.emitter.leadParameter),
              let pressure = instance.parameterValue(
                descriptor.emitter.pressureParameter
              ),
              let propagation = instance.parameterValue(
                descriptor.propagationParameter
              ),
              let radius = instance.parameterValue(descriptor.emitter.radiusParameter),
              let surfaceTension = instance.parameterValue(
                descriptor.surfaceTensionParameter
              ),
              duration > 0,
              !displayIDs.isEmpty,
              radius > 0 else {
            throw DesktopWorldNativeSheetFailure.invalidGeometry
        }
        let dimensions = Self.dimensions(
            bounds: bounds,
            minimum: descriptor.minimumDimension,
            maximum: descriptor.maximumDimension
        )
        let cellCount = dimensions.width * dimensions.height
        guard cellCount > 0, cellCount <= Self.maximumCellCount else {
            throw DesktopWorldNativeSheetFailure.geometryBudgetExceeded
        }
        let textureDescriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .r32Float,
            width: dimensions.width,
            height: dimensions.height,
            mipmapped: false
        )
        textureDescriptor.storageMode = .shared
        textureDescriptor.usage = [.shaderRead]
        var textureSlots: [TextureSlot] = []
        for _ in 0..<Self.bufferedTextureCount {
            guard let texture = device.makeTexture(descriptor: textureDescriptor) else {
                throw DesktopWorldNativeSheetFailure.textureUnavailable
            }
            textureSlots.append(.init(texture: texture))
        }

        self.bounds = bounds
        self.damping = Float(damping)
        self.descriptor = descriptor
        self.duration = duration
        self.displayIDs = displayIDs
        self.height = dimensions.height
        heights = Array(repeating: 0, count: cellCount)
        laplacian = Array(repeating: 0, count: cellCount)
        nextHeights = Array(repeating: 0, count: cellCount)
        self.pressure = Float(pressure)
        self.propagation = Float(propagation)
        self.radius = radius
        self.lead = lead
        self.surfaceTension = Float(surfaceTension)
        self.textureSlots = textureSlots
        velocities = Array(repeating: 0, count: cellCount)
        self.width = dimensions.width
        self.inputs = inputs
        lastInjectedPoint = inputs.origin
        guard estimatedCellVisits(
            totalSweepDistance: hypot(inputs.totalDelta.x, inputs.totalDelta.y),
            stepCount: descriptor.maximumSubsteps
        )
            <= Self.maximumCellVisitsPerAdvance else {
            throw DesktopWorldNativeSheetFailure.geometryBudgetExceeded
        }
    }

    deinit {
        textureSlots.removeAll(keepingCapacity: false)
        heights.removeAll(keepingCapacity: false)
        nextHeights.removeAll(keepingCapacity: false)
        velocities.removeAll(keepingCapacity: false)
        laplacian.removeAll(keepingCapacity: false)
    }

    func dispose() {
        guard !disposed else { return }
        disposed = true
        textureSlots.removeAll(keepingCapacity: false)
        currentTextureIndex = nil
        pendingDisplayIDs.removeAll(keepingCapacity: false)
        heights.removeAll(keepingCapacity: false)
        nextHeights.removeAll(keepingCapacity: false)
        velocities.removeAll(keepingCapacity: false)
        laplacian.removeAll(keepingCapacity: false)
    }

    @discardableResult
    func update(inputs: AOSDesktopWorldNativeEffectInputs) -> Bool {
        guard !disposed, !workloadRejected else { return false }
        self.inputs = inputs
        return true
    }

    func acquireTexture(
        displayID: UInt32,
        elapsed: TimeInterval
    ) -> AOSDesktopWorldNativeEffectHeightFieldLease? {
        guard !disposed,
              !workloadRejected,
              displayIDs.contains(displayID),
              !textureSlots.isEmpty else {
            return nil
        }
        let targetTick = max(0, Int(floor(elapsed * Double(descriptor.fixedStepHz))))
        if currentTextureIndex == nil
            || (pendingDisplayIDs.isEmpty && targetTick > lastSteppedTick) {
            prepareSnapshot(targetTick: targetTick)
        }
        guard !workloadRejected,
              let slotIndex = currentTextureIndex else {
            return nil
        }
        pendingDisplayIDs.remove(displayID)
        textureSlots[slotIndex].inFlightCount += 1
        return .init(
            generation: currentGeneration,
            slotIndex: slotIndex,
            texture: textureSlots[slotIndex].texture
        )
    }

    func complete(_ lease: AOSDesktopWorldNativeEffectHeightFieldLease) {
        guard !disposed,
              textureSlots.indices.contains(lease.slotIndex),
              textureSlots[lease.slotIndex].inFlightCount > 0 else {
            return
        }
        textureSlots[lease.slotIndex].inFlightCount -= 1
    }

    var retainedTextureCount: Int { textureSlots.count }

    var stateCellCount: Int { heights.count }

    private func prepareSnapshot(targetTick: Int) {
        guard let slotIndex = textureSlots.indices.first(where: {
            textureSlots[$0].inFlightCount == 0
        }) else {
            return
        }
        if targetTick > lastSteppedTick {
            let firstTick = firstPendingTick(targetTick: targetTick)
            guard estimatedCellVisits(
                firstTick: firstTick,
                targetTick: targetTick,
                inputs: inputs
            )
                <= Self.maximumCellVisitsPerAdvance else {
                workloadRejected = true
                return
            }
            if firstTick > lastSteppedTick + 1 {
                lastSteppedTick = firstTick - 1
            }
            for tick in firstTick...targetTick {
                inject(forTick: tick)
                step()
                lastSteppedTick = tick
            }
        }
        upload(to: slotIndex)
        currentTextureIndex = slotIndex
        currentGeneration += 1
        pendingDisplayIDs = displayIDs
    }

    private func inject(forTick tick: Int) {
        let target = targetPoint(forTick: tick, inputs: inputs)
        injectSweep(from: lastInjectedPoint, to: target)
        lastInjectedPoint = target
    }

    private func injectSweep(from: CGPoint, to: CGPoint) {
        let dx = to.x - from.x
        let dy = to.y - from.y
        let distance = hypot(dx, dy)
        guard distance >= 0.000_1 else { return }
        let direction = CGVector(dx: dx / distance, dy: dy / distance)
        let spacing = max(0.025, radius * descriptor.emitter.spacingRadiusScale)
        let steps = min(
            Self.maximumBrushSamples,
            max(1, Int(ceil(distance / spacing)))
        )
        let elapsed = max(1.0 / 240.0, 1.0 / Double(descriptor.fixedStepHz))
        let speed = distance / elapsed
        let speedScale = min(
            descriptor.emitter.speedScaleMaximum,
            max(
                descriptor.emitter.speedScaleMinimum,
                speed / descriptor.emitter.speedReference
            )
        )
        let impulse = pressure * 0.014 * Float(speedScale)
        for step in 1...steps {
            let progress = CGFloat(step) / CGFloat(steps)
            let point = CGPoint(
                x: from.x + dx * progress,
                y: from.y + dy * progress
            )
            for lobe in descriptor.emitter.lobes {
                let offset = radius * lobe.offsetRadiusScale * lead
                injectBrush(
                    center: CGPoint(
                        x: point.x + direction.dx * offset,
                        y: point.y + direction.dy * offset
                    ),
                    amount: impulse * Float(lobe.strengthScale),
                    radius: radius * lobe.radiusScale
                )
            }
        }
    }

    private func injectBrush(center: CGPoint, amount: Float, radius: CGFloat) {
        let gridX = (center.x - bounds.minX) / bounds.width * CGFloat(width - 1)
        let gridY = (center.y - bounds.minY) / bounds.height * CGFloat(height - 1)
        let radiusX = max(1.25, radius / bounds.width * CGFloat(width))
        let radiusY = max(1.25, radius / bounds.height * CGFloat(height))
        let rangeX = Int(ceil(radiusX * 2.25))
        let rangeY = Int(ceil(radiusY * 2.25))
        let minimumX = max(1, Int(floor(gridX)) - rangeX)
        let maximumX = min(width - 2, Int(ceil(gridX)) + rangeX)
        let minimumY = max(1, Int(floor(gridY)) - rangeY)
        let maximumY = min(height - 2, Int(ceil(gridY)) + rangeY)
        guard minimumX <= maximumX, minimumY <= maximumY else { return }
        for y in minimumY...maximumY {
            let normalizedY = (CGFloat(y) - gridY) / radiusY
            for x in minimumX...maximumX {
                let normalizedX = (CGFloat(x) - gridX) / radiusX
                let distanceSquared = normalizedX * normalizedX
                    + normalizedY * normalizedY
                guard distanceSquared <= 5 else { continue }
                let weight = Float(exp(-Double(distanceSquared) * 1.65))
                let index = y * width + x
                velocities[index] += amount * weight
                heights[index] += amount * weight * 0.18
            }
        }
    }

    private func step() {
        for index in laplacian.indices { laplacian[index] = 0 }
        for y in 1..<(height - 1) {
            let row = y * width
            for x in 1..<(width - 1) {
                let index = row + x
                laplacian[index] = heights[index - 1]
                    + heights[index + 1]
                    + heights[index - width]
                    + heights[index + width]
                    - 4 * heights[index]
            }
        }
        for index in nextHeights.indices { nextHeights[index] = 0 }
        let stepDuration = 1 / Float(descriptor.fixedStepHz)
        let dampingFactor = exp(-max(0.01, damping) * stepDuration)
        let propagation = min(0.36, max(0.01, self.propagation))
        let tension = min(0.04, max(0, surfaceTension))
        for y in 1..<(height - 1) {
            let row = y * width
            for x in 1..<(width - 1) {
                let index = row + x
                let biLaplacian = laplacian[index - 1]
                    + laplacian[index + 1]
                    + laplacian[index - width]
                    + laplacian[index + width]
                    - 4 * laplacian[index]
                let acceleration = propagation * laplacian[index]
                    - tension * biLaplacian
                let edgeDistance = min(
                    min(x, y),
                    min(width - 1 - x, height - 1 - y)
                )
                let absorption = edgeDistance < descriptor.edgeAbsorptionCells
                    ? 0.93 + 0.07 * Float(edgeDistance)
                        / Float(max(1, descriptor.edgeAbsorptionCells))
                    : 1
                let velocity = (velocities[index] + acceleration)
                    * dampingFactor * absorption
                velocities[index] = velocity.isFinite ? velocity : 0
                let nextHeight = heights[index] + velocities[index]
                nextHeights[index] = nextHeight.isFinite ? nextHeight : 0
            }
        }
        swap(&heights, &nextHeights)
    }

    private func upload(to slotIndex: Int) {
        guard !disposed, textureSlots.indices.contains(slotIndex) else { return }
        heights.withUnsafeBytes { bytes in
            guard let address = bytes.baseAddress else { return }
            textureSlots[slotIndex].texture.replace(
                region: MTLRegionMake2D(0, 0, width, height),
                mipmapLevel: 0,
                withBytes: address,
                bytesPerRow: width * MemoryLayout<Float>.stride
            )
        }
    }

    private func estimatedCellVisits(
        firstTick: Int,
        targetTick: Int,
        inputs: AOSDesktopWorldNativeEffectInputs
    ) -> Int {
        var point = lastInjectedPoint
        var total = 0.0
        for tick in firstTick...targetTick {
            let target = targetPoint(forTick: tick, inputs: inputs)
            total += estimatedCellVisits(
                sweepDistance: hypot(target.x - point.x, target.y - point.y)
            )
            point = target
            if !total.isFinite || total > Double(Self.maximumCellVisitsPerAdvance) {
                return Int.max
            }
        }
        return Int(ceil(total))
    }

    private func estimatedCellVisits(
        totalSweepDistance: CGFloat,
        stepCount: Int
    ) -> Int {
        guard totalSweepDistance.isFinite,
              totalSweepDistance >= 0,
              stepCount > 0 else {
            return Int.max
        }
        let spacing = max(0.025, radius * descriptor.emitter.spacingRadiusScale)
        let sampleCount = totalSweepDistance < 0.000_1
            ? 0
            : min(
                Self.maximumBrushSamples * stepCount,
                max(1, Int(ceil(totalSweepDistance / spacing))) + stepCount - 1
            )
        let total = simulationCellVisitsPerStep * Double(stepCount)
            + brushCellVisitsPerSample * Double(sampleCount)
        guard total.isFinite, total <= Double(Int.max) else { return Int.max }
        return Int(ceil(total))
    }

    private func estimatedCellVisits(sweepDistance: CGFloat) -> Double {
        guard sweepDistance.isFinite, sweepDistance >= 0 else {
            return .infinity
        }
        let spacing = max(0.025, radius * descriptor.emitter.spacingRadiusScale)
        let sampleCount = sweepDistance < 0.000_1
            ? 0
            : min(
                Self.maximumBrushSamples,
                max(1, Int(ceil(sweepDistance / spacing)))
            )
        return simulationCellVisitsPerStep
            + brushCellVisitsPerSample * Double(sampleCount)
    }

    private var brushCellVisitsPerSample: Double {
        var visits = 0.0
        for lobe in descriptor.emitter.lobes {
            let lobeRadius = radius * lobe.radiusScale
            let radiusX = max(1.25, lobeRadius / bounds.width * CGFloat(width))
            let radiusY = max(1.25, lobeRadius / bounds.height * CGFloat(height))
            let rangeX = min(width - 2, Int(ceil(radiusX * 2.25)) * 2 + 2)
            let rangeY = min(height - 2, Int(ceil(radiusY * 2.25)) * 2 + 2)
            visits += Double(max(0, rangeX) * max(0, rangeY))
        }
        return visits
    }

    private var simulationCellVisitsPerStep: Double {
        Double(width * height * 4)
    }

    private func firstPendingTick(targetTick: Int) -> Int {
        max(
            lastSteppedTick + 1,
            targetTick - descriptor.maximumSubsteps + 1
        )
    }

    private func targetPoint(
        forTick tick: Int,
        inputs: AOSDesktopWorldNativeEffectInputs
    ) -> CGPoint {
        let elapsed = Double(tick + 1) / Double(descriptor.fixedStepHz)
        let progress = AOSDesktopWorldNativeEffectEmitterTrajectory.progress(
            elapsed / duration,
            easing: descriptor.emitter.trajectoryEasing
        )
        return CGPoint(
            x: inputs.origin.x + inputs.totalDelta.x * progress,
            y: inputs.origin.y + inputs.totalDelta.y * progress
        )
    }

    private static func dimensions(
        bounds: CGRect,
        minimum: Int,
        maximum: Int
    ) -> (width: Int, height: Int) {
        let aspect = bounds.width / bounds.height
        if aspect >= 1 {
            return (
                width: maximum,
                height: min(maximum, max(minimum, Int(round(CGFloat(maximum) / aspect))))
            )
        }
        return (
            width: min(maximum, max(minimum, Int(round(CGFloat(maximum) * aspect)))),
            height: maximum
        )
    }
}

private extension AOSDesktopWorldNativeEffectProgramInstance {
    func parameterValue(_ id: String) -> Double? {
        guard let index = program.parameters.firstIndex(where: { $0.id == id }),
              parameterValues.indices.contains(index) else {
            return nil
        }
        return parameterValues[index]
    }
}
