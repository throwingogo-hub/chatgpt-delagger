# Changelog

All notable changes to GPT Delagger are documented here.

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
