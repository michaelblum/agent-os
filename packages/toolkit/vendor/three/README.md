# Vendored Three.js Runtime

The DesktopWorld browser stage uses the unmodified minified ESM distribution
from Three.js `0.183.2`:

- `three.module.min.js` SHA-256
  `0a61c95f14e0fa015b3083475c73424f360e5f6f5b74c282b50fdbc2f4c228fc`
- `three.core.min.js` SHA-256
  `0a9c2f0672c7b8d993ba7639e71919db181ca50c9dff99c78476d3e19057ca9c`

Both files came from the same published `three@0.183.2` package. The module
file imports the core file, so they are one indivisible browser artifact. The
upstream MIT license is retained in `LICENSE` and in each source file header.

This directory is host implementation material, not part of the dependency-
injected `@agent-os/toolkit/scene` package export. Update both files, hashes,
license evidence, and the DesktopWorld outlet tests together.
