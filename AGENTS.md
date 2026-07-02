# AndysNote Agent Instructions

## Read First

- Read [docs/PRINCIPLE.md](docs/PRINCIPLE.md) before making changes.
- Also read [docs/DECISIONS.md](docs/DECISIONS.md) for the current architectural decisions.
- Keep the project rules in those files as the source of truth.

## Core Rules

- Preserve the app as a plain-text note editor: documents stay in `.txt`, Markdown is only formatting, and HTML is not a storage format.
- Treat the user’s text as the source of truth. Rendered HTML is temporary and must be regenerated when needed.
- Respect the existing separation of concerns: editor input/cursor/undo, Markdown parsing, rendering/live preview, storage, and settings should stay isolated.
- Prefer the smallest change that solves the request. Do not refactor unrelated code or alter existing behavior unless the task requires it.
- Do not change the project’s storage model unless the user asks. Google Drive is the primary store; local browser storage is for offline use.

## Project Shape

- The app is a small static web app served by [server.py](server.py); there is no build pipeline or formal test harness in this workspace.
- The main runtime is plain JavaScript in [js/](js/), with global state and module boundaries already established.
- Keep new code aligned with the existing file boundaries instead of introducing a new abstraction layer.

## Working Guidance

- Before editing, inspect the nearest owning files rather than searching broadly.
- When changing editor behavior, check [js/editor/engine.js](js/editor/engine.js) and related editor files first.
- When changing Markdown behavior, check [js/markdown.js](js/markdown.js) and [js/editor/markdown.js](js/editor/markdown.js) first.
- When changing rendering, check [js/editor/renderer.js](js/editor/renderer.js) first.
- When changing storage, check [js/local.js](js/local.js) and [js/drive.js](js/drive.js) first.
- When changing settings or UI configuration, check [js/settings.js](js/settings.js) and [js/config.js](js/config.js) first.

## Safety Notes

- Avoid unnecessary animation or visual churn; the UI should stay focused on writing.
- Preserve existing autosave, cache, and service-worker cleanup behavior unless the request is specifically about them.
- If a requested change would cross module boundaries, define the responsible module first and keep the implementation there.