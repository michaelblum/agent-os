# side-eye has been merged into the aos unified binary

All side-eye functionality is now available directly via `aos`:

- `aos see capture` — screenshot pipeline (was `side-eye capture`)
- `aos see list` — display/window topology (was `side-eye list`)
- `aos see cursor` — cursor position + AX element (was `side-eye cursor`)
- `aos see selection` — selected text (was `side-eye selection`)
- `aos focus create/update/list/remove` — focus channels (was `side-eye focus`)
- `aos graph displays/windows/deepen/collapse` — graph navigation (was `side-eye graph`)

Build: `bash build.sh` (from repo root)
