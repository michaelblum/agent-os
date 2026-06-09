#!/usr/bin/env python3

"""Experimental AOS-owned agent runner skeleton.

This prototype is intentionally local, serial, and conservative. It loads
existing AOS role/profile source data, validates path planning, and defers any
provider execution behind an explicit runtime SDK check.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import sys
from dataclasses import dataclass
from typing import Any

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - exercised on older system Python
    tomllib = None


READ_ONLY_ROLES = frozenset({"explorer", "reviewer", "validator", "historian"})
READ_ONLY_SANDBOX_MODE = "read-only"
RUNTIME_ROOT = pathlib.Path(".runtime/dev/aos-agents")


class RunnerError(Exception):
    """User-facing runner failure."""


@dataclass(frozen=True)
class AgentSpec:
    name: str
    path: pathlib.Path
    description: str
    model: str
    model_reasoning_effort: str | None
    sandbox_mode: str | None
    developer_instructions: str


@dataclass(frozen=True)
class ProfilePack:
    name: str
    path: pathlib.Path
    markdown: str


@dataclass(frozen=True)
class ActiveProfile:
    path: pathlib.Path
    active_profile: str
    profile_packs: tuple[ProfilePack, ...]
    header: dict[str, Any]


def repo_root(start: pathlib.Path | None = None) -> pathlib.Path:
    current = (start or pathlib.Path.cwd()).resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".codex" / "agents").is_dir() and (candidate / ".docks" / "profiles").is_dir():
            return candidate
    raise RunnerError("Could not find repo root with .codex/agents and .docks/profiles")


def load_toml(path: pathlib.Path) -> dict[str, Any]:
    if tomllib is not None:
        with path.open("rb") as handle:
            return tomllib.load(handle)  # type: ignore[union-attr]
    return load_flat_toml(path)


def load_flat_toml(path: pathlib.Path) -> dict[str, Any]:
    """Parse the flat string TOML currently used by .codex/agents/*.toml.

    This keeps --self-test dependency-free on older Python versions. It is not a
    general TOML parser; nested tables and non-string values should use Python
    3.11+'s tomllib path.
    """

    data: dict[str, Any] = {}
    lines = path.read_text().splitlines()
    index = 0
    while index < len(lines):
        raw = lines[index]
        line = raw.strip()
        index += 1
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise RunnerError(f"{path} has unsupported TOML line: {raw}")
        key, value = [part.strip() for part in line.split("=", 1)]
        if value.startswith('"""'):
            collected: list[str] = []
            remainder = value[3:]
            if remainder.endswith('"""'):
                data[key] = remainder[:-3]
                continue
            if remainder:
                collected.append(remainder)
            while index < len(lines):
                multiline = lines[index]
                index += 1
                if multiline.endswith('"""'):
                    collected.append(multiline[:-3])
                    break
                collected.append(multiline)
            else:
                raise RunnerError(f"{path} has unterminated multiline string for {key}")
            data[key] = "\n".join(collected)
            continue
        if value.startswith('"') and value.endswith('"'):
            data[key] = value[1:-1]
            continue
        raise RunnerError(f"{path} has unsupported TOML value for {key}")
    return data


def load_agent_spec(path: pathlib.Path) -> AgentSpec:
    data = load_toml(path)
    name = data.get("name")
    if not isinstance(name, str) or not name:
        raise RunnerError(f"{path} is missing a string name")
    if name not in READ_ONLY_ROLES:
        raise RunnerError(f"Role {name!r} is not enabled in the experimental read-only runner")

    description = data.get("description", "")
    model = data.get("model", "")
    developer_instructions = data.get("developer_instructions", "")
    if not isinstance(description, str) or not isinstance(model, str):
        raise RunnerError(f"{path} has invalid description/model fields")
    if not isinstance(developer_instructions, str) or not developer_instructions.strip():
        raise RunnerError(f"{path} is missing developer_instructions")

    effort = data.get("model_reasoning_effort")
    sandbox_mode = data.get("sandbox_mode")
    if effort is not None and not isinstance(effort, str):
        raise RunnerError(f"{path} has invalid model_reasoning_effort")
    if sandbox_mode is not None and not isinstance(sandbox_mode, str):
        raise RunnerError(f"{path} has invalid sandbox_mode")
    if sandbox_mode != READ_ONLY_SANDBOX_MODE:
        raise RunnerError(
            f"{path} must declare sandbox_mode = {READ_ONLY_SANDBOX_MODE!r} "
            "for the experimental read-only runner"
        )

    return AgentSpec(
        name=name,
        path=path,
        description=description,
        model=model,
        model_reasoning_effort=effort,
        sandbox_mode=sandbox_mode,
        developer_instructions=developer_instructions,
    )


def load_agent_specs(root: pathlib.Path) -> dict[str, AgentSpec]:
    specs: dict[str, AgentSpec] = {}
    for role in sorted(READ_ONLY_ROLES):
        path = root / ".codex" / "agents" / f"{role}.toml"
        if path.is_file():
            spec = load_agent_spec(path)
            specs[spec.name] = spec

    missing = sorted(READ_ONLY_ROLES - specs.keys())
    if missing:
        raise RunnerError(f"Missing read-only agent specs: {', '.join(missing)}")
    return specs


def load_active_profile(root: pathlib.Path) -> ActiveProfile:
    path = root / ".docks" / "profiles" / "active-profile.json"
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise RunnerError(f"{path} is not valid JSON: {exc}") from exc

    active_profile = data.get("active_profile")
    pack_names = data.get("profile_packs")
    header = data.get("header", {})
    if not isinstance(active_profile, str) or not active_profile:
        raise RunnerError(f"{path} is missing active_profile")
    if not isinstance(pack_names, list) or not all(isinstance(item, str) for item in pack_names):
        raise RunnerError(f"{path} is missing profile_packs")
    if not isinstance(header, dict):
        raise RunnerError(f"{path} has invalid header")

    packs: list[ProfilePack] = []
    for pack_name in pack_names:
        pack_path = root / ".docks" / "profiles" / pack_name / "profile.md"
        if not pack_path.is_file():
            raise RunnerError(f"Profile pack {pack_name!r} is missing {pack_path}")
        packs.append(ProfilePack(name=pack_name, path=pack_path, markdown=pack_path.read_text()))

    return ActiveProfile(
        path=path,
        active_profile=active_profile,
        profile_packs=tuple(packs),
        header=header,
    )


def slug(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9_.-]+", "-", value.strip().lower()).strip("-._")
    return normalized or "task"


def task_hash(task: str) -> str:
    return hashlib.sha256(task.encode("utf-8")).hexdigest()[:12]


def output_dir(root: pathlib.Path, role: str, task: str) -> pathlib.Path:
    if role not in READ_ONLY_ROLES:
        raise RunnerError(f"Role {role!r} is not enabled in the experimental read-only runner")
    runtime_root = (root / RUNTIME_ROOT).resolve()
    planned = (runtime_root / "runs" / role / f"{slug(task)[:48]}-{task_hash(task)}").resolve(strict=False)
    try:
        planned.relative_to(runtime_root)
    except ValueError as exc:
        raise RunnerError(f"Planned output path escaped runtime root: {planned}") from exc
    return planned


def require_openai_agents_sdk() -> None:
    try:
        import agents  # noqa: F401
    except ModuleNotFoundError as exc:
        raise RunnerError(
            "OpenAI Agents SDK is not installed. Install it outside this runner before executing "
            "provider-backed runs; --self-test does not require it."
        ) from exc


def render_summary(root: pathlib.Path, specs: dict[str, AgentSpec], active_profile: ActiveProfile) -> dict[str, Any]:
    sample_task = "self test path behavior"
    return {
        "repo_root": str(root),
        "runtime_root": str(root / RUNTIME_ROOT),
        "roles": {
            name: {
                "path": str(spec.path.relative_to(root)),
                "model": spec.model,
                "sandbox_mode": spec.sandbox_mode,
            }
            for name, spec in sorted(specs.items())
        },
        "active_profile": {
            "path": str(active_profile.path.relative_to(root)),
            "active_profile": active_profile.active_profile,
            "profile_packs": [
                {"name": pack.name, "path": str(pack.path.relative_to(root)), "bytes": len(pack.markdown.encode("utf-8"))}
                for pack in active_profile.profile_packs
            ],
            "header": active_profile.header,
        },
        "sample_output_dir": str(output_dir(root, "explorer", sample_task)),
    }


def self_test(root: pathlib.Path) -> dict[str, Any]:
    specs = load_agent_specs(root)
    active_profile = load_active_profile(root)

    rejected = False
    try:
        output_dir(root, "implementer", "should fail")
    except RunnerError:
        rejected = True
    if not rejected:
        raise RunnerError("Write-capable role rejection failed")

    first = output_dir(root, "explorer", "same task")
    second = output_dir(root, "explorer", "same task")
    if first != second:
        raise RunnerError("Output directory planning is not deterministic")

    summary = render_summary(root, specs, active_profile)
    summary["self_test"] = "pass"
    return summary


def run(args: argparse.Namespace) -> dict[str, Any]:
    root = repo_root(pathlib.Path(args.repo_root) if args.repo_root else None)
    if args.self_test:
        return self_test(root)

    specs = load_agent_specs(root)
    role = args.role
    if role not in specs:
        raise RunnerError(f"Role {role!r} is not enabled. Allowed roles: {', '.join(sorted(specs))}")
    if not args.task:
        raise RunnerError("--task is required outside --self-test")

    active_profile = load_active_profile(root)
    require_openai_agents_sdk()
    planned_dir = output_dir(root, role, args.task)
    planned_dir.mkdir(parents=True, exist_ok=True)

    return {
        "status": "ready",
        "message": "Provider execution is intentionally not implemented in this skeleton.",
        "role": role,
        "agent_spec": str(specs[role].path.relative_to(root)),
        "active_profile": active_profile.active_profile,
        "output_dir": str(planned_dir),
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Experimental AOS-owned Python agent runner")
    parser.add_argument("--repo-root", help="Repo root override. Defaults to walking up from cwd.")
    parser.add_argument("--self-test", action="store_true", help="Validate parsing and path behavior without API calls.")
    parser.add_argument("--role", default="explorer", help="Read-only role to plan/run.")
    parser.add_argument("--task", help="Task text for path planning and future provider execution.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    try:
        result = run(parse_args(argv))
    except RunnerError as exc:
        print(json.dumps({"status": "error", "error": str(exc)}, indent=2, sort_keys=True), file=sys.stderr)
        return 1

    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
