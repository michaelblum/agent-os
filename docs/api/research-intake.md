# Research Intake

Research intake V0 is an experimental file-backed substrate for turning raw
sources into processed AOS wiki knowledge.

Tracking: GitHub issue #157 under epic #156.

The core rule is: raw sources stay as artifacts; wiki pages carry distilled
knowledge and source references.

## Contract Family

- `research-intake-pack.schema.json`: `research-intake.json` metadata.
- `src/sessions/research-intake/`: Node-compatible pack writer and meeting
  transcript helpers.

## Intake Pack

A live intake writes to:

```text
~/.config/aos/{mode}/research-intake/<intake_id>/
```

The V0 layout is:

```text
research-intake.json
intake-timeline.jsonl
summary.md
sources/source-cards.jsonl
evidence/evidence-items.jsonl
wiki/wiki-pages.jsonl
artifacts/
  raw/
  extracted/
```

The raw artifact directory is the source of truth for source material such as
meeting transcripts, VTT files, web page captures, or video transcript exports.
The `wiki/wiki-pages.jsonl` file stores candidate wiki pages that point back to
those artifacts instead of inlining the full source.

## V0 Meeting Transcript Intake

V0 includes deterministic `.vtt` parsing into timed transcript segments. It
does not yet summarize with an LLM, extract decisions automatically, or write to
the runtime wiki. Those are follow-up workflow layers.

## Boundary

This API is experimental. Slack link intake, video transcript fetching, PDF
parsing, semantic search, embeddings, automatic wiki writes, and personal wiki
review gates are out of scope for this first slice.
