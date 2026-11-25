# Contributing to FlintQode

## Development setup

```bash
git clone https://github.com/hasaanamerravid-source/FlintQode.git
cd FlintQode
npm install
npm run dev:app
```

Requirements: Node.js 22.12 or newer, Rust stable (`rustup`), and the platform dependencies listed in the [README](README.md).

## Before you submit

Run the project checks:

```bash
npm run check
```

Rust changes must also pass:

```bash
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

The CI workflow currently treats Rust formatting and Clippy as advisory checks; please fix any failures introduced by your change and mention existing failures in your pull request.

## Pull requests

- Keep each pull request focused on one logical change.
- Reference the related issue when one exists.
- Include screenshots or a short recording for user-interface changes.
- Keep the diff focused; do not reformat unrelated code.
- Describe what you tested and note any platform-specific behavior that still needs verification.
