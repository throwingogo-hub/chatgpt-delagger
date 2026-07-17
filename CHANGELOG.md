# Changelog

All notable changes to GPT Delagger are documented here.

## [1.5.0] - 2026-07-17

### Added

- **Keep newest embed**: an optional mode for the blocker that keeps only the most recent tool/MCP embed mounted. Older embeds are detached, and when a new embed streams in, the swap happens in the same before-paint pass.

### Fixed

- The offline fixture's live-connector and Chinese-chip turns were unreachable (their indices are multiples of 14, which an earlier branch consumed), so two blocker paths were never exercised. Exact-index fixtures now take priority.

- Turn discovery now stops before `main` and before any composer element (`form`, `textarea`, `contenteditable`), so a one-message conversation can no longer tag or detach the page shell and input box as a "turn".
- The **Show N more** button now reveals exactly the batch size its label advertises (both sides use the same clamped keep count).
- Removing a synced setting key now falls back to the default instead of leaving the setting `undefined`.
- Clearing the "keep last" number box in the popup restores the previous value instead of silently setting it to 0 and hiding the whole chat.

### Improved

- The popup header shows the installed extension version.
- The offline fixture now includes a composer form, matching the real page layout.

[1.5.0]: https://github.com/throwingogo-hub/chatgpt-delagger/releases/tag/v1.5.0

## [1.4.0] - 2026-07-16

### Added

- Reversible trimming for long conversations with a configurable 0–100 turn limit.
- Exact blocking for connector apps, MCP/tool-call UI, failure fallbacks, and image-generation loading frames.
- Zap mode for creating conservative, reversible custom hide selectors.
- Offline long-chat fixture and zero-dependency regression checks.

### Improved

- Immediate scanning of newly inserted tool UI before the debounced maintenance pass.
- Restoration of blocked embeds nested inside detached conversation turns.
- Popup status reporting and editable trim-count controls.

[1.4.0]: https://github.com/throwingogo-hub/chatgpt-delagger/releases/tag/v1.4.0
