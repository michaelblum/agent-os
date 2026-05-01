#!/usr/bin/env python3
"""Mock daemon socket server for input-tap readiness tests.

Speaks the v1 IPC envelope on a configurable Unix socket path. Responds to
system.ping and system.preflight with payloads whose input_tap and permissions
blocks are filled from CLI flags, so tests can exercise the daemon-aware
reporting layer without requiring a real CGEventTap failure or launchd
round-trip.

Usage:
  mock-daemon.py --socket PATH [--tap-status STATUS] [--listen-access BOOL]
                 [--post-access BOOL] [--accessibility BOOL] [--attempts N]
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import threading
import time
from typing import Any


def parse_bool(value: str) -> bool:
    return value.lower() in ("1", "true", "yes")


def build_ping_payload(args: argparse.Namespace) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "status": "ok",
        "uptime": 1.0,
        "pid": os.getpid(),
        "mode": args.mode,
        "socket_path": args.socket,
        "started_at": "2026-04-24T00:00:00Z",
        "perception_channels": 0,
        "subscribers": 0,
        # Legacy flat fields. A pre-input-tap-readiness-contract daemon emitted
        # only these — newer daemons emit them alongside the structured blocks
        # for compatibility (CONTRACT-GOVERNANCE rule 4).
        "input_tap_status": args.tap_status,
        "input_tap_attempts": args.attempts,
    }
    if not args.legacy:
        payload["input_tap"] = {
            "status": args.tap_status,
            "attempts": args.attempts,
            "listen_access": parse_bool(args.listen_access),
            "post_access": parse_bool(args.post_access),
            "last_error_at": None if args.tap_status == "active" else "2026-04-24T00:00:00Z",
        }
        payload["permissions"] = {
            "accessibility": parse_bool(args.accessibility),
        }
    return payload


def requested_capabilities(req: dict[str, Any]) -> list[str]:
    data = req.get("data") or {}
    if isinstance(data.get("capabilities"), list):
        return [str(item) for item in data["capabilities"]]
    raw = data.get("required_capabilities")
    if isinstance(raw, list):
        out: list[str] = []
        for item in raw:
            if isinstance(item, dict) and item.get("id"):
                out.append(str(item["id"]))
        return out
    return []


def build_preflight_payload(args: argparse.Namespace, req: dict[str, Any]) -> dict[str, Any]:
    capabilities = requested_capabilities(req)
    blocked: list[str] = []
    satisfied: list[str] = []
    blockers: list[dict[str, Any]] = []
    leases: list[dict[str, Any]] = []

    for capability in capabilities:
        if capability == "action.input":
            if args.tap_status != "active":
                blocked.append(capability)
                blockers.append({
                    "kind": "runtime",
                    "id": "input_tap_not_active",
                    "scope": "daemon",
                    "source": "daemon",
                    "capabilities": [capability],
                    "blocks": ["do"],
                    "message": f"Daemon input tap is not active (status={args.tap_status}, attempts={args.attempts}).",
                    "next_actions": [{
                        "type": "command",
                        "label": "Run explicit readiness repair",
                        "command": "./aos ready --repair",
                    }],
                })
                continue
            if not parse_bool(args.post_access):
                blocked.append(capability)
                blockers.append({
                    "kind": "permission",
                    "id": "input_monitoring_post",
                    "scope": "daemon",
                    "source": "daemon",
                    "capabilities": [capability],
                    "blocks": ["do"],
                    "message": "Daemon lacks Input Monitoring post access.",
                })
                continue

        satisfied.append(capability)
        leases.append({
            "capability": capability,
            "scope": "daemon",
            "mode": args.mode,
            "status": "valid",
            "source": "daemon",
            "checked_at": "2026-04-24T00:00:00Z",
            "expires_at": None,
            "daemon_pid": os.getpid(),
            "daemon_started_at": "2026-04-24T00:00:00Z",
            "socket_path": args.socket,
            "reused": False,
            "evidence": {"mock": True},
        })

    blocked_unique = sorted(set(blocked))
    return {
        "phase": "ready" if not blocked_unique else "capability_blocked",
        "diagnosis": "ready" if not blockers else blockers[0]["id"],
        "mode": args.mode,
        "command": (req.get("data") or {}).get("command"),
        "repair_attempted": False,
        "required_capabilities": capabilities,
        "satisfied_capabilities": sorted(set(satisfied)),
        "blocked_capabilities": blocked_unique,
        "leases": leases,
        "blockers": blockers,
    }


def handle_request(line: bytes, args: argparse.Namespace) -> bytes:
    try:
        req = json.loads(line.decode())
    except Exception:
        return json.dumps({"v": 1, "status": "error", "error": "bad envelope", "code": "BAD_ENVELOPE"}).encode() + b"\n"
    svc = req.get("service")
    action = req.get("action")
    ref = req.get("ref")
    if (svc, action) == ("system", "ping"):
        resp: dict[str, Any] = {
            "v": 1,
            "status": "success",
            "data": build_ping_payload(args),
        }
        if ref is not None:
            resp["ref"] = ref
        return json.dumps(resp).encode() + b"\n"
    if (svc, action) == ("system", "preflight"):
        payload = build_preflight_payload(args, req)
        resp = {
            "v": 1,
            "status": "success" if not payload["blocked_capabilities"] else "degraded",
            "data": payload,
        }
        if ref is not None:
            resp["ref"] = ref
        return json.dumps(resp).encode() + b"\n"
    err: dict[str, Any] = {
        "v": 1,
        "status": "error",
        "error": f"mock daemon: unsupported (service, action): ({svc}, {action})",
        "code": "UNKNOWN_ACTION",
    }
    if ref is not None:
        err["ref"] = ref
    return json.dumps(err).encode() + b"\n"


def serve_client(conn: socket.socket, args: argparse.Namespace) -> None:
    try:
        with conn:
            buf = b""
            conn.settimeout(2.0)
            while True:
                chunk = conn.recv(4096)
                if not chunk:
                    return
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    if not line.strip():
                        continue
                    conn.sendall(handle_request(line, args))
    except (BrokenPipeError, ConnectionResetError, socket.timeout):
        return


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--socket", required=True)
    parser.add_argument("--mode", default="repo", choices=("repo", "installed"))
    parser.add_argument("--tap-status", default="active",
                        choices=("active", "retrying", "unavailable"))
    parser.add_argument("--attempts", type=int, default=1)
    parser.add_argument("--listen-access", default="true")
    parser.add_argument("--post-access", default="true")
    parser.add_argument("--accessibility", default="true")
    parser.add_argument("--legacy", action="store_true",
                        help="Emit only legacy flat fields; omit the structured "
                             "input_tap/permissions blocks (simulates a "
                             "pre-readiness-contract daemon binary).")
    args = parser.parse_args()

    if os.path.exists(args.socket):
        os.unlink(args.socket)
    os.makedirs(os.path.dirname(args.socket), exist_ok=True)

    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(args.socket)
    server.listen(8)
    server.settimeout(0.5)

    sys.stdout.write(f"mock-daemon ready socket={args.socket} tap={args.tap_status}\n")
    sys.stdout.flush()

    try:
        while True:
            try:
                conn, _ = server.accept()
            except socket.timeout:
                continue
            t = threading.Thread(target=serve_client, args=(conn, args), daemon=True)
            t.start()
    except KeyboardInterrupt:
        pass
    finally:
        try:
            server.close()
        finally:
            if os.path.exists(args.socket):
                try:
                    os.unlink(args.socket)
                except OSError:
                    pass


if __name__ == "__main__":
    main()
