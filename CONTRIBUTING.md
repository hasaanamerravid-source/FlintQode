# Contributing to FlintQode

## Development setup

```bash
git clone https://github.com/hasaanamerravid-source/FlintQode.git
cd FlintQode
npm install
npm run dev:app
```

Requirements: Node.js 20+, Rust stable, and the platform dependencies listed in
the README.

## Before you submit

```bash
npm run check
```

This runs formatting, type checking, i18n checks, unit tests and the frontend
build. Rust changes must also pass:

```bash
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

## Pull requests

- One logical change per PR.
- Reference the related issue.
- Include screenshots for UI changes.
- Keep the diff focused; do not reformat unrelated code.
EOF