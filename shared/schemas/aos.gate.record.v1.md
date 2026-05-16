# `aos.gate.record.v1`

Durable audit metadata for one terminal `aos.gate.request.v1` lifecycle outcome.

Records are appended as JSONL by the CLI-owned gate service at:

```text
~/.config/aos/{repo|installed}/gate/records.jsonl
```

When `AOS_STATE_ROOT` is set, the path is:

```text
$AOS_STATE_ROOT/{repo|installed}/gate/records.jsonl
```

The record intentionally stores prompt title and lifecycle metadata, not prompt
body or answer payloads by default. Answer payloads are present only when
`response_stored` is `true`, which requires `metadata.record_response: true` on
the request or `--store-response` on `aos gate ask`.

Use `aos gate records --json` for local readback.
