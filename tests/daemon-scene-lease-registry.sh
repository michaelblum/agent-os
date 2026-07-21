#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat >"$TMP/main.swift" <<'SWIFT'
import Foundation

func assert(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("FAIL: \(message)\n", stderr)
        exit(1)
    }
}

let first = UUID(uuidString: "00000000-0000-0000-0000-000000000001")!
let second = UUID(uuidString: "00000000-0000-0000-0000-000000000002")!
let registry = AOSSceneLeaseRegistry()
let key = "example.consumer::companion/main"

func acquired(
    _ result: AOSSceneLeaseAcquireResult,
    _ expectedNew: Bool,
    _ message: String
) -> AOSSceneLeaseToken {
    guard case .acquired(let token, let isNew) = result, isNew == expectedNew else {
        fputs("FAIL: \(message)\n", stderr)
        exit(1)
    }
    return token
}

let firstOperation = acquired(
    registry.acquire(key: key, connectionID: first, ref: "request-1"),
    true,
    "first owner must acquire a new lease"
)
assert(registry.beginOperation(firstOperation), "accepted operation must pin its exact lease generation")
assert(registry.acquire(key: key, connectionID: first, ref: "request-2") == .busy, "same-owner reacquire must wait for terminal settlement")
assert(registry.acquire(key: key, connectionID: second, ref: nil) == .busy, "another connection must fail closed")
assert(registry.completeOperation(firstOperation, releaseLease: false) == AOSSceneLeaseRoute(connectionID: first, ref: "request-1"), "terminal result must retain its admission-time ref")

let secondOperation = acquired(
    registry.acquire(key: key, connectionID: first, ref: "request-2"),
    false,
    "same owner must receive a new lease generation"
)
assert(secondOperation.generation > firstOperation.generation, "same-owner reacquire must advance the generation")
assert(registry.beginOperation(secondOperation), "second operation must pin its own generation")
assert(registry.completeOperation(firstOperation, releaseLease: true) == nil, "stale completion must not settle or release a newer operation")
assert(registry.operationToken(key: key) == secondOperation, "stale completion must preserve the newer operation token")
assert(registry.completeOperation(secondOperation, releaseLease: false) == AOSSceneLeaseRoute(connectionID: first, ref: "request-2"), "new completion must route to its own ref")

let subscription = acquired(
    registry.acquire(key: key, connectionID: first, ref: "subscription"),
    false,
    "same owner must acquire a subscription generation"
)
let subscribed = registry.updateSubscriptions(token: subscription, adding: ["gesture"])
assert(subscribed == ["gesture"], "owner must add a gesture subscription")
assert(registry.routeEvent(key: key, event: "gesture") == AOSSceneLeaseRoute(connectionID: first, ref: "subscription"), "subscribed gesture must route")
assert(registry.routeEvent(key: key, event: "error") == nil, "unsubscribed events must not route")
let forged = AOSSceneLeaseToken(key: key, generation: subscription.generation, route: AOSSceneLeaseRoute(connectionID: second, ref: nil))
assert(registry.updateSubscriptions(token: forged, adding: ["gesture"]) == nil, "non-owner token must not mutate subscriptions")

assert(registry.updateSubscriptions(token: subscription, removing: ["gesture"]) == [], "unsubscribe must remove the exact event")
assert(registry.routeEvent(key: key, event: "gesture") == nil, "unsubscribed gesture must stop routing")
assert(registry.updateSubscriptions(token: subscription, adding: ["gesture"]) == ["gesture"], "disconnect proof needs an active event subscription")

let closing = registry.beginDisconnect(connectionID: first)
assert(closing == [subscription], "disconnect must close admission around the exact current generation")
assert(registry.routeEvent(key: key, event: "gesture") == nil, "disconnecting leases must stop event delivery immediately")
assert(registry.acquire(key: key, connectionID: first, ref: "late") == .busy, "disconnecting owner must not reacquire before cleanup")
assert(registry.acquire(key: key, connectionID: second, ref: nil) == .busy, "replacement owner must wait for cleanup acknowledgement")
assert(registry.beginOperation(subscription, allowingClosing: true), "disconnect cleanup must pin the closed generation")
assert(registry.completeOperation(subscription, releaseLease: true) == AOSSceneLeaseRoute(connectionID: first, ref: "subscription"), "cleanup completion must release the exact disconnected generation")

let replacement = acquired(
    registry.acquire(key: key, connectionID: second, ref: nil),
    true,
    "replacement may acquire only after cleanup settles"
)
assert(registry.release(subscription) == false, "former owner token must not release replacement generation")
assert(registry.release(replacement), "current generation token must release its lease")

print("PASS daemon scene lease registry")
SWIFT

swiftc "$ROOT/src/daemon/scene-lease-registry.swift" "$TMP/main.swift" -o "$TMP/test-scene-lease-registry"
"$TMP/test-scene-lease-registry"
