# Employer Brand Live Evidence Capture Repair Promotion v0

This schema defines the deterministic promotion result that consumes a filled
live-evidence capture repair patch and produces the next repaired locator
capture-attempt plan. It is planning metadata only.

The artifact promotes only approved repaired locator decisions into executable
repaired capture slots. It preserves source-unavailable decisions and prior
non-executable context as non-executable context, keeps all planned output paths
null, and records that no URLs, browser codegen, locator resolution, capture,
report rendering, export, or workflow execution occurred.

