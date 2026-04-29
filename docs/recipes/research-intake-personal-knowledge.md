# Recipe: Research Intake And Personal Knowledge

Use this recipe when adding meeting transcripts, Slack links, videos, PDFs, or
other raw sources to the AOS knowledge layer.

Tracking:

- Epic: GitHub issue #156
- V0 meeting transcript slice: GitHub issue #157

## Principle

Do not dump raw sources into the wiki. Keep raw sources in an intake pack and
write wiki nodes as processed knowledge with pointers back to source artifacts.

```text
raw source
  -> research intake pack
  -> extracted artifacts and evidence records
  -> candidate wiki nodes
  -> runtime AOS wiki pages after review
```

## V0 Shape

Research intake packs live under:

```text
~/.config/aos/{mode}/research-intake/<intake_id>/
```

V0 writes:

- `research-intake.json`
- `intake-timeline.jsonl`
- `sources/source-cards.jsonl`
- `evidence/evidence-items.jsonl`
- `wiki/wiki-pages.jsonl`
- `artifacts/raw/`
- `artifacts/extracted/`

## Meeting Transcript Flow

For a `.vtt` or text meeting transcript:

1. Store the original transcript in `artifacts/raw/`.
2. Parse transcript segments into `artifacts/extracted/`.
3. Create a source card with title, URI, artifact paths, and capture time.
4. Generate draft wiki page candidates under `personal/meetings/`.
5. Let an agent or human synthesize summary, decisions, action items, topics,
   and related links before writing durable wiki pages.

Current V0 command:

```bash
node scripts/research-intake-meeting.mjs \
  --file ~/Downloads/meeting.vtt \
  --title "Meeting Title"
```

The command prints the created intake pack path. Use `--json` when another
agent or script should consume the result.

## Slack Link Flow

For a link posted to Slack, the future worker should:

1. Preserve Slack message provenance.
2. Store source metadata and fetched/derived artifacts.
3. Extract concepts, entities, claims, and useful quotes.
4. Update or propose wiki nodes under `personal/sources/`,
   `personal/topics/`, and related namespaces.

Slack automation is not part of V0. The current slice establishes the pack
format and deterministic meeting transcript intake.

## Retrieval Rule

When the user references a meeting, source, topic, or research item, agents
should search the runtime AOS wiki first. Follow raw artifact references only
when the distilled wiki node is insufficient or when exact wording matters.
