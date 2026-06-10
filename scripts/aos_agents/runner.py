#!/usr/bin/env python3

"""AOS-owned agent runtime contract and local artifact gate.

The runtime is intentionally local, serial, and conservative. It loads existing
AOS role/profile source data, keeps provider SDK execution as the default
AOS-owned child execution path, validates explicit native Codex dispatch
contracts only as a diagnostic/import lane, and owns patch-artifact check/apply
gates without delegating checkout mutation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
from dataclasses import dataclass
from typing import Any

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - exercised on older system Python
    tomllib = None


READ_ONLY_ROLES = frozenset({"explorer", "reviewer", "validator", "historian"})
PATCH_OUTPUT_ROLES = frozenset({"implementer"})
ARTIFACT_ROLES = READ_ONLY_ROLES | PATCH_OUTPUT_ROLES
READ_ONLY_SANDBOX_MODE = "read-only"
RUNTIME_ROOT = pathlib.Path(".runtime/dev/aos-agents")
ENGINE_NATIVE_CODEX = "native-codex"
ENGINE_PROVIDER_SDK = "provider-sdk"
ENGINES = frozenset({ENGINE_NATIVE_CODEX, ENGINE_PROVIDER_SDK})
DEFAULT_ENGINE = ENGINE_PROVIDER_SDK
SUMMARY_STATUSES = frozenset({"ready", "completed", "blocked", "error"})
CONTEXT_FILE_MAX_BYTES = 12000
CONTEXT_FILE_MAX_LINES = 240
NATIVE_DISPATCH_ARTIFACT = "native-dispatch.json"


class RunnerError(Exception):
    """User-facing runner failure."""


class PatchArtifactError(RunnerError):
    """Structured failure for patch artifact review or application."""

    def __init__(self, message: str, payload: dict[str, Any]):
        super().__init__(message)
        self.payload = payload


class PatchCheckError(PatchArtifactError):
    """Structured failure for check-only patch artifact review."""


class NativeExecutionBlocked(RunnerError):
    """Native Codex execution cannot be driven from this local process."""

    def __init__(self, message: str, summary: dict[str, Any]):
        super().__init__(message)
        self.summary = summary


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


@dataclass(frozen=True)
class IncludedContextFile:
    repo_path: str
    path: pathlib.Path
    text: str
    truncated: bool


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


def load_agent_spec(
    path: pathlib.Path,
    *,
    allowed_roles: frozenset[str] = READ_ONLY_ROLES,
    require_read_only_sandbox: bool = True,
) -> AgentSpec:
    data = load_toml(path)
    name = data.get("name")
    if not isinstance(name, str) or not name:
        raise RunnerError(f"{path} is missing a string name")
    if name not in allowed_roles:
        raise RunnerError(f"Role {name!r} is not enabled in the experimental runner")

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
    if require_read_only_sandbox and sandbox_mode != READ_ONLY_SANDBOX_MODE:
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


def load_patch_output_spec(root: pathlib.Path, role: str) -> AgentSpec:
    if role not in PATCH_OUTPUT_ROLES:
        raise RunnerError(
            f"--patch-output is only enabled for: {', '.join(sorted(PATCH_OUTPUT_ROLES))}"
        )
    path = root / ".codex" / "agents" / f"{role}.toml"
    if not path.is_file():
        raise RunnerError(f"Missing patch-output agent spec: {path}")
    return load_agent_spec(path, allowed_roles=PATCH_OUTPUT_ROLES, require_read_only_sandbox=False)


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


def output_dir(root: pathlib.Path, role: str, task: str, *, patch_output: bool = False) -> pathlib.Path:
    allowed_roles = ARTIFACT_ROLES if patch_output else READ_ONLY_ROLES
    if role not in allowed_roles:
        raise RunnerError(f"Role {role!r} is not enabled in the experimental read-only runner")
    root_dir = runtime_root(root)
    planned = (root_dir / "runs" / role / f"{slug(task)[:48]}-{task_hash(task)}").resolve(strict=False)
    try:
        planned.relative_to(root_dir)
    except ValueError as exc:
        raise RunnerError(f"Planned output path escaped runtime root: {planned}") from exc
    return planned


def normalize_engine(value: str | None) -> str:
    if value is None:
        return DEFAULT_ENGINE
    normalized = value.strip().lower()
    aliases = {
        "native": ENGINE_NATIVE_CODEX,
        "codex": ENGINE_NATIVE_CODEX,
        "native-codex": ENGINE_NATIVE_CODEX,
        "provider": ENGINE_PROVIDER_SDK,
        "provider-sdk": ENGINE_PROVIDER_SDK,
        "openai-agents": ENGINE_PROVIDER_SDK,
    }
    engine = aliases.get(normalized)
    if engine is None:
        raise RunnerError(f"Unknown --engine {value!r}. Allowed engines: {', '.join(sorted(ENGINES))}")
    return engine


def runtime_root(root: pathlib.Path) -> pathlib.Path:
    return (root / RUNTIME_ROOT).resolve()


def git_ignored(root: pathlib.Path, repo_path: str) -> bool:
    if not (root / ".git").exists():
        return False
    try:
        completed = subprocess.run(
            ("git", "check-ignore", "-q", "--", repo_path),
            cwd=root,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except OSError:
        return False
    return completed.returncode == 0


def resolve_context_file(root: pathlib.Path, value: str) -> IncludedContextFile:
    requested = pathlib.Path(value)
    if requested.is_absolute():
        raise RunnerError(f"--context-file must be repo-relative: {value}")
    candidate = (root / requested).resolve(strict=False)
    if not is_relative_to(candidate, root):
        raise RunnerError(f"--context-file escaped repo root: {value}")
    if is_relative_to(candidate, runtime_root(root)):
        raise RunnerError(f"--context-file may not include runtime artifacts: {value}")
    repo_path = candidate.relative_to(root).as_posix()
    if repo_path == ".git" or repo_path.startswith(".git/"):
        raise RunnerError(f"--context-file may not include git internals: {value}")
    if git_ignored(root, repo_path):
        raise RunnerError(f"--context-file may not include ignored files: {repo_path}")
    if not candidate.is_file():
        raise RunnerError(f"--context-file is not a repo file: {repo_path}")

    raw = candidate.read_bytes()
    truncated = len(raw) > CONTEXT_FILE_MAX_BYTES
    text = raw[:CONTEXT_FILE_MAX_BYTES].decode("utf-8", errors="replace")
    lines = text.splitlines()
    if len(lines) > CONTEXT_FILE_MAX_LINES:
        text = "\n".join(lines[:CONTEXT_FILE_MAX_LINES])
        truncated = True
    return IncludedContextFile(repo_path=repo_path, path=candidate, text=text, truncated=truncated)


def load_context_files(root: pathlib.Path, values: list[str] | None) -> tuple[IncludedContextFile, ...]:
    if not values:
        return ()
    loaded: list[IncludedContextFile] = []
    seen: set[str] = set()
    for value in values:
        context_file = resolve_context_file(root, value)
        if context_file.repo_path not in seen:
            loaded.append(context_file)
            seen.add(context_file.repo_path)
    return tuple(loaded)


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
    if role is not None and role not in ARTIFACT_ROLES:
        raise RunnerError(f"Role {role!r} is not enabled. Allowed roles: {', '.join(sorted(ARTIFACT_ROLES))}")
    root_dir = runtime_root(root)
    summaries: list[dict[str, Any]] = []
    role_dirs = [root_dir / "runs" / role] if role else sorted((root_dir / "runs").glob("*"))
    for role_dir in role_dirs:
        if not role_dir.is_dir() or (role_dir.name not in ARTIFACT_ROLES):
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


def git_status_porcelain(root: pathlib.Path) -> list[str] | None:
    try:
        completed = subprocess.run(
            ("git", "status", "--porcelain"),
            cwd=root,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return completed.stdout.splitlines()


def require_git_status_porcelain(root: pathlib.Path) -> list[str]:
    lines = git_status_porcelain(root)
    if lines is None:
        raise RunnerError(f"Could not read git status for repo root: {root}")
    return lines


def git_status_clean(root: pathlib.Path) -> bool:
    return git_status_porcelain(root) == []


def run_git_apply_check(root: pathlib.Path, patch_path: pathlib.Path) -> tuple[bool, str]:
    try:
        completed = subprocess.run(
            ("git", "apply", "--check", str(patch_path)),
            cwd=root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except OSError as exc:
        return False, str(exc)
    output = "\n".join(part.strip() for part in (completed.stdout, completed.stderr) if part.strip())
    return completed.returncode == 0, output


def run_git_apply(root: pathlib.Path, patch_path: pathlib.Path) -> tuple[bool, str]:
    try:
        completed = subprocess.run(
            ("git", "apply", str(patch_path)),
            cwd=root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except OSError as exc:
        return False, str(exc)
    output = "\n".join(part.strip() for part in (completed.stdout, completed.stderr) if part.strip())
    return completed.returncode == 0, output


def check_patch_failure(message: str, payload: dict[str, Any]) -> None:
    raise PatchCheckError(
        message,
        {
            **payload,
            "status": "error",
            "error": message,
        },
    )


def require_artifact_value(
    artifact_name: str,
    doc: dict[str, Any],
    key: str,
    expected: str,
    payload: dict[str, Any],
) -> None:
    observed = doc.get(key)
    if observed != expected:
        check_patch_failure(
            f"{artifact_name} {key} mismatch: expected {expected}, observed {observed!r}",
            payload,
        )


def validate_patch_artifact(root: pathlib.Path, value: str) -> tuple[dict[str, Any], pathlib.Path]:
    run_dir = resolve_run_dir(root, value)
    if not run_dir.is_dir():
        raise RunnerError(f"Run directory not found under runtime root: {run_dir}")

    summary_path = run_dir / "summary.json"
    result_path = run_dir / "result.json"
    patch_path = run_dir / "patch.diff"
    payload: dict[str, Any] = {
        "status": "error",
        "output_dir": str(run_dir),
        "summary_path": str(summary_path),
        "result_path": str(result_path),
        "patch_path": str(patch_path),
        "patch_exists": patch_path.is_file() and not patch_path.is_symlink(),
        "apply_check": "not_run",
        "touched_paths": [],
        "git_status_clean": git_status_clean(root),
        "suggested_next": None,
    }

    summary = load_json_file(summary_path)
    result = load_json_file(result_path)
    if summary.get("status") != "completed":
        check_patch_failure(
            f"summary.json status must be completed for patch review: {summary.get('status')!r}",
            payload,
        )
    if result.get("status") != "completed":
        check_patch_failure(
            f"result.json status must be completed for patch review: {result.get('status')!r}",
            payload,
        )
    if summary.get("role") != "implementer" or result.get("role") != "implementer":
        check_patch_failure("Patch review requires implementer summary.json and result.json artifacts", payload)
    summary_engine = summary.get("engine")
    result_engine = result.get("engine")
    if summary_engine not in ENGINES:
        check_patch_failure(f"summary.json engine must be one of {', '.join(sorted(ENGINES))}", payload)
    if result_engine not in ENGINES:
        check_patch_failure(f"result.json engine must be one of {', '.join(sorted(ENGINES))}", payload)
    if summary_engine != result_engine:
        check_patch_failure("summary.json and result.json engine mismatch", payload)
    payload["engine"] = summary_engine

    expected_output_dir = str(run_dir)
    expected_summary_path = str(summary_path)
    expected_result_path = str(result_path)
    expected_patch_path = str(patch_path)
    require_artifact_value("summary.json", summary, "output_dir", expected_output_dir, payload)
    require_artifact_value("summary.json", summary, "summary_path", expected_summary_path, payload)
    require_artifact_value("summary.json", summary, "result_path", expected_result_path, payload)
    require_artifact_value("summary.json", summary, "patch_path", expected_patch_path, payload)
    require_artifact_value("result.json", result, "output_dir", expected_output_dir, payload)
    require_artifact_value("result.json", result, "summary_path", expected_summary_path, payload)
    require_artifact_value("result.json", result, "patch_path", expected_patch_path, payload)

    if not payload["patch_exists"]:
        check_patch_failure(f"Missing patch.diff artifact: {patch_path}", payload)
    resolved_patch = patch_path.resolve(strict=True)
    if not is_relative_to(resolved_patch, runtime_root(root)):
        check_patch_failure(f"patch.diff resolved outside runtime root: {resolved_patch}", payload)

    summary_touched = summary.get("touched_paths")
    result_touched = result.get("touched_paths")
    if summary_touched is not None and result_touched is not None and summary_touched != result_touched:
        check_patch_failure("summary.json and result.json touched_paths mismatch", payload)
    if summary_touched is not None and not isinstance(summary_touched, list):
        check_patch_failure("summary.json touched_paths must be an array", payload)
    if result_touched is not None and not isinstance(result_touched, list):
        check_patch_failure("result.json touched_paths must be an array", payload)
    touched_paths = summary_touched or result_touched or touched_paths_from_patch(patch_path.read_text())
    payload["touched_paths"] = touched_paths

    return payload, patch_path


def check_patch(root: pathlib.Path, value: str) -> dict[str, Any]:
    payload, patch_path = validate_patch_artifact(root, value)
    passed, apply_output = run_git_apply_check(root, patch_path)
    if not passed:
        payload["apply_check"] = "fail"
        if apply_output:
            payload["apply_check_output"] = apply_output
        check_patch_failure(f"git apply --check failed for {patch_path}", payload)

    return {
        **payload,
        "status": "success",
        "apply_check": "pass",
        "suggested_next": (
            "After explicit checkout-mutation approval, apply with: "
            f"{suggested_apply_command(patch_path)}"
        ),
    }


def apply_patch_artifact(root: pathlib.Path, value: str) -> dict[str, Any]:
    payload, patch_path = validate_patch_artifact(root, value)
    git_status_before = require_git_status_porcelain(root)
    payload["git_status_before"] = git_status_before
    payload["git_status_clean"] = git_status_before == []
    if git_status_before:
        check_patch_failure("Worktree must be clean before applying patch artifact", payload)

    passed, apply_output = run_git_apply_check(root, patch_path)
    if not passed:
        payload["apply_check"] = "fail"
        if apply_output:
            payload["apply_check_output"] = apply_output
        check_patch_failure(f"git apply --check failed for {patch_path}", payload)

    applied, git_apply_output = run_git_apply(root, patch_path)
    if not applied:
        payload["apply_check"] = "pass"
        payload["applied"] = False
        if git_apply_output:
            payload["git_apply_output"] = git_apply_output
        check_patch_failure(f"git apply failed for {patch_path}", payload)

    git_status_after = require_git_status_porcelain(root)
    result = {
        **payload,
        "status": "success",
        "apply_check": "pass",
        "applied": True,
        "git_status_before": git_status_before,
        "git_status_after": git_status_after,
        "suggested_next": None,
    }
    if git_apply_output:
        result["git_apply_output"] = git_apply_output
    return result


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


def openai_agents_sdk_status() -> dict[str, Any]:
    os.environ["OPENAI_AGENTS_DISABLE_TRACING"] = "1"
    try:
        import agents
    except ModuleNotFoundError as exc:
        return {
            "available": False,
            "module": "agents",
            "error": str(exc),
            "install_policy": "Use a repo-local or caller-provided Python environment; the runner never installs dependencies.",
        }
    agent_cls = getattr(agents, "Agent", None)
    runner_cls = getattr(agents, "Runner", None)
    run_sync = getattr(runner_cls, "run_sync", None)
    return {
        "available": callable(agent_cls) and callable(run_sync),
        "module": "agents",
        "agent_class": callable(agent_cls),
        "runner_run_sync": callable(run_sync),
        "install_policy": "AOS-owned runner dependency supplied by the caller environment; native-codex diagnostic planning/readback and check/apply gates do not require it.",
    }


def provider_model_settings(sdk: Any, spec: AgentSpec) -> Any | None:
    if not spec.model_reasoning_effort:
        return None
    model_settings_cls = getattr(sdk, "ModelSettings", None)
    if not callable(model_settings_cls):
        raise RunnerError("OpenAI Agents SDK does not expose ModelSettings for role reasoning effort")
    try:
        from openai.types.shared import Reasoning
    except (ImportError, ModuleNotFoundError) as exc:
        raise RunnerError("OpenAI Agents SDK reasoning effort requires openai.types.shared.Reasoning") from exc
    return model_settings_cls(reasoning=Reasoning(effort=spec.model_reasoning_effort))


def native_spawn_contract(spec: AgentSpec, task: str) -> dict[str, Any]:
    label = f"{spec.name}-{task_hash(task)}"
    return {
        "tool": "spawn_agent",
        "tool_contract": "multi_agent_v2",
        "blocked_if_only_multi_agent_v1": True,
        "arguments": {
            "task_name": label,
            "agent_type": spec.name,
            "fork_turns": "none",
            "message": task,
        },
        "role_model": {
            "model": spec.model,
            "model_reasoning_effort": spec.model_reasoning_effort,
            "sandbox_mode": spec.sandbox_mode,
        },
        "provider_side_checkout_mutation": False,
    }


def runtime_info(root: pathlib.Path) -> dict[str, Any]:
    specs = {
        role: load_agent_spec(root / ".codex" / "agents" / f"{role}.toml", allowed_roles=ARTIFACT_ROLES, require_read_only_sandbox=False)
        for role in sorted(ARTIFACT_ROLES)
        if (root / ".codex" / "agents" / f"{role}.toml").is_file()
    }
    active_profile = load_active_profile(root)
    return {
        "status": "success",
        "runtime": "aos-agents",
        "engines": {
            ENGINE_NATIVE_CODEX: {
                "default": False,
                "execution_owner": "native Codex session tool runtime (explicit diagnostic/import lane only)",
                "local_process_can_execute": False,
                "dispatch_contract": "spawn_agent(task_name=<short_task_id>, agent_type=<role>, fork_turns=\"none\", message=<task>)",
            },
            ENGINE_PROVIDER_SDK: {
                "default": True,
                "execution_owner": "AOS-owned local OpenAI Agents SDK adapter",
                "local_process_can_execute": True,
                "dependency": openai_agents_sdk_status(),
            },
        },
        "runtime_root": str(runtime_root(root)),
        "runtime_root_policy": "Repo-mode dev artifacts only under .runtime/dev/aos-agents; ignored runtime state is not a published dependency surface.",
        "active_profile": active_profile.active_profile,
        "roles": {
            name: {
                "agent_spec": str(spec.path.relative_to(root)),
                "model": spec.model,
                "model_reasoning_effort": spec.model_reasoning_effort,
                "sandbox_mode": spec.sandbox_mode,
                "default_execution": "read-only provider execution" if name in READ_ONLY_ROLES else "patch artifact only",
            }
            for name, spec in sorted(specs.items())
        },
    }


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


def render_context_files(context_files: tuple[IncludedContextFile, ...]) -> str | None:
    if not context_files:
        return None
    blocks = [
        "# Source Context",
        "The following repo files are read-only source context. Generate the unified diff against this exact content.",
    ]
    for context_file in context_files:
        truncated = " (truncated)" if context_file.truncated else ""
        blocks.extend(
            [
                f"## {context_file.repo_path}{truncated}",
                f"BEGIN FILE {context_file.repo_path}",
                context_file.text,
                f"END FILE {context_file.repo_path}",
            ]
        )
    return "\n".join(blocks)


def build_patch_output_instructions(
    spec: AgentSpec,
    active_profile: ActiveProfile,
    context_files: tuple[IncludedContextFile, ...] = (),
) -> str:
    base = build_agent_instructions(spec, active_profile)
    sections = [
        base,
        "# Patch-Only Output Contract",
        "This contract overrides any role instruction to include IMPLEMENTER DONE, summaries, or file-change "
        "prose. Return a true unified diff only. Your final answer must start with "
        "`diff --git a/... b/...`, include `--- a/...`, include `+++ b/...`, and include `@@` hunks.",
        "Do not edit files, run commands, apply patches, mutate git, mutate GitHub, install dependencies, "
        "or change runtime state. The runner will save your final answer as patch.diff for external review; "
        "patch application is never automatic.",
        "Never output an apply_patch envelope or patch-tool syntax: no `*** Begin Patch`, no "
        "`*** Update File`, and no `apply_patch`. Do not include prose before or after the diff. "
        "Do not wrap the diff in Markdown fences.",
    ]
    context = render_context_files(context_files)
    if context is not None:
        sections.append(context)
    return "\n\n".join(sections)


def execute_provider_run(
    sdk: Any,
    spec: AgentSpec,
    active_profile: ActiveProfile,
    task: str,
    max_turns: int,
    *,
    patch_output: bool = False,
    context_files: tuple[IncludedContextFile, ...] = (),
) -> dict[str, Any]:
    agent_kwargs = {
        "name": spec.name,
        "instructions": (
            build_patch_output_instructions(spec, active_profile, context_files)
            if patch_output
            else build_agent_instructions(spec, active_profile)
        ),
        "model": spec.model or None,
    }
    model_settings = provider_model_settings(sdk, spec)
    if model_settings is not None:
        agent_kwargs["model_settings"] = model_settings
    agent = sdk.Agent(**agent_kwargs)
    result = sdk.Runner.run_sync(agent, task, max_turns=max_turns)
    final_output = getattr(result, "final_output", None)
    if final_output is None:
        final_output = str(result)
    return {
        "final_output": str(final_output),
        "result_type": type(result).__name__,
    }


def git_value(root: pathlib.Path, *args: str) -> str:
    try:
        completed = subprocess.run(
            ("git", *args),
            cwd=root,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return "unknown"
    return completed.stdout.strip() or "unknown"


def extract_patch_text(final_output: str) -> str:
    text = final_output.strip()
    fenced = re.search(r"```(?:diff|patch)?\s*\n(?P<patch>.*?)\n```", text, flags=re.DOTALL)
    if fenced:
        text = fenced.group("patch").strip()
    if not (text.startswith("diff --git ") or text.startswith("--- ")):
        raise RunnerError("Patch-output provider result did not contain a unified diff")
    return text + "\n"


def touched_paths_from_patch(patch_text: str) -> list[str]:
    paths: set[str] = set()
    for line in patch_text.splitlines():
        if line.startswith("diff --git "):
            parts = line.split()
            if len(parts) >= 4:
                for candidate in parts[2:4]:
                    if candidate.startswith(("a/", "b/")) and candidate[2:] != "/dev/null":
                        paths.add(candidate[2:])
        elif line.startswith(("--- a/", "+++ b/")):
            paths.add(line[6:].split("\t", 1)[0])
    return sorted(paths)


def suggested_review_command(patch_path: pathlib.Path) -> str:
    return f"git apply --check {patch_path}"


def suggested_apply_command(patch_path: pathlib.Path) -> str:
    return f"git apply {patch_path}"


def write_json(path: pathlib.Path, data: dict[str, Any]) -> None:
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")


def native_dispatch_doc(
    root: pathlib.Path,
    *,
    status: str,
    role: str,
    task: str,
    planned_dir: pathlib.Path,
    summary_path: pathlib.Path,
    base_commit: str,
    target_branch: str,
    native_contract: dict[str, Any],
    patch_output: bool = False,
    context_files: list[str] | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    if status not in {"ready", "blocked"}:
        raise RunnerError(f"Native dispatch artifact status must be ready or blocked, observed {status!r}")
    doc: dict[str, Any] = {
        "schema_version": 1,
        "status": status,
        "engine": ENGINE_NATIVE_CODEX,
        "role": role,
        "task_hash": task_hash(task),
        "base_commit": base_commit,
        "target_branch": target_branch,
        "output_dir": str(planned_dir),
        "summary_path": str(summary_path),
        "native_dispatch_path": str(planned_dir / NATIVE_DISPATCH_ARTIFACT),
        "native_spawn_contract": native_contract,
        "patch_output": patch_output,
        "provider_side_checkout_mutation": False,
        "completion_command": (
            f"./aos dev agents --complete-native-run {planned_dir} "
            "--result-file <json-result> --json"
        ),
    }
    if context_files:
        doc["context_files"] = context_files
    if error is not None:
        doc["error"] = error
    return doc


def write_native_dispatch(
    root: pathlib.Path,
    *,
    status: str,
    role: str,
    task: str,
    planned_dir: pathlib.Path,
    summary_path: pathlib.Path,
    base_commit: str,
    target_branch: str,
    native_contract: dict[str, Any],
    patch_output: bool = False,
    context_files: list[str] | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    dispatch = native_dispatch_doc(
        root,
        status=status,
        role=role,
        task=task,
        planned_dir=planned_dir,
        summary_path=summary_path,
        base_commit=base_commit,
        target_branch=target_branch,
        native_contract=native_contract,
        patch_output=patch_output,
        context_files=context_files,
        error=error,
    )
    write_json(planned_dir / NATIVE_DISPATCH_ARTIFACT, dispatch)
    return dispatch


def require_native_identity(summary: dict[str, Any], dispatch: dict[str, Any], run_dir: pathlib.Path) -> None:
    expected_output_dir = str(run_dir)
    expected_summary_path = str(run_dir / "summary.json")
    expected_dispatch_path = str(run_dir / NATIVE_DISPATCH_ARTIFACT)
    for artifact_name, doc in (("summary.json", summary), (NATIVE_DISPATCH_ARTIFACT, dispatch)):
        if doc.get("engine") != ENGINE_NATIVE_CODEX:
            raise RunnerError(f"{artifact_name} engine must be native-codex")
        if doc.get("output_dir") != expected_output_dir:
            raise RunnerError(f"{artifact_name} output_dir mismatch: expected {expected_output_dir}, observed {doc.get('output_dir')!r}")
        if doc.get("summary_path") != expected_summary_path:
            raise RunnerError(f"{artifact_name} summary_path mismatch: expected {expected_summary_path}, observed {doc.get('summary_path')!r}")
        if doc.get("native_dispatch_path") != expected_dispatch_path:
            raise RunnerError(f"{artifact_name} native_dispatch_path mismatch: expected {expected_dispatch_path}, observed {doc.get('native_dispatch_path')!r}")
    for key in ("role", "task_hash", "base_commit", "target_branch"):
        if summary.get(key) != dispatch.get(key):
            raise RunnerError(f"Native run identity mismatch for {key}: summary={summary.get(key)!r} dispatch={dispatch.get(key)!r}")
    if summary.get("native_spawn_contract") != dispatch.get("native_spawn_contract"):
        raise RunnerError("Native run identity mismatch for native_spawn_contract")


def native_dispatch(root: pathlib.Path, value: str) -> dict[str, Any]:
    run_dir = resolve_run_dir(root, value)
    summary = load_json_file(run_dir / "summary.json")
    dispatch = load_json_file(run_dir / NATIVE_DISPATCH_ARTIFACT)
    require_native_identity(summary, dispatch, run_dir)
    if summary.get("status") not in {"ready", "blocked"}:
        raise RunnerError(f"--native-dispatch requires a ready or blocked native run, observed {summary.get('status')!r}")
    return {
        "status": "success",
        "output_dir": str(run_dir),
        "summary_path": str(run_dir / "summary.json"),
        "native_dispatch_path": str(run_dir / NATIVE_DISPATCH_ARTIFACT),
        "summary": summary,
        "native_dispatch": dispatch,
        "native_spawn_contract": dispatch["native_spawn_contract"],
        "run_metadata": {
            "engine": ENGINE_NATIVE_CODEX,
            "role": dispatch["role"],
            "task_hash": dispatch["task_hash"],
            "base_commit": dispatch["base_commit"],
            "target_branch": dispatch["target_branch"],
            "output_dir": str(run_dir),
            "patch_output": dispatch.get("patch_output") is True,
        },
    }


def load_native_result_file(path_value: str) -> tuple[dict[str, Any], str]:
    path = pathlib.Path(path_value).expanduser()
    if not path.is_file():
        raise RunnerError(f"--result-file is not a file: {path}")
    raw = path.read_text()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RunnerError("--result-file must be a JSON object with native identity fields") from exc
    if not isinstance(parsed, dict):
        raise RunnerError("--result-file must be a JSON object")
    output_keys = ("final_output", "result", "text")
    output_key = next((key for key in output_keys if key in parsed), None)
    if output_key is None:
        raise RunnerError("--result-file must include one of final_output, result, or text")
    final_output = parsed[output_key]
    if not isinstance(final_output, str):
        raise RunnerError("--result-file final_output/result/text must be a string")
    return parsed, final_output


def validate_imported_native_identity(imported: dict[str, Any], dispatch: dict[str, Any]) -> None:
    missing = [key for key in ("engine", "role", "task_hash", "output_dir") if key not in imported]
    if missing:
        raise RunnerError(f"Native JSON result is missing identity fields: {', '.join(missing)}")
    for key in ("engine", "role", "task_hash", "output_dir"):
        expected = ENGINE_NATIVE_CODEX if key == "engine" else dispatch[key]
        if imported.get(key) != expected:
            raise RunnerError(
                f"Native result identity mismatch for {key}: expected {expected}, observed {imported.get(key)!r}"
            )


def complete_native_run(root: pathlib.Path, value: str, result_file: str) -> dict[str, Any]:
    run_dir = resolve_run_dir(root, value)
    summary_path = run_dir / "summary.json"
    result_path = run_dir / "result.json"
    patch_path = run_dir / "patch.diff"
    summary = load_json_file(summary_path)
    dispatch = load_json_file(run_dir / NATIVE_DISPATCH_ARTIFACT)
    require_native_identity(summary, dispatch, run_dir)
    if summary.get("status") not in {"ready", "blocked"}:
        raise RunnerError(f"--complete-native-run requires a ready or blocked native run, observed {summary.get('status')!r}")
    imported, final_output = load_native_result_file(result_file)
    validate_imported_native_identity(imported, dispatch)
    role = dispatch["role"]
    patch_output = dispatch.get("patch_output") is True
    if role == "implementer" and not patch_output:
        raise RunnerError("Native implementer completion requires a planned patch-output run")
    if role != "implementer" and patch_output:
        raise RunnerError("Native patch-output completion requires role implementer")

    if result_path.exists():
        if result_path.is_file() or result_path.is_symlink():
            result_path.unlink()
        else:
            raise RunnerError(f"Refusing to replace non-file result path: {result_path}")
    if patch_path.exists():
        if patch_path.is_file() or patch_path.is_symlink():
            patch_path.unlink()
        else:
            raise RunnerError(f"Refusing to replace non-file patch path: {patch_path}")

    touched_paths = None
    patch_text = None
    if patch_output:
        patch_text = extract_patch_text(final_output)
        patch_path.write_text(patch_text)
        touched_paths = touched_paths_from_patch(patch_text)

    role_name = str(role)
    spec_path = root / ".codex" / "agents" / f"{role_name}.toml"
    spec = load_agent_spec(
        spec_path,
        allowed_roles=ARTIFACT_ROLES,
        require_read_only_sandbox=role_name in READ_ONLY_ROLES,
    )
    active_profile = load_active_profile(root)
    completed_summary = summary_doc(
        "completed",
        root,
        role_name,
        spec,
        active_profile,
        final_output,
        run_dir,
        True,
        int(summary.get("max_turns", 1)),
        ENGINE_NATIVE_CODEX,
        result_path,
        base_commit=dispatch["base_commit"],
        target_branch=dispatch["target_branch"],
        patch_path=patch_path if patch_output else None,
        touched_paths=touched_paths,
        context_files=dispatch.get("context_files"),
        suggested_review_command_value=suggested_review_command(patch_path) if patch_output else None,
        suggested_apply_command_value=suggested_apply_command(patch_path) if patch_output else None,
        native_spawn_contract_value=dispatch["native_spawn_contract"],
        native_dispatch_path=run_dir / NATIVE_DISPATCH_ARTIFACT,
    )
    completed_summary["task_hash"] = dispatch["task_hash"]
    result_doc = {
        "schema_version": 1,
        "status": "completed",
        "engine": ENGINE_NATIVE_CODEX,
        "role": role_name,
        "agent_spec": summary["agent_spec"],
        "active_profile": summary["active_profile"],
        "base_commit": dispatch["base_commit"],
        "target_branch": dispatch["target_branch"],
        "task_hash": dispatch["task_hash"],
        "max_turns": int(summary.get("max_turns", 1)),
        "output_dir": str(run_dir),
        "summary_path": str(summary_path),
        "native_dispatch_path": str(run_dir / NATIVE_DISPATCH_ARTIFACT),
        "final_output": final_output,
        "imported_result_format": "json",
    }
    if patch_output:
        result_doc["patch_path"] = str(patch_path)
        result_doc["touched_paths"] = touched_paths
        result_doc["suggested_review_command"] = suggested_review_command(patch_path)
        result_doc["suggested_apply_command"] = suggested_apply_command(patch_path)
    if dispatch.get("context_files"):
        result_doc["context_files"] = dispatch["context_files"]
    write_json(result_path, result_doc)
    write_json(summary_path, completed_summary)
    return {
        "status": "completed",
        "engine": ENGINE_NATIVE_CODEX,
        "role": role_name,
        "task_hash": dispatch["task_hash"],
        "output_dir": str(run_dir),
        "summary_path": str(summary_path),
        "result_path": str(result_path),
        **(
            {
                "patch_path": str(patch_path),
                "touched_paths": touched_paths,
                "suggested_review_command": suggested_review_command(patch_path),
                "suggested_apply_command": suggested_apply_command(patch_path),
            }
            if patch_output
            else {}
        ),
    }


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
    engine: str,
    result_path: pathlib.Path | None = None,
    error: str | None = None,
    base_commit: str | None = None,
    target_branch: str | None = None,
    patch_path: pathlib.Path | None = None,
    touched_paths: list[str] | None = None,
    context_files: list[str] | None = None,
    suggested_review_command_value: str | None = None,
    suggested_apply_command_value: str | None = None,
    native_spawn_contract_value: dict[str, Any] | None = None,
    native_dispatch_path: pathlib.Path | None = None,
) -> dict[str, Any]:
    if status not in SUMMARY_STATUSES:
        allowed = ", ".join(sorted(SUMMARY_STATUSES))
        raise RunnerError(f"Invalid summary status {status!r}; expected one of: {allowed}")
    if status == "ready" and execute:
        raise RunnerError("Ready summary must not be marked as execute")
    if status in {"completed", "blocked", "error"} and not execute:
        raise RunnerError(f"Summary status {status!r} requires execute")
    if status == "completed" and result_path is None:
        raise RunnerError("Completed summary requires result_path")
    if status == "ready" and result_path is not None:
        raise RunnerError("Ready summary must not include result_path")
    if status == "error" and not error:
        raise RunnerError("Error summary requires an error message")
    if status == "blocked" and not error:
        raise RunnerError("Blocked summary requires an error message")
    if status not in {"blocked", "error"} and error is not None:
        raise RunnerError(f"Summary status {status!r} must not include an error message")
    if engine not in ENGINES:
        raise RunnerError(f"Invalid summary engine {engine!r}")

    doc: dict[str, Any] = {
        "schema_version": 1,
        "status": status,
        "engine": engine,
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
    if base_commit is not None:
        doc["base_commit"] = base_commit
    if target_branch is not None:
        doc["target_branch"] = target_branch
    if patch_path is not None:
        doc["patch_path"] = str(patch_path)
    if touched_paths is not None:
        doc["touched_paths"] = touched_paths
    if context_files is not None:
        doc["context_files"] = context_files
    if suggested_review_command_value is not None:
        doc["suggested_review_command"] = suggested_review_command_value
    if suggested_apply_command_value is not None:
        doc["suggested_apply_command"] = suggested_apply_command_value
    if native_spawn_contract_value is not None:
        doc["native_spawn_contract"] = native_spawn_contract_value
    if native_dispatch_path is not None:
        doc["native_dispatch_path"] = str(native_dispatch_path)
    return doc


def render_summary(root: pathlib.Path, specs: dict[str, AgentSpec], active_profile: ActiveProfile) -> dict[str, Any]:
    sample_task = "self test path behavior"
    return {
        "repo_root": str(root),
        "runtime_root": str(root / RUNTIME_ROOT),
        "default_engine": DEFAULT_ENGINE,
        "engines": sorted(ENGINES),
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
    patch_dir = output_dir(root, "implementer", "patch output path", patch_output=True)
    if not is_relative_to(patch_dir, runtime_root(root)):
        raise RunnerError("Patch-output directory planning escaped runtime root")

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
            ENGINE_NATIVE_CODEX,
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
    explicit_flags = tuple(getattr(args, "explicit_flags", ()))
    artifact_modes = sum(
        bool(item)
        for item in (
            args.list_runs,
            args.read_run,
            args.check_patch,
            args.apply_patch,
            args.native_dispatch,
            args.complete_native_run,
        )
    )
    if args.runtime_info:
        allowed_flags = {"--runtime-info", "--repo-root", "--repo", "--json"}
        blocked_flags = [flag for flag in explicit_flags if flag not in allowed_flags]
        if blocked_flags:
            raise RunnerError("--runtime-info cannot be combined with " + ", ".join(blocked_flags))
        return runtime_info(root)

    engine = normalize_engine(args.engine)
    if artifact_modes > 1:
        raise RunnerError(
            "--list-runs, --read-run, --check-patch, --apply-patch, --native-dispatch, "
            "and --complete-native-run are mutually exclusive"
        )
    if args.i_approve_checkout_mutation and not args.apply_patch:
        raise RunnerError("--i-approve-checkout-mutation is only enabled with --apply-patch")
    if args.result_file and not args.complete_native_run:
        raise RunnerError("--result-file is only enabled with --complete-native-run")
    if args.self_test:
        if artifact_modes:
            raise RunnerError("--self-test cannot be combined with artifact readback")
        return self_test(root)
    if args.list_runs:
        return list_runs(root, args.role)
    if args.read_run:
        return read_run(root, args.read_run)
    if args.native_dispatch:
        if args.role or args.task or args.execute or args.patch_output or args.context_file:
            raise RunnerError("--native-dispatch cannot be combined with role/task/execution options")
        return native_dispatch(root, args.native_dispatch)
    if args.complete_native_run:
        if args.role or args.task or args.execute or args.patch_output or args.context_file:
            raise RunnerError("--complete-native-run cannot be combined with role/task/execution options")
        if not args.result_file:
            raise RunnerError("--complete-native-run requires --result-file")
        return complete_native_run(root, args.complete_native_run, args.result_file)
    if args.check_patch:
        if args.role or args.task or args.execute or args.patch_output or args.context_file:
            raise RunnerError("--check-patch cannot be combined with role/task/provider execution options")
        return check_patch(root, args.check_patch)
    if args.apply_patch:
        if args.role or args.task or args.execute or args.patch_output or args.context_file:
            raise RunnerError("--apply-patch cannot be combined with role/task/provider execution options")
        if not args.i_approve_checkout_mutation:
            raise RunnerError("--apply-patch requires --i-approve-checkout-mutation")
        return apply_patch_artifact(root, args.apply_patch)

    role = args.role or "explorer"
    if args.context_file and not args.patch_output:
        raise RunnerError("--context-file is only enabled with --patch-output")
    if args.patch_output:
        spec = load_patch_output_spec(root, role)
    else:
        specs = load_agent_specs(root)
        if role not in specs:
            raise RunnerError(f"Role {role!r} is not enabled. Allowed roles: {', '.join(sorted(specs))}")
        spec = specs[role]
    if not args.task:
        raise RunnerError("--task is required outside --self-test")
    if args.max_turns < 1:
        raise RunnerError("--max-turns must be at least 1")

    active_profile = load_active_profile(root)
    context_files = load_context_files(root, args.context_file)
    context_file_paths = [context_file.repo_path for context_file in context_files]
    planned_dir = output_dir(root, role, args.task, patch_output=args.patch_output)

    summary_path = planned_dir / "summary.json"
    base_commit = git_value(root, "rev-parse", "HEAD")
    target_branch = git_value(root, "branch", "--show-current")
    native_contract = native_spawn_contract(spec, args.task) if engine == ENGINE_NATIVE_CODEX else None
    base_result = {
        "status": "ready",
        "engine": engine,
        "message": "Provider execution is available with --execute.",
        "role": role,
        "agent_spec": str(spec.path.relative_to(root)),
        "active_profile": active_profile.active_profile,
        "base_commit": base_commit,
        "target_branch": target_branch,
        "output_dir": str(planned_dir),
        "summary_path": str(summary_path),
    }
    if context_file_paths:
        base_result["context_files"] = context_file_paths
    if native_contract is not None:
        base_result["message"] = "Native Codex dispatch contract is ready for native session execution."
        base_result["native_spawn_contract"] = native_contract
        base_result["native_dispatch_path"] = str(planned_dir / NATIVE_DISPATCH_ARTIFACT)
    if not args.execute:
        planned_dir.mkdir(parents=True, exist_ok=True)
        native_dispatch_value = None
        if native_contract is not None:
            native_dispatch_value = write_native_dispatch(
                root,
                status="ready",
                role=role,
                task=args.task,
                planned_dir=planned_dir,
                summary_path=summary_path,
                base_commit=base_commit,
                target_branch=target_branch,
                native_contract=native_contract,
                patch_output=args.patch_output,
                context_files=context_file_paths or None,
            )
        write_json(
            summary_path,
            summary_doc(
                "ready",
                root,
                role,
                spec,
                active_profile,
                args.task,
                planned_dir,
                False,
                args.max_turns,
                engine,
                base_commit=base_commit,
                target_branch=target_branch,
                context_files=context_file_paths or None,
                native_spawn_contract_value=native_contract,
                native_dispatch_path=(planned_dir / NATIVE_DISPATCH_ARTIFACT) if native_contract else None,
            ),
        )
        if native_dispatch_value is not None:
            base_result["native_dispatch"] = native_dispatch_value
        return base_result

    if engine == ENGINE_NATIVE_CODEX:
        planned_dir.mkdir(parents=True, exist_ok=True)
        blocked_message = (
            "Native Codex execution is owned by the native session tool runtime and cannot be launched from the local "
            "./aos dev agents process. Use --native-dispatch on this output_dir, execute the "
            "spawn_agent v2 contract in a Codex session, then import the result with --complete-native-run."
        )
        native_dispatch_value = write_native_dispatch(
            root,
            status="blocked",
            role=role,
            task=args.task,
            planned_dir=planned_dir,
            summary_path=summary_path,
            base_commit=base_commit,
            target_branch=target_branch,
            native_contract=native_contract,
            patch_output=args.patch_output,
            context_files=context_file_paths or None,
            error=blocked_message,
        )
        blocked_summary = summary_doc(
            "blocked",
            root,
            role,
            spec,
            active_profile,
            args.task,
            planned_dir,
            True,
            args.max_turns,
            engine,
            error=blocked_message,
            base_commit=base_commit,
            target_branch=target_branch,
            context_files=context_file_paths or None,
            native_spawn_contract_value=native_contract,
            native_dispatch_path=planned_dir / NATIVE_DISPATCH_ARTIFACT,
        )
        write_json(summary_path, blocked_summary)
        blocked_summary["native_dispatch"] = native_dispatch_value
        raise NativeExecutionBlocked(blocked_message, blocked_summary)

    sdk = require_openai_agents_sdk()
    planned_dir.mkdir(parents=True, exist_ok=True)

    result_path = planned_dir / "result.json"
    patch_path = planned_dir / "patch.diff"
    if result_path.exists():
        if result_path.is_file() or result_path.is_symlink():
            result_path.unlink()
        else:
            raise RunnerError(f"Refusing to replace non-file result path: {result_path}")
    if args.patch_output and patch_path.exists():
        if patch_path.is_file() or patch_path.is_symlink():
            patch_path.unlink()
        else:
            raise RunnerError(f"Refusing to replace non-file patch path: {patch_path}")
    provider_result: dict[str, Any] | None = None
    try:
        provider_result = execute_provider_run(
            sdk,
            spec,
            active_profile,
            args.task,
            args.max_turns,
            patch_output=args.patch_output,
            context_files=context_files,
        )
        patch_text = extract_patch_text(provider_result["final_output"]) if args.patch_output else None
    except Exception as exc:
        error_message = f"Provider execution failed: {exc}"
        diagnostic_result_path = None
        if args.patch_output and provider_result is not None:
            diagnostic_result_path = result_path
            write_json(
                result_path,
                {
                    "status": "error",
                    "engine": engine,
                    "role": role,
                    "agent_spec": str(spec.path.relative_to(root)),
                    "active_profile": active_profile.active_profile,
                    "base_commit": base_commit,
                    "target_branch": target_branch,
                    "task_hash": task_hash(args.task),
                    "max_turns": args.max_turns,
                    "output_dir": str(planned_dir),
                    "summary_path": str(summary_path),
                    "error": error_message,
                    "extraction_error": str(exc),
                    "raw_final_output": provider_result["final_output"],
                    "result_type": provider_result.get("result_type"),
                    **({"context_files": context_file_paths} if context_file_paths else {}),
                },
            )
        write_json(
            summary_path,
            summary_doc(
                "error",
                root,
                role,
                spec,
                active_profile,
                args.task,
                planned_dir,
                True,
                args.max_turns,
                engine,
                diagnostic_result_path,
                error=error_message,
                base_commit=base_commit,
                target_branch=target_branch,
                context_files=context_file_paths or None,
            ),
        )
        raise RunnerError(error_message) from exc

    touched_paths = touched_paths_from_patch(patch_text) if patch_text is not None else None
    if patch_text is not None:
        patch_path.write_text(patch_text)
    summary = summary_doc(
        "completed",
        root,
        role,
        spec,
        active_profile,
        args.task,
        planned_dir,
        True,
        args.max_turns,
        engine,
        result_path,
        base_commit=base_commit,
        target_branch=target_branch,
        patch_path=patch_path if args.patch_output else None,
        touched_paths=touched_paths,
        context_files=context_file_paths or None,
        suggested_review_command_value=suggested_review_command(patch_path) if args.patch_output else None,
        suggested_apply_command_value=suggested_apply_command(patch_path) if args.patch_output else None,
    )
    result_doc = {
        "status": "completed",
        "engine": engine,
        "role": role,
        "agent_spec": str(spec.path.relative_to(root)),
        "active_profile": active_profile.active_profile,
        "base_commit": base_commit,
        "target_branch": target_branch,
        "task_hash": task_hash(args.task),
        "max_turns": args.max_turns,
        "output_dir": str(planned_dir),
        "summary_path": str(summary_path),
        **provider_result,
    }
    if args.patch_output:
        result_doc["patch_path"] = str(patch_path)
        result_doc["touched_paths"] = touched_paths
        result_doc["suggested_review_command"] = suggested_review_command(patch_path)
        result_doc["suggested_apply_command"] = suggested_apply_command(patch_path)
    if context_file_paths:
        result_doc["context_files"] = context_file_paths
    write_json(result_path, result_doc)
    write_json(summary_path, summary)
    return {
        **base_result,
        "status": "completed",
        "message": "Provider execution completed.",
        "result_path": str(result_path),
        **(
            {
                "patch_path": str(patch_path),
                "touched_paths": touched_paths,
                "suggested_review_command": suggested_review_command(patch_path),
                "suggested_apply_command": suggested_apply_command(patch_path),
                **({"context_files": context_file_paths} if context_file_paths else {}),
            }
            if args.patch_output
            else {}
        ),
        **provider_result,
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="AOS-owned agent runtime contract and artifact gate")
    parser.add_argument("--repo-root", "--repo", dest="repo_root", help="Repo root override. Defaults to walking up from cwd.")
    parser.add_argument("--self-test", action="store_true", help="Validate parsing and path behavior without API calls.")
    parser.add_argument("--runtime-info", action="store_true", help="Report native/provider runtime contract and dependency status without executing agents.")
    parser.add_argument("--list-runs", action="store_true", help="List existing runtime summaries without SDK or provider calls.")
    parser.add_argument("--read-run", help="Read summary.json and result.json for an output_dir under the runtime root.")
    parser.add_argument("--native-dispatch", help="Read a ready or blocked native-codex run and emit the native spawn contract.")
    parser.add_argument("--complete-native-run", help="Import a native child result into a planned native output_dir.")
    parser.add_argument("--result-file", help="JSON result file for --complete-native-run.")
    parser.add_argument("--check-patch", help="Validate an implementer patch-output run and run git apply --check without applying it.")
    parser.add_argument("--apply-patch", help="Apply an existing implementer patch-output run after explicit checkout-mutation approval.")
    parser.add_argument("--i-approve-checkout-mutation", action="store_true", help="Required approval for --apply-patch to mutate the checkout.")
    parser.add_argument(
        "--engine",
        default=DEFAULT_ENGINE,
        help="Agent engine: provider-sdk (default AOS-owned runner) or native-codex (explicit diagnostic/import lane).",
    )
    parser.add_argument("--role", help="Read-only role to plan/run or filter --list-runs.")
    parser.add_argument("--task", help="Task text for path planning and explicit execution.")
    parser.add_argument("--execute", action="store_true", help="Execute the selected engine after validation. provider-sdk is the only local executable engine.")
    parser.add_argument("--patch-output", action="store_true", help="Allow implementer to produce patch.diff artifacts only; provider-sdk requires --execute, native-codex uses explicit dispatch/import.")
    parser.add_argument("--context-file", action="append", help="Repo-relative file to include as bounded source context for --patch-output.")
    parser.add_argument("--max-turns", type=int, default=1, help="Maximum provider turns for --execute. Defaults to 1.")
    parser.add_argument("--json", action="store_true", help="Accepted for ./aos dev command-surface consistency.")
    parsed = parser.parse_args(argv)
    explicit_flags: list[str] = []
    for token in argv:
        if not token.startswith("--") or token == "--":
            continue
        flag = token.split("=", 1)[0]
        if flag not in explicit_flags:
            explicit_flags.append(flag)
    parsed.explicit_flags = tuple(explicit_flags)
    return parsed


def main(argv: list[str]) -> int:
    try:
        result = run(parse_args(argv))
    except NativeExecutionBlocked as exc:
        print(json.dumps({"status": "blocked", "error": str(exc), "summary": exc.summary}, indent=2, sort_keys=True), file=sys.stderr)
        return 1
    except PatchArtifactError as exc:
        print(json.dumps(exc.payload, indent=2, sort_keys=True), file=sys.stderr)
        return 1
    except RunnerError as exc:
        print(json.dumps({"status": "error", "error": str(exc)}, indent=2, sort_keys=True), file=sys.stderr)
        return 1

    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
