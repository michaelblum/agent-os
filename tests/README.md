# Test Targets

Use the smallest loop that matches the change. Do not rebuild `./aos` by
default before every verification step.

## Rebuild `./aos` First

Rebuild with `bash build.sh` when both of these are true:

- the work changed Swift sources in `src/` or `shared/swift/ipc/`
- the command or test you are about to run executes `./aos`

Examples:

- `bash tests/wiki-seed.sh`
- `bash tests/wiki-migrate.sh`
- `bash tests/wiki-write-api.sh`
- `bash tests/content/wiki-list.test.sh`
- `./aos runtime status --json`
- `./aos show create ...`

## No `./aos` Rebuild Needed

Stay in the local package or Node loop when the work does not depend on a fresh
`./aos` binary.

Examples:

- `node --test tests/studio/*.test.mjs`
- `node --test tests/renderer/*.test.mjs`
- `cd packages/gateway && npm test`
- `cd packages/host && npm test`

## Mixed Work

If a change spans both Swift and JS/package surfaces:

1. Run the smallest local tests first without rebuilding `./aos`.
2. Rebuild once before the first `./aos`-backed verification step.
3. Reuse that binary for the remaining `./aos` checks until Swift changes again.
