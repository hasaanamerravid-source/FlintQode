# Security policy

FlintQode is a local desktop editor. It does not collect telemetry or make
network requests without an explicit user action. Renderer errors are written
to a local log file; no remote crash report or source content is uploaded.

## Reporting a vulnerability

Please report security issues privately through GitHub's
"Report a vulnerability" feature on the FlintQode repository, or by email to
the maintainer. Do not open a public issue for a suspected vulnerability.

You can expect an acknowledgement within 7 days and a fix or mitigation plan
within 30 days for confirmed issues.

## Supported versions

Only the latest release is supported with security fixes.

## Scope

In scope: the Rust backend, the renderer, the website and the release
pipeline. Out of scope: third-party language servers and interpreters that the
user installs separately.
