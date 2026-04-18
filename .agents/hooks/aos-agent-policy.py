#!/usr/bin/env python3
"""Silent AOS usage telemetry + failure-streak policy for hook scripts."""

from __future__ import annotations

import json
import os
import re
import shlex
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


FAIL_LIMIT = int(os.environ.get("AOS_AGENT_FAILURE_LIMIT", "4"))
TTL_SECONDS = int(os.environ.get("AOS_AGENT_USAGE_TTL_SECONDS", str(72 * 60 * 60)))
MAX_LOG_LINES = int(os.environ.get("AOS_AGENT_USAGE_MAX_LINES", "4000"))


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sanitize(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", value)


def detect_harness() -> str:
    if os.environ.get("AOS_SESSION_HARNESS"):
        return os.environ["AOS_SESSION_HARNESS"]
    if os.environ.get("CODEX_THREAD_ID"):
        return "codex"
    if os.environ.get("CLAUDE_CODE_SSE_PORT"):
        return "claude-code"
    return "unknown"


def detect_session() -> str:
    if os.environ.get("AOS_SESSION_ID"):
        return sanitize(os.environ["AOS_SESSION_ID"])
    if os.environ.get("CODEX_THREAD_ID"):
        return sanitize(f"codex-{os.environ['CODEX_THREAD_ID']}")
    if os.environ.get("AOS_SESSION_NAME"):
        return sanitize(f"name-{os.environ['AOS_SESSION_NAME']}")
    if os.environ.get("CLAUDE_CODE_SSE_PORT"):
        return sanitize(f"claude-port-{os.environ['CLAUDE_CODE_SSE_PORT']}")
    return sanitize(f"pid-{os.getppid()}")


def state_dir() -> Path:
    root = os.environ.get("AOS_STATE_ROOT") or os.path.expanduser("~/.config/aos")
    mode = os.environ.get("AOS_RUNTIME_MODE", "repo")
    return Path(root) / mode / "agent-introspection"


def usage_log_path() -> Path:
    return state_dir() / "aos-usage.jsonl"


def session_state_path(session: str) -> Path:
    return state_dir() / "sessions" / f"{session}.json"


def load_payload() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        return json.loads(raw)
    except Exception:
        return {}


def dig(obj: Any, path: list[str]) -> Any:
    cur = obj
    for key in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur


def find_scalar(obj: Any, keys: set[str]) -> Any:
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key in keys and isinstance(value, (str, int, float, bool)):
                return value
            found = find_scalar(value, keys)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = find_scalar(item, keys)
            if found is not None:
                return found
    return None


def extract_command(payload: dict[str, Any]) -> str:
    for path in (
        ["tool_input", "command"],
        ["tool_input", "cmd"],
        ["toolUse", "input", "command"],
        ["input", "command"],
        ["command"],
        ["payload", "tool_input", "command"],
    ):
        value = dig(payload, path)
        if isinstance(value, str) and value.strip():
            return value.strip()
    value = find_scalar(payload, {"command"})
    return value.strip() if isinstance(value, str) else ""


def extract_text(payload: dict[str, Any], preferred_paths: list[list[str]], fallback_keys: set[str]) -> str:
    for path in preferred_paths:
        value = dig(payload, path)
        if isinstance(value, str) and value:
            return value
    value = find_scalar(payload, fallback_keys)
    return value if isinstance(value, str) else ""


def extract_exit_code(payload: dict[str, Any]) -> int | None:
    for path in (
        ["tool_output", "exit_code"],
        ["tool_response", "exit_code"],
        ["tool_result", "exit_code"],
        ["output", "exit_code"],
        ["result", "exit_code"],
        ["payload", "exit_code"],
        ["exit_code"],
        ["content", "return_code"],
        ["return_code"],
    ):
        value = dig(payload, path)
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.lstrip("-").isdigit():
            return int(value)
    value = find_scalar(payload, {"exit_code", "return_code"})
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.lstrip("-").isdigit():
        return int(value)
    return None


def extract_duration_ms(payload: dict[str, Any]) -> int | None:
    for path in (
        ["duration_ms"],
        ["tool_output", "duration_ms"],
        ["tool_response", "duration_ms"],
        ["result", "duration_ms"],
    ):
        value = dig(payload, path)
        if isinstance(value, int):
            return value
    value = find_scalar(payload, {"duration_ms"})
    return value if isinstance(value, int) else None


def parse_json_object(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    text = text.strip()
    if not text or not text.startswith("{"):
        return None
    try:
        value = json.loads(text)
    except Exception:
        return None
    return value if isinstance(value, dict) else None


def extract_error(stdout: str, stderr: str) -> tuple[str | None, bool]:
    for blob in (stderr, stdout):
        obj = parse_json_object(blob)
        if not obj:
            continue
        code = obj.get("code")
        has_error = "error" in obj
        if isinstance(code, str):
            return code, has_error or bool(code)
        if has_error:
            return None, True
    return None, False


def parse_command(command: str) -> dict[str, Any]:
    if not command.strip():
        return {"is_aos": False, "bare": False, "token": None, "path": []}

    try:
        tokens = shlex.split(command)
    except Exception:
        tokens = command.split()

    for index, token in enumerate(tokens):
        if token == "aos" or token == "./aos" or token.endswith("/aos"):
            after = tokens[index + 1 :]
            path: list[str] = []
            if after:
                if after[0] in {"--help", "-h"}:
                    path = ["help"]
                elif after[0] == "help":
                    path = ["help"]
                    for item in after[1:]:
                        if item.startswith("-"):
                            break
                        path.append(item)
                else:
                    path = [after[0]]
                    if len(after) > 1 and not after[1].startswith("-") and after[0] in {
                        "see",
                        "show",
                        "do",
                        "content",
                        "voice",
                        "config",
                        "set",
                        "service",
                        "runtime",
                        "permissions",
                        "focus",
                        "graph",
                        "introspect",
                        "wiki",
                    }:
                        path.append(after[1])
            return {
                "is_aos": True,
                "bare": token == "aos",
                "token": token,
                "path": path,
            }
    return {"is_aos": False, "bare": False, "token": None, "path": []}


def is_recovery_command(info: dict[str, Any]) -> bool:
    path = info.get("path") or []
    if not path:
        return False
    if path[0] == "introspect":
        return True
    joined = "/".join(path)
    return joined in {"status", "help", "introspect/review"}


def load_session_state(session: str) -> dict[str, Any]:
    path = session_state_path(session)
    if not path.exists():
        return {
            "session": session,
            "harness": detect_harness(),
            "consecutive_failures": 0,
            "total_events": 0,
            "last_updated": None,
        }
    try:
        return json.loads(path.read_text())
    except Exception:
        return {
            "session": session,
            "harness": detect_harness(),
            "consecutive_failures": 0,
            "total_events": 0,
            "last_updated": None,
        }


def write_session_state(session: str, state: dict[str, Any]) -> None:
    path = session_state_path(session)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, sort_keys=True, indent=2))


def prune_logs_and_state() -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=TTL_SECONDS)
    log_path = usage_log_path()
    state_dir().mkdir(parents=True, exist_ok=True)
    (state_dir() / "sessions").mkdir(parents=True, exist_ok=True)

    kept_lines: list[str] = []
    if log_path.exists():
        for raw in log_path.read_text().splitlines():
            if not raw.strip():
                continue
            try:
                obj = json.loads(raw)
            except Exception:
                continue
            timestamp = obj.get("timestamp")
            if not isinstance(timestamp, str):
                continue
            try:
                dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            except Exception:
                continue
            if dt >= cutoff:
                kept_lines.append(json.dumps(obj, sort_keys=True))
    kept_lines = kept_lines[-MAX_LOG_LINES:]
    if kept_lines:
        log_path.write_text("\n".join(kept_lines) + "\n")
    elif log_path.exists():
        log_path.unlink()

    sessions_dir = state_dir() / "sessions"
    for path in sessions_dir.glob("*.json"):
        try:
            obj = json.loads(path.read_text())
            timestamp = obj.get("last_updated")
            dt = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00"))
        except Exception:
            path.unlink(missing_ok=True)
            continue
        if dt < cutoff:
            path.unlink(missing_ok=True)


def append_event(event: dict[str, Any], *, preserve_streak: bool = False) -> None:
    prune_logs_and_state()
    session = event["session"]
    state = load_session_state(session)
    state["harness"] = event.get("harness") or state.get("harness")
    state["total_events"] = int(state.get("total_events") or 0) + 1
    state["last_updated"] = event["timestamp"]

    if not preserve_streak:
        outcome = event.get("outcome")
        if outcome == "success":
            state["consecutive_failures"] = 0
        elif outcome in {"error", "blocked"}:
            state["consecutive_failures"] = int(state.get("consecutive_failures") or 0) + 1

    write_session_state(session, state)

    log_path = usage_log_path()
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, sort_keys=True))
        handle.write("\n")


def base_event(command: str, info: dict[str, Any]) -> dict[str, Any]:
    return {
        "timestamp": now_iso(),
        "session": detect_session(),
        "harness": detect_harness(),
        "command": command,
        "command_path": info.get("path") or [],
        "prefix": info.get("token"),
    }


def handle_pre(payload: dict[str, Any]) -> int:
    command = extract_command(payload)
    info = parse_command(command)
    session = detect_session()
    state = load_session_state(session)
    streak = int(state.get("consecutive_failures") or 0)

    if info.get("bare"):
        event = base_event(command, info)
        event.update(
            {
                "source": "pre",
                "outcome": "blocked",
                "error_code": "USE_REPO_AOS",
                "blocked_reason": "Use ./aos, not aos, in repo mode.",
            }
        )
        append_event(event)
        print("Blocked: use ./aos, not aos, in this repo.", file=sys.stderr)
        return 2

    if streak >= FAIL_LIMIT and not is_recovery_command(info):
        event = base_event(command, info)
        event.update(
            {
                "source": "pre",
                "outcome": "blocked",
                "error_code": "AOS_REVIEW_REQUIRED",
                "blocked_reason": f"Repeated failed ./aos attempts ({streak}). Run ./aos introspect review or ./aos help/status before more shell work.",
            }
        )
        append_event(event, preserve_streak=True)
        print(
            f"Blocked: repeated failed ./aos attempts ({streak}). Run ./aos introspect review or ./aos help/status before more shell work.",
            file=sys.stderr,
        )
        return 2

    return 0


def handle_post(payload: dict[str, Any]) -> int:
    command = extract_command(payload)
    info = parse_command(command)
    if not info.get("is_aos") or info.get("bare"):
        return 0

    stdout = extract_text(
        payload,
        preferred_paths=[
            ["tool_output", "stdout"],
            ["tool_response", "stdout"],
            ["result", "stdout"],
            ["output", "stdout"],
            ["content", "stdout"],
            ["stdout"],
        ],
        fallback_keys={"stdout"},
    )
    stderr = extract_text(
        payload,
        preferred_paths=[
            ["tool_output", "stderr"],
            ["tool_response", "stderr"],
            ["result", "stderr"],
            ["output", "stderr"],
            ["content", "stderr"],
            ["stderr"],
        ],
        fallback_keys={"stderr"},
    )
    exit_code = extract_exit_code(payload)
    duration_ms = extract_duration_ms(payload)
    error_code, has_error = extract_error(stdout, stderr)

    if exit_code is None and not stdout and not stderr:
        outcome = "unknown"
    elif (exit_code is not None and exit_code != 0) or has_error:
        outcome = "error"
    else:
        outcome = "success"

    event = base_event(command, info)
    event.update(
        {
            "source": "post",
            "outcome": outcome,
            "exit_code": exit_code,
            "error_code": error_code,
            "duration_ms": duration_ms,
        }
    )
    append_event(event)
    return 0


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in {"pre", "post"}:
        print("usage: aos-agent-policy.py <pre|post>", file=sys.stderr)
        return 1

    payload = load_payload()
    if sys.argv[1] == "pre":
        return handle_pre(payload)
    return handle_post(payload)


if __name__ == "__main__":
    raise SystemExit(main())
