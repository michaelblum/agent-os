# Foreman Transfer Packets

`.docks/foreman/packets/` holds Foreman-authored transfer packet files for
active cross-session handoffs.

This directory is a coordination convention, not a runtime store and not a
product schema. The packet files keep copied prompts short while preserving the
detailed transfer contract on disk.

## Naming

Use:

```text
.docks/foreman/packets/to-<dock>-<slug>.json
```

## Contents

Each packet should be compact JSON with the fields needed for a receiving dock
to rediscover the work:

- `recipient`
- `transfer_kind`
- `single_next_goal`
- `work_card_ref`
- `required_start_ref`
- `branch_from`
- `expected_output_branch` when applicable
- `required_evidence`
- `stop_conditions`
- `clipboard_prompt`

Detailed implementation or live-run instructions still belong in
`docs/design/work-cards/`. The packet should point to that work card.

## Clipboard Rule

Clipboard prompts should stay short and pointer-only, for example:

```text
follow the transfer packet in .docks/foreman/packets/to-gdi-<slug>.json; start from <ref>
```

Do not paste large work cards or transfer payloads directly into the clipboard
goal unless the task is genuinely tiny.

## Lifecycle

Packet files are active transfer artifacts. They should not become permanent
background clutter.

During Foreman hygiene, do one of the following for each packet:

- keep it if its transfer is still active or awaiting review;
- supersede it with a newer packet when the old route is obsolete;
- delete it once the transfer has been accepted and its durable outcome is
  captured in a work card, PR, issue, or design note;
- promote the convention into product docs before relying on it as a stable
  repo-wide mechanism.

If a packet remains in this directory, it should be intentionally reviewable and
tied to an active or recently accepted work card.
