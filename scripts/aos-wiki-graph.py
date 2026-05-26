#!/usr/bin/env python3

import json
import os
import pathlib
import sqlite3
import sys

NAMESPACE = "aos"
PAGE_KINDS = {"page", "concept", "entity", "workflow", "reference"}


def fail(message, code):
    print(json.dumps({"code": code, "error": message}, indent=2), file=sys.stderr)
    sys.exit(1)


def runtime_mode():
    return "installed" if os.environ.get("AOS_RUNTIME_MODE") == "installed" else "repo"


def wiki_root():
    return pathlib.Path(os.environ.get("AOS_STATE_ROOT", "~/.config/aos")).expanduser().resolve() / runtime_mode() / "wiki"


def db_path():
    return wiki_root() / "wiki.db"


def parse_args(args):
    options = {"raw": False, "json": False}
    for arg in args:
        if arg == "--raw":
            options["raw"] = True
        elif arg == "--json":
            options["json"] = True
        elif arg.startswith("--"):
            fail(f"Unknown flag: {arg}", "UNKNOWN_FLAG")
        else:
            fail(f"Unknown argument: {arg}", "UNKNOWN_ARG")
    return options


def ensure_schema(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS pages (
            path TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            tags TEXT,
            plugin TEXT,
            modified_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS links (
            source_path TEXT NOT NULL,
            target_path TEXT NOT NULL,
            UNIQUE(source_path, target_path)
        );
        CREATE TABLE IF NOT EXISTS plugins (
            name TEXT PRIMARY KEY,
            version TEXT,
            author TEXT,
            description TEXT,
            triggers TEXT,
            requires TEXT,
            modified_at INTEGER NOT NULL
        );
    """)


def connect():
    root = wiki_root()
    root.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path())
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)
    return conn


def decode_tags(value):
    return json.loads(value) if value else []


def plugin_segment_start(segments):
    if len(segments) >= 3 and segments[0] == NAMESPACE and segments[1] == "plugins":
        return 2
    if len(segments) >= 2 and segments[0] == "plugins":
        return 1
    return None


def entity_segment_start(segments):
    if len(segments) >= 2 and segments[0] == NAMESPACE and segments[1] == "entities":
        return 2
    if segments and segments[0] == "entities":
        return 1
    return None


def concept_segment_start(segments):
    if len(segments) >= 2 and segments[0] == NAMESPACE and segments[1] == "concepts":
        return 2
    if segments and segments[0] == "concepts":
        return 1
    return None


def path_context(relative_path, raw_type):
    segments = relative_path.split("/")
    plugin_start = plugin_segment_start(segments)
    if plugin_start is not None and len(segments) > plugin_start + 1:
        remainder = segments[plugin_start + 1:]
        if remainder == ["SKILL.md"]:
            return {"inferred_type": "workflow", "is_skill": True, "is_reference": False}
        if remainder and remainder[0] == "references":
            return {"inferred_type": raw_type or "concept", "is_skill": False, "is_reference": True}
        return {"inferred_type": raw_type or "concept", "is_skill": False, "is_reference": False}
    if entity_segment_start(segments) is not None:
        return {"inferred_type": "entity", "is_skill": False, "is_reference": False}
    if concept_segment_start(segments) is not None:
        return {"inferred_type": "concept", "is_skill": False, "is_reference": False}
    return {"inferred_type": raw_type or "concept", "is_skill": False, "is_reference": False}


def page_kind(relative_path, raw_type, plugin):
    context = path_context(relative_path, raw_type)
    raw = (raw_type or context["inferred_type"]).strip().lower()
    if context["is_skill"]:
        return "workflow"
    if context["is_reference"]:
        return "reference"
    if relative_path.startswith("sigil/agents/") or raw == "agent":
        return "entity"
    if raw in PAGE_KINDS:
        return raw
    return "page"


def graph_config():
    return {
        "graphView": {
            "controls": {"enabled": True, "collapsed": False},
            "features": {
                "search": True,
                "types": True,
                "tags": True,
                "scope": True,
                "depth": True,
                "labels": True,
                "isolated": True,
                "neighbors": True,
                "path": True,
                "freeze": True,
                "focus": True,
                "fit": True,
                "reset": True,
                "legend": True,
            },
            "defaults": {
                "mode": "global",
                "depth": 2,
                "labelMode": "selection",
                "showIsolated": True,
                "highlightNeighbors": True,
                "frozen": False,
                "activeTypes": [],
                "activeTags": [],
                "searchQuery": "",
                "tagMatchMode": "any",
            },
            "limits": {"minDepth": 1, "maxDepth": 4},
        }
    }


def graph_snapshot(include_raw):
    root = wiki_root()
    conn = connect()
    pages = conn.execute("SELECT path, type, name, description, tags, plugin, modified_at FROM pages ORDER BY name").fetchall()
    links = conn.execute("SELECT source_path, target_path FROM links ORDER BY source_path, target_path").fetchall()
    conn.close()

    raw = {}
    nodes = []
    for page in pages:
        item = dict(page)
        nodes.append({
            "id": item["path"],
            "path": item["path"],
            "type": page_kind(item["path"], item["type"], item["plugin"]),
            "name": item["name"],
            "description": item["description"],
            "tags": decode_tags(item["tags"]),
            "plugin": item["plugin"],
            "modified_at": item["modified_at"],
        })
        if include_raw:
            page_path = root / item["path"]
            if page_path.exists():
                raw[item["path"]] = page_path.read_text(encoding="utf-8")

    return {
        "nodes": nodes,
        "links": [{"source": row["source_path"], "target": row["target_path"]} for row in links],
        "raw": raw,
        "config": graph_config(),
    }


def main():
    options = parse_args(sys.argv[1:])
    print(json.dumps(graph_snapshot(options["raw"]), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
