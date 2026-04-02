# Changelog

## 1.6.2

Released: 2026-04-02

No breaking changes.

### Added

- `DrawerShell` header overrides now accept full React node titles cleanly for embedded controls like browser URL bars

### Changed

- `NavHeader` no longer reserves empty left or right spacing when those slots are unused
- header layout handling is more reliable for screens that need full-width interactive content in the title area

### Notes

- This release is backward compatible with existing 1.6.x consumers.

## 1.5.0

Released: 2026-03-31

No breaking changes.

### Added

- new glasses helpers `glass-format` and `glass-chat-display`
- new web `MultiSelect` component export
- README refresh to reflect the current published surface area

### Changed

- action bar hover/active triangle semantics now match the latest glasses UX
- glasses gesture handling is more reliable for settings editing and immediate scroll changes
- Deepgram STT shutdown noise is suppressed during intentional close
- dialog background scroll locking is stronger on web/touch devices
- swipe-to-delete rows now support loading feedback through the shared list item
- SVG navigate icon now inherits current color correctly for dark buttons

### Notes

- This release is backward compatible with existing 1.4.x imports.
- Consumers can upgrade without code changes unless they were depending on old visual bugs.
