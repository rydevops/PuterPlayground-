# CLAUDE.md

Guidance for Claude when working in this repository.

## Workflow rules

- **Always create a new branch for each new request to change the code.** Start it from the latest `main`. If the request is only an informational question, don't create a branch.
- **Always open a pull request after making a code change on a new branch.**
- **Always put the pull request link at the very end of your final reply**, so it can be found without scrolling back up.

## Project notes

- `kv-utility/` is a PWA for the Puter.js key-value store and file system. It has no build step; serve the folder as-is.
- When releasing a change to `kv-utility/`, bump `VERSION` in `kv-utility/sw.js`. That's how installed copies detect the update and show the "Update now" banner.
- Tests live in `kv-utility/tests/`. Run them with `cd kv-utility && npm test` before pushing a change, and add or update tests for new behaviour. They use a fake Puter.js (`tests/helpers/puter-mock.js`), described in `kv-utility/tests/README.md`.
