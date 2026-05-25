#!/usr/bin/env python3

import json
import os
import pathlib
import re
import sqlite3
import sys

NAMESPACE = "aos"


def fail(message, code):
    print(json.dumps({"code": code, "error": message}, indent=2), file=sys.stderr)
    sys.exit(1)


def runtime_mode():
    return "installed" if os.environ.get("AOS_RUNTIME_MODE") == "installed" else "repo"


def state_root():
    return pathlib.Path(os.environ.get("AOS_STATE_ROOT", "~/.config/aos")).expanduser().resolve()


def wiki_root():
    return state_root() / runtime_mode() / "wiki"


def db_path():
    return wiki_root() / "wiki.db"


def parse_args(args):
    options = {"json": False}
    for arg in args:
        if arg == "--json":
            options["json"] = True
        elif arg.startswith("--"):
            fail(f"Unknown flag: {arg}", "UNKNOWN_FLAG")
        else:
            fail(f"Unexpected argument: {arg}", "UNKNOWN_ARG")
    return options


def connect():
    root = wiki_root()
    root.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def reset_schema(conn):
    conn.executescript("""
        DROP TABLE IF EXISTS links;
        DROP TABLE IF EXISTS pages;
        DROP TABLE IF EXISTS plugins;
        CREATE TABLE pages (
            path TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            tags TEXT,
            plugin TEXT,
            modified_at INTEGER NOT NULL
        );
        CREATE TABLE links (
            source_path TEXT NOT NULL,
            target_path TEXT NOT NULL,
            UNIQUE(source_path, target_path)
        );
        CREATE INDEX idx_links_source ON links(source_path);
        CREATE INDEX idx_links_target ON links(target_path);
        CREATE TABLE plugins (
            name TEXT PRIMARY KEY,
            version TEXT,
            author TEXT,
            description TEXT,
            triggers TEXT,
            requires TEXT,
            modified_at INTEGER NOT NULL
        );
    """)


def wiki_namespaced_dir(kind):
    return f"{NAMESPACE}/{kind}"


def candidate_dirs(kind):
    root = wiki_root()
    return [rel for rel in [wiki_namespaced_dir(kind), kind] if (root / rel).is_dir()]


def parse_yaml_array(value):
    if not value:
        return []
    trimmed = value.strip()
    if not (trimmed.startswith("[") and trimmed.endswith("]")):
        return [trimmed] if trimmed else []
    inner = trimmed[1:-1]
    return [item.strip().strip("\"'") for item in inner.split(",") if item.strip()]


def clean_description(value):
    if value.startswith(">"):
        return value[1:].strip()
    return value


def parse_frontmatter(content):
    lines = content.split("\n")
    if not lines or lines[0].strip() != "---":
        return {}, content

    closing = None
    for idx, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            closing = idx
            break
    if closing is None:
        return {}, content

    raw = {}
    current_key = None
    current_value = ""
    for line in lines[1:closing]:
        stripped = line.strip()
        if not stripped:
            continue
        if line[:1].isspace() and current_key:
            current_value += " " + stripped
            raw[current_key] = current_value
            continue
        if ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        cleaned = value.strip().strip("\"'")
        raw[key.strip()] = cleaned
        current_key = key.strip()
        current_value = cleaned

    if "description" in raw:
        raw["description"] = clean_description(raw["description"])

    body = "\n".join(lines[closing + 1:]).strip("\n")
    return raw, body


def resolve_relative_path(link, base_dir):
    parts = [] if not base_dir else base_dir.split("/")
    for part in link.split("/"):
        if part == "..":
            if parts:
                parts.pop()
        elif part != ".":
            parts.append(part)
    return "/".join(parts)


def extract_markdown_links(body, relative_to):
    links = []
    for match in re.finditer(r"\[([^\]]+)\]\(([^)]+\.md)\)", body):
        target = match.group(2)
        if target.startswith("http://") or target.startswith("https://"):
            continue
        links.append(resolve_relative_path(target, relative_to))
    return links


def file_mtime(path):
    try:
        return int(path.stat().st_mtime)
    except OSError:
        return 0


def insert_page(conn, relative_path, page_type, name, description, tags, plugin, modified_at):
    tags_json = json.dumps(tags) if tags else None
    conn.execute(
        """
        INSERT INTO pages (path, type, name, description, tags, plugin, modified_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          type=excluded.type,
          name=excluded.name,
          description=excluded.description,
          tags=excluded.tags,
          plugin=excluded.plugin,
          modified_at=excluded.modified_at
        """,
        (relative_path, page_type, name, description, tags_json, plugin, modified_at),
    )


def insert_plugin(conn, name, frontmatter, modified_at):
    triggers = parse_yaml_array(frontmatter.get("triggers"))
    requires = parse_yaml_array(frontmatter.get("requires"))
    conn.execute(
        """
        INSERT INTO plugins (name, version, author, description, triggers, requires, modified_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          version=excluded.version,
          author=excluded.author,
          description=excluded.description,
          triggers=excluded.triggers,
          requires=excluded.requires,
          modified_at=excluded.modified_at
        """,
        (
            name,
            frontmatter.get("version"),
            frontmatter.get("author"),
            frontmatter.get("description"),
            json.dumps(triggers) if triggers else None,
            json.dumps(requires) if requires else None,
            modified_at,
        ),
    )


def insert_links(conn, source, body, relative_to):
    targets = extract_markdown_links(body, relative_to)
    for target in targets:
        cursor = conn.execute(
            "INSERT OR IGNORE INTO links (source_path, target_path) VALUES (?, ?)",
            (source, target),
        )
    return len(targets)


def index_markdown_page(conn, file_path, relative_path, inferred_type, plugin=None, fallback_name=None):
    content = file_path.read_text(encoding="utf-8")
    frontmatter, body = parse_frontmatter(content)
    modified_at = file_mtime(file_path)
    name = frontmatter.get("name") or fallback_name or file_path.name.removesuffix(".md")
    page_type = frontmatter.get("type") or inferred_type
    tags = parse_yaml_array(frontmatter.get("tags"))
    insert_page(conn, relative_path, page_type, name, frontmatter.get("description"), tags, plugin, modified_at)
    parent = str(pathlib.PurePosixPath(relative_path).parent)
    return insert_links(conn, relative_path, body, "" if parent == "." else parent)


def reindex():
    root = wiki_root()
    for subdir in ["plugins", "entities", "concepts"]:
        (root / wiki_namespaced_dir(subdir)).mkdir(parents=True, exist_ok=True)

    conn = connect()
    reset_schema(conn)

    page_count = 0
    link_count = 0
    plugin_count = 0

    indexed_plugins = set()
    for plugins_relative_dir in candidate_dirs("plugins"):
        plugins_dir = root / plugins_relative_dir
        for plugin_dir in sorted([item for item in plugins_dir.iterdir() if item.is_dir() and not item.name.startswith(".")]):
            if plugin_dir.name in indexed_plugins:
                continue
            indexed_plugins.add(plugin_dir.name)
            skill_path = plugin_dir / "SKILL.md"
            if not skill_path.exists():
                continue
            content = skill_path.read_text(encoding="utf-8")
            frontmatter, body = parse_frontmatter(content)
            relative_path = f"{plugins_relative_dir}/{plugin_dir.name}/SKILL.md"
            modified_at = file_mtime(skill_path)
            insert_plugin(conn, plugin_dir.name, frontmatter, modified_at)
            plugin_count += 1
            insert_page(
                conn,
                relative_path,
                "workflow",
                frontmatter.get("name") or plugin_dir.name,
                frontmatter.get("description"),
                parse_yaml_array(frontmatter.get("tags")),
                plugin_dir.name,
                modified_at,
            )
            page_count += 1
            link_count += insert_links(conn, relative_path, body, f"{plugins_relative_dir}/{plugin_dir.name}")

            refs_dir = plugin_dir / "references"
            if refs_dir.is_dir():
                for ref_path in sorted(ref for ref in refs_dir.iterdir() if ref.is_file() and ref.name.endswith(".md")):
                    ref_relative = f"{plugins_relative_dir}/{plugin_dir.name}/references/{ref_path.name}"
                    link_count += index_markdown_page(
                        conn,
                        ref_path,
                        ref_relative,
                        "concept",
                        plugin=plugin_dir.name,
                        fallback_name=ref_path.name.removesuffix(".md"),
                    )
                    page_count += 1

    for dir_type, inferred_type in [("entities", "entity"), ("concepts", "concept")]:
        indexed_files = set()
        for type_relative_dir in candidate_dirs(dir_type):
            type_dir = root / type_relative_dir
            for file_path in sorted(type_dir.iterdir()):
                if file_path.name in indexed_files:
                    continue
                if not file_path.is_file() or not file_path.name.endswith(".md") or file_path.name.startswith("."):
                    continue
                indexed_files.add(file_path.name)
                relative_path = f"{type_relative_dir}/{file_path.name}"
                link_count += index_markdown_page(
                    conn,
                    file_path,
                    relative_path,
                    inferred_type,
                    fallback_name=file_path.name.removesuffix(".md"),
                )
                page_count += 1

    conn.commit()
    conn.close()
    return {"status": "ok", "pages": page_count, "links": link_count, "plugins": plugin_count}


def main():
    options = parse_args(sys.argv[1:])
    result = reindex()
    if options["json"]:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(f"Reindexed: {result['pages']} pages, {result['links']} links, {result['plugins']} plugins")


if __name__ == "__main__":
    main()
