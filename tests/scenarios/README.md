# Test Scenarios

Scenarios are thin user-facing workflows that compose reusable helpers from
`tests/lib/**` and declare the behavior under test.

Use this tree when the test is better described as a task flow than as a unit,
schema, parser, or narrow contract test. Keep existing focused suites such as
`tests/renderer/`, `tests/toolkit/`, `tests/browser/`, and `tests/schemas/` in
their current homes.

Scenario scripts should:

- make their environment assumptions explicit
- call shared helpers for daemon, content-root, canvas, perception, and input
  setup instead of duplicating setup logic
- state when real mouse or keyboard input will be used
- own cleanup for canvases, helper daemons, temp state roots, and traces

Older top-level shell scripts remain valid. Move or split them into scenarios
only when touching them for substantive work.
