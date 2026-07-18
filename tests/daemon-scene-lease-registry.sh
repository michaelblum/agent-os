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

assert(registry.acquire(key: key, connectionID: first, ref: "request-1") == .acquired(isNew: true), "first owner must acquire a new lease")
assert(registry.acquire(key: key, connectionID: first, ref: "request-2") == .acquired(isNew: false), "same owner must reuse its lease")
assert(registry.acquire(key: key, connectionID: second, ref: nil) == .busy, "another connection must fail closed")
assert(registry.routeResult(key: key) == AOSSceneLeaseRoute(connectionID: first, ref: "request-2"), "latest same-owner ref must route results")

let subscribed = registry.updateSubscriptions(key: key, connectionID: first, adding: ["gesture"])
assert(subscribed == ["gesture"], "owner must add a gesture subscription")
assert(registry.routeEvent(key: key, event: "gesture") == AOSSceneLeaseRoute(connectionID: first, ref: "request-2"), "subscribed gesture must route")
assert(registry.routeEvent(key: key, event: "error") == nil, "unsubscribed events must not route")
assert(registry.updateSubscriptions(key: key, connectionID: second, adding: ["gesture"]) == nil, "non-owner must not mutate subscriptions")

assert(registry.updateSubscriptions(key: key, connectionID: first, removing: ["gesture"]) == [], "unsubscribe must remove the exact event")
assert(registry.routeEvent(key: key, event: "gesture") == nil, "unsubscribed gesture must stop routing")
assert(registry.releaseAll(connectionID: first) == [key], "disconnect cleanup must return owned keys")
assert(registry.routeResult(key: key) == nil, "disconnect cleanup must remove ownership")
assert(registry.acquire(key: key, connectionID: second, ref: nil) == .acquired(isNew: true), "cleaned lease must be reusable")
assert(registry.release(key: key, connectionID: first) == false, "former owner must not release replacement lease")
assert(registry.release(key: key, connectionID: second), "current owner must release its lease")

print("PASS daemon scene lease registry")
SWIFT

swiftc "$ROOT/src/daemon/scene-lease-registry.swift" "$TMP/main.swift" -o "$TMP/test-scene-lease-registry"
"$TMP/test-scene-lease-registry"
