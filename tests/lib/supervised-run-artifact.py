#!/usr/bin/env python3
"""Small plan-backed artifact helpers for supervised-run shell scenarios."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def render_templates(value: Any, context: dict[str, str]) -> Any:
    if isinstance(value, str):
        rendered = value
        for key, replacement in context.items():
            rendered = rendered.replace("{{" + key + "}}", replacement)
        return rendered
    if isinstance(value, list):
        return [render_templates(item, context) for item in value]
    if isinstance(value, dict):
        return {key: render_templates(item, context) for key, item in value.items()}
    return value


def slug_ref(value: str) -> str:
    return value.replace(":", "-").replace("/", "-")


def load_plan(run_dir: Path) -> dict[str, Any]:
    return load_json(run_dir / "plan.json")


def bridge(run_dir: Path, current_step_path: Path) -> dict[str, str]:
    return {
        "kind": "file_backed",
        "run_dir": str(run_dir),
        "events_jsonl": str(run_dir / "events.jsonl"),
        "current_step_json": str(current_step_path),
        "response_events_jsonl": str(run_dir / "response-events.jsonl"),
        "human_responses_jsonl": str(run_dir / "human-responses.jsonl"),
    }


def base_context(args: argparse.Namespace, run_dir: Path) -> dict[str, str]:
    artifact_dir = run_dir / "artifacts"
    return {
        "run_dir": str(run_dir),
        "artifact_dir": str(artifact_dir),
        "state_root": getattr(args, "state_root", "") or "",
        "toolkit_content_root": getattr(args, "toolkit_content_root", "") or "",
        "console_canvas_id": getattr(args, "console_canvas_id", "") or "",
        "puck_canvas_id": getattr(args, "puck_canvas_id", "") or "",
        "input_method": getattr(args, "input_method", "") or "",
        "human_response_mode": getattr(args, "human_response_mode", "") or "",
    }


def step_by_id(plan: dict[str, Any], step_id: str) -> dict[str, Any]:
    for step in plan.get("steps", []):
        if step.get("id") == step_id:
            return step
    raise SystemExit(f"unknown supervised-run step: {step_id}")


def write_step(args: argparse.Namespace) -> None:
    run_dir = Path(args.run_dir)
    plan = load_plan(run_dir)
    current_step_path = run_dir / "state" / "current-step.json"
    context = base_context(args, run_dir)
    context.update({"current_step_json": str(current_step_path)})

    definition = render_templates(step_by_id(plan, args.step_id), context)
    checks = definition.get("automated_checks", []) if args.checks_ready else []
    step = {
        "id": args.step_id,
        "label": definition["label"],
        "status": args.status,
        "instruction": definition["instruction"],
        "expectation": definition["expectation"],
        "automated_checks": checks,
        "human_request": definition["human_request"],
        "human_response_refs": [args.response_id] if args.response_id else [],
        "metadata": {
            "bridge": bridge(run_dir, current_step_path),
            "canvas_ids": {
                "test_console": args.console_canvas_id,
                "run_puck": args.puck_canvas_id,
            },
            "human_response_mode": args.human_response_mode,
            "input_method": args.input_method,
        },
    }

    if args.status in {"completed", "failed", "blocked"}:
        step["completion"] = {
            "status": args.status,
            "event_ref": definition["completion_event_id"],
            "completed_at": args.completed_at or iso_now(),
            "automated_check_refs": [check["id"] for check in checks],
            "human_response_refs": [args.response_id] if args.response_id else [],
            "evidence_refs": definition["completion_evidence_refs"],
        }

    write_json(current_step_path, step)
    write_json(run_dir / "state" / f"{slug_ref(args.step_id)}.json", step)


def evidence_refs(plan: dict[str, Any], context: dict[str, str]) -> list[dict[str, str]]:
    refs = []
    for entry in render_templates(plan.get("evidence_refs", []), context):
        ref = entry["ref"]
        refs.append(
            {
                "id": entry.get("id", f"evidence-ref:{slug_ref(ref)}"),
                "ref": ref,
                "relationship": entry["relationship"],
                "kind": entry.get("kind", "work_record_evidence_ref"),
                "summary": entry["summary"],
            }
        )
    return refs


def write_discovery(args: argparse.Namespace) -> None:
    run_dir = Path(args.run_dir)
    plan = load_plan(run_dir)
    context = base_context(args, run_dir)
    payload = render_templates(plan["live_equivalent_discovery"], context)
    write_json(run_dir / "artifacts" / "live-equivalent-discovery.json", payload)


def response_id(args: argparse.Namespace) -> None:
    print(load_json(Path(args.response_file))["id"])


def finalize_run(args: argparse.Namespace) -> None:
    run_dir = Path(args.run_dir)
    plan = load_plan(run_dir)
    context = base_context(args, run_dir)
    artifact_dir = run_dir / "artifacts"
    summary_path = run_dir / "summary.json"
    run_path = run_dir / "run.json"
    events_path = run_dir / "events.jsonl"
    responses_path = run_dir / "human-responses.jsonl"
    context.update(
        {
            "run_json": str(run_path),
            "summary_json": str(summary_path),
            "events_jsonl": str(events_path),
            "response_events_jsonl": str(run_dir / "response-events.jsonl"),
            "human_responses_jsonl": str(responses_path),
        }
    )

    events = read_jsonl(events_path)
    responses = read_jsonl(responses_path)
    steps = [load_json(run_dir / "state" / f"{slug_ref(step['id'])}.json") for step in plan.get("steps", [])]
    refs = evidence_refs(plan, context)
    projection = render_templates(plan.get("work_record_projection", {}), context)
    artifacts = render_templates(plan.get("summary_artifacts", {}), context)

    run = {
        "type": "aos.supervised_run",
        "schema_version": "2026-05-supervised-run-v0",
        "id": plan["run_id"],
        "label": plan["label"],
        "created_at": events[0]["at"] if events else iso_now(),
        "status": args.status,
        "operating_path": plan["operating_path"],
        "origin": render_templates(plan.get("origin", {}), context),
        "references": render_templates(plan.get("references", []), context),
        "intent": render_templates(plan["intent"], context),
        "timeline_transport": {
            "kind": "jsonl_file",
            "ordering": "sequence",
            "single_writer": True,
            "path": str(events_path),
            "notes": plan.get("timeline_transport_notes", "Single-writer shell helper appends one supervised-run event per JSONL row."),
        },
        "timeline": events,
        "steps": steps,
        "human_responses": responses,
        "evidence_refs": refs,
        "work_record_projection": projection,
        "metadata": {
            "plan": plan["kind"],
            "plan_file": str(run_dir / "plan.json"),
            "state_root": args.state_root,
            "toolkit_content_root": args.toolkit_content_root,
            "canvas_ids": {
                "test_console": args.console_canvas_id,
                "run_puck": args.puck_canvas_id,
            },
            "human_response_mode": args.human_response_mode,
            "input_method": args.input_method,
            "cleanup_status": args.cleanup_status,
            "live_equivalent": render_templates(plan["live_equivalent_metadata"], context),
        },
    }
    if args.status == "completed" and events:
        run["completed_at"] = events[-1]["at"]
    write_json(run_path, run)

    summary = {
        "id": run["id"],
        "status": args.status,
        "run_dir": str(run_dir),
        "state_root": args.state_root,
        "events_jsonl": str(events_path),
        "response_events_jsonl": str(run_dir / "response-events.jsonl"),
        "human_responses_jsonl": str(responses_path),
        "run_json": str(run_path),
        "summary_json": str(summary_path),
        "input_method": args.input_method,
        "human_response_mode": args.human_response_mode,
        "live_equivalent": run["metadata"]["live_equivalent"],
        "evidence_refs": [entry["ref"] for entry in refs],
        "work_record_projection": projection,
        "artifacts": artifacts,
        "cleanup": {
            "status": args.cleanup_status,
            "show_list_json": str(artifact_dir / "cleanup-show-list.json"),
            "removed_canvas_ids": [args.console_canvas_id, args.puck_canvas_id],
        },
        "manual_follow_up": plan["manual_follow_up"],
    }
    write_json(summary_path, summary)


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser()
    subcommands = root.add_subparsers(dest="command", required=True)

    def add_context(subparser: argparse.ArgumentParser) -> None:
        subparser.add_argument("--run-dir", required=True)
        subparser.add_argument("--console-canvas-id", default="")
        subparser.add_argument("--puck-canvas-id", default="")
        subparser.add_argument("--input-method", default="")
        subparser.add_argument("--human-response-mode", default="")
        subparser.add_argument("--state-root", default="")
        subparser.add_argument("--toolkit-content-root", default="")

    write_step_cmd = subcommands.add_parser("write-step")
    add_context(write_step_cmd)
    write_step_cmd.add_argument("--step-id", required=True)
    write_step_cmd.add_argument("--status", required=True)
    write_step_cmd.add_argument("--checks-ready", action="store_true")
    write_step_cmd.add_argument("--response-id", default="")
    write_step_cmd.add_argument("--completed-at", default="")
    write_step_cmd.set_defaults(func=write_step)

    discovery_cmd = subcommands.add_parser("write-discovery")
    add_context(discovery_cmd)
    discovery_cmd.set_defaults(func=write_discovery)

    response_cmd = subcommands.add_parser("response-id")
    response_cmd.add_argument("--response-file", required=True)
    response_cmd.set_defaults(func=response_id)

    finalize_cmd = subcommands.add_parser("finalize")
    add_context(finalize_cmd)
    finalize_cmd.add_argument("--status", required=True)
    finalize_cmd.add_argument("--cleanup-status", required=True)
    finalize_cmd.set_defaults(func=finalize_run)
    return root


def main() -> None:
    args = parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
