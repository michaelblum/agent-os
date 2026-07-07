# Sample Work Card

## Decision Points

- [ ] Approve the expression contract.
- [x] Keep Markdown canonical.

```mermaid
graph TD
  A[<script>alert(1)</script>]-->B
```

## Non-Goals

- Do not mutate source Markdown automatically.

## Verification

```bash
node --test tests/toolkit/html-workbench-expression.test.mjs
```

[bad](javascript:alert(1))
