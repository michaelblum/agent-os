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
import os
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
SUMMARY_STATUSES = frozenset({"ready", "completed", "error"})


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
    root_dir = runtime_root(root)
    planned = (root_dir / "runs" / role / f"{slug(task)[:48]}-{task_hash(task)}").resolve(strict=False)
    try:
        planned.relative_to(root_dir)
    except ValueError as exc:
        raise RunnerError(f"Planned output path escaped runtime root: {planned}") from exc
    return planned


def runtime_root(root: pathlib.Path) -> pathlib.Path:
    return (root / RUNTIME_ROOT).resolve()


def resolve_run_dir(root: pathlib.Path, value: str) -> pathlib.Path:
    root_dir = runtime_root(root)
    candidate = pathlib.Path(value).expanduser()
    if candidate.is_absolute():
        resolved = candidate.resolve(strict=False)
    else:
        repo_relative = (root / candidate).resolve(strict=False)
        runtime_relative = (root_dir / "runs" / candidate).resolve(strict=False)
        resolved = repo_relative if is_relative_to(repo_relative, root_dir) else runtime_relative
    if not is_relative_to(resolved, root_dir):
        raise RunnerError(f"Run path escaped runtime root: {resolved}")
    return resolved


def is_relative_to(path: pathlib.Path, parent: pathlib.Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def load_json_file(path: pathlib.Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text())
    except FileNotFoundError as exc:
        raise RunnerError(f"Missing artifact: {path}") from exc
    except json.JSONDecodeError as exc:
        raise RunnerError(f"Invalid JSON artifact {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise RunnerError(f"Invalid JSON artifact {path}: expected object")
    return data


def list_runs(root: pathlib.Path, role: str | None = None) -> dict[str, Any]:
    if role is not None and role not in READ_ONLY_ROLES:
        raise RunnerError(f"Role {role!r} is not enabled. Allowed roles: {', '.join(sorted(READ_ONLY_ROLES))}")
    root_dir = runtime_root(root)
    summaries: list[dict[str, Any]] = []
    role_dirs = [root_dir / "runs" / role] if role else sorted((root_dir / "runs").glob("*"))
    for role_dir in role_dirs:
        if not role_dir.is_dir() or (role_dir.name not in READ_ONLY_ROLES):
            continue
        for summary_path in sorted(role_dir.glob("*/summary.json")):
            run_dir = summary_path.parent.resolve(strict=False)
            result_path = run_dir / "result.json"
            item: dict[str, Any] = {
                "role": role_dir.name,
                "output_dir": str(run_dir),
                "summary_path": str(summary_path),
                "result_path": str(result_path),
                "result_exists": result_path.is_file(),
            }
            try:
                summary = load_json_file(summary_path)
            except RunnerError as exc:
                item["artifact_error"] = str(exc)
            else:
                item["summary"] = summary
            summaries.append(item)
    return {
        "status": "success",
        "runtime_root": str(root_dir),
        "count": len(summaries),
        "runs": summaries,
    }


def read_run(root: pathlib.Path, value: str) -> dict[str, Any]:
    run_dir = resolve_run_dir(root, value)
    summary_path = run_dir / "summary.json"
    result_path = run_dir / "result.json"
    result: dict[str, Any] | None = None
    if result_path.exists():
        if not result_path.is_file():
            raise RunnerError(f"Refusing to read non-file result path: {result_path}")
        result = load_json_file(result_path)
    return {
        "status": "success",
        "output_dir": str(run_dir),
        "summary_path": str(summary_path),
        "result_path": str(result_path),
        "result_exists": result is not None,
        "summary": load_json_file(summary_path),
        "result": result,
    }


def require_openai_agents_sdk() -> Any:
    os.environ["OPENAI_AGENTS_DISABLE_TRACING"] = "1"
    try:
        import agents
    except ModuleNotFoundError as exc:
        raise RunnerError(
            "OpenAI Agents SDK is not installed. Install it outside this runner before executing "
            "provider-backed runs; --self-test does not require it."
        ) from exc
    agent_cls = getattr(agents, "Agent", None)
    runner_cls = getattr(agents, "Runner", None)
    run_sync = getattr(runner_cls, "run_sync", None)
    if not callable(agent_cls) or not callable(run_sync):
        raise RunnerError("OpenAI Agents SDK import succeeded but Agent or Runner.run_sync is unavailable")
    set_tracing_disabled = getattr(agents, "set_tracing_disabled", None)
    if callable(set_tracing_disabled):
        set_tracing_disabled(True)
    return agents


def build_agent_instructions(spec: AgentSpec, active_profile: ActiveProfile) -> str:
    header = json.dumps(active_profile.header, indent=2, sort_keys=True)
    packs = "\n\n".join(
        f"## Profile Pack: {pack.name}\n\n{pack.markdown.strip()}" for pack in active_profile.profile_packs
    )
    return "\n\n".join(
        [
            f"# AOS Read-Only Agent: {spec.name}",
            "This run is constrained to read-only reasoning. Do not claim to edit files, run commands, "
            "mutate git, mutate GitHub, install dependencies, or change runtime state.",
            "# Role Description",
            spec.description.strip(),
            "# Role Instructions",
            spec.developer_instructions.strip(),
            "# Active Profile",
            active_profile.active_profile,
            "# Active Profile Header",
            header,
            "# Active Profile Packs",
            packs,
        ]
    )


def execute_provider_run(
    sdk: Any,
    spec: AgentSpec,
    active_profile: ActiveProfile,
    task: str,
    max_turns: int,
) -> dict[str, Any]:
    agent = sdk.Agent(
        name=spec.name,
        instructions=build_agent_instructions(spec, active_profile),
        model=spec.model or None,
    )
    result = sdk.Runner.run_sync(agent, task, max_turns=max_turns)
    final_output = getattr(result, "final_output", None)
    if final_output is None:
        final_output = str(result)
    return {
        "final_output": str(final_output),
        "result_type": type(result).__name__,
    }


def write_json(path: pathlib.Path, data: dict[str, Any]) -> None:
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")


def summary_doc(
    status: str,
    root: pathlib.Path,
    role: str,
    spec: AgentSpec,
    active_profile: ActiveProfile,
    task: str,
    planned_dir: pathlib.Path,
    execute: bool,
    max_turns: int,
    result_path: pathlib.Path | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    if status not in SUMMARY_STATUSES:
        allowed = ", ".join(sorted(SUMMARY_STATUSES))
        raise RunnerError(f"Invalid summary status {status!r}; expected one of: {allowed}")
    if status == "ready" and execute:
        raise RunnerError("Ready summary must not be marked as execute")
    if status in {"completed", "error"} and not execute:
        raise RunnerError(f"Summary status {status!r} requires execute")
    if status == "completed" and result_path is None:
        raise RunnerError("Completed summary requires result_path")
    if status != "completed" and result_path is not None:
        raise RunnerError(f"Summary status {status!r} must not include result_path")
    if status == "error" and not error:
        raise RunnerError("Error summary requires an error message")
    if status != "error" and error is not None:
        raise RunnerError(f"Summary status {status!r} must not include an error message")

    doc: dict[str, Any] = {
        "schema_version": 1,
        "status": status,
        "role": role,
        "agent_spec": str(spec.path.relative_to(root)),
        "active_profile": active_profile.active_profile,
        "task_hash": task_hash(task),
        "execute": execute,
        "max_turns": max_turns,
        "output_dir": str(planned_dir),
        "summary_path": str(planned_dir / "summary.json"),
    }
    if result_path is not None:
        doc["result_path"] = str(result_path)
    if error is not None:
        doc["error"] = error
    return doc


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

    invalid_summary_rejected = False
    try:
        summary_doc(
            "bogus",
            root,
            "explorer",
            specs["explorer"],
            active_profile,
            "same task",
            first,
            False,
            1,
        )
    except RunnerError:
        invalid_summary_rejected = True
    if not invalid_summary_rejected:
        raise RunnerError("Summary status validation failed")

    summary = render_summary(root, specs, active_profile)
    summary["self_test"] = "pass"
    return summary


def run(args: argparse.Namespace) -> dict[str, Any]:
    root = repo_root(pathlib.Path(args.repo_root) if args.repo_root else None)
    if args.list_runs and args.read_run:
        raise RunnerError("--list-runs and --read-run are mutually exclusive")
    if args.self_test:
        if args.list_runs or args.read_run:
            raise RunnerError("--self-test cannot be combined with artifact readback")
        return self_test(root)
    if args.list_runs:
        return list_runs(root, args.role)
    if args.read_run:
        return read_run(root, args.read_run)

    specs = load_agent_specs(root)
    role = args.role or "explorer"
    if role not in specs:
        raise RunnerError(f"Role {role!r} is not enabled. Allowed roles: {', '.join(sorted(specs))}")
    if not args.task:
        raise RunnerError("--task is required outside --self-test")
    if args.max_turns < 1:
        raise RunnerError("--max-turns must be at least 1")

    active_profile = load_active_profile(root)
    sdk = require_openai_agents_sdk()
    planned_dir = output_dir(root, role, args.task)
    planned_dir.mkdir(parents=True, exist_ok=True)

    summary_path = planned_dir / "summary.json"
    base_result = {
        "status": "ready",
        "message": "Provider execution is available with --execute.",
        "role": role,
        "agent_spec": str(specs[role].path.relative_to(root)),
        "active_profile": active_profile.active_profile,
        "output_dir": str(planned_dir),
        "summary_path": str(summary_path),
    }
    if not args.execute:
        write_json(
            summary_path,
            summary_doc("ready", root, role, specs[role], active_profile, args.task, planned_dir, False, args.max_turns),
        )
        return base_result

    result_path = planned_dir / "result.json"
    if result_path.exists():
        if result_path.is_file() or result_path.is_symlink():
            result_path.unlink()
        else:
            raise RunnerError(f"Refusing to replace non-file result path: {result_path}")
    try:
        provider_result = execute_provider_run(sdk, specs[role], active_profile, args.task, args.max_turns)
    except Exception as exc:
        error_message = f"Provider execution failed: {exc}"
        write_json(
            summary_path,
            summary_doc(
                "error",
                root,
                role,
                specs[role],
                active_profile,
                args.task,
                planned_dir,
                True,
                args.max_turns,
                error=error_message,
            ),
        )
        raise RunnerError(error_message) from exc

    summary = summary_doc(
        "completed",
        root,
        role,
        specs[role],
        active_profile,
        args.task,
        planned_dir,
        True,
        args.max_turns,
        result_path,
    )
    result_doc = {
        "status": "completed",
        "role": role,
        "agent_spec": str(specs[role].path.relative_to(root)),
        "active_profile": active_profile.active_profile,
        "task_hash": task_hash(args.task),
        "max_turns": args.max_turns,
        **provider_result,
    }
    write_json(result_path, result_doc)
    write_json(summary_path, summary)
    return {
        **base_result,
        "status": "completed",
        "message": "Provider execution completed.",
        "result_path": str(result_path),
        **provider_result,
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Experimental AOS-owned Python agent runner")
    parser.add_argument("--repo-root", "--repo", dest="repo_root", help="Repo root override. Defaults to walking up from cwd.")
    parser.add_argument("--self-test", action="store_true", help="Validate parsing and path behavior without API calls.")
    parser.add_argument("--list-runs", action="store_true", help="List existing runtime summaries without SDK or provider calls.")
    parser.add_argument("--read-run", help="Read summary.json and result.json for an output_dir under the runtime root.")
    parser.add_argument("--role", help="Read-only role to plan/run or filter --list-runs.")
    parser.add_argument("--task", help="Task text for path planning and future provider execution.")
    parser.add_argument("--execute", action="store_true", help="Run the provider-backed agent after validation.")
    parser.add_argument("--max-turns", type=int, default=1, help="Maximum provider turns for --execute. Defaults to 1.")
    parser.add_argument("--json", action="store_true", help="Accepted for ./aos dev command-surface consistency.")
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
