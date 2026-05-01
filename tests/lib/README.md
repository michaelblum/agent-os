# Test Helper Libraries

Reusable test helpers live here when more than one scenario or test script can
share them.

Keep helpers grouped by owner and abstraction level:

- `aos/` for generic AOS primitives such as daemon lifecycle, canvas lifecycle,
  perception, input, and status item interaction.
- `sigil/` for Sigil-specific actions built on AOS primitives.
- `harness/` for supervised test-run primitives when those land.

Do not move old top-level scripts here just for tidiness. Extract helpers when
touching a test for substantive work and the extracted behavior is genuinely
reusable.

Helpers should not hide whether they use synthetic input, daemon-routed input,
or real mouse/keyboard streams. Real-input helpers must preserve the explicit
operator gate described in [`../README.md`](../README.md).
