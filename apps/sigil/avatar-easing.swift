// avatar-easing.swift -- Easing functions for avatar animations.
//
// Extracted from avatar-follower.swift plus additional curves.
// Each function maps t in [0,1] to an eased value.

import Foundation

typealias EasingFn = (Double) -> Double

func linear(_ t: Double) -> Double { t }

// Cubic ease in-out: smooth start and end
func easeInOutCubic(_ t: Double) -> Double {
    t < 0.5 ? 4*t*t*t : 1 - pow(-2*t+2, 3)/2
}

// Overshoot at the end (pull-back feel)
func easeOutBack(_ t: Double) -> Double {
    let c1 = 1.70158, c3 = c1 + 1
    return 1 + c3 * pow(t - 1, 3) + c1 * pow(t - 1, 2)
}

// Overshoot at the start
func easeInBack(_ t: Double) -> Double {
    let c1 = 1.70158, c3 = c1 + 1
    return c3 * t * t * t - c1 * t * t
}

// Fast deceleration (quartic ease-out)
func easeOutQuart(_ t: Double) -> Double {
    1 - pow(1 - t, 4)
}

// Spring-like bounce at the end
func easeOutElastic(_ t: Double) -> Double {
    if t == 0 || t == 1 { return t }
    return pow(2, -10 * t) * sin((t * 10 - 0.75) * (2 * Double.pi) / 3) + 1
}
