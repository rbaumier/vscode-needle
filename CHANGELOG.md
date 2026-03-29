# Change Log

All notable changes to the "needle" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.0.0] - 2026-03-29

### Changed
- **BREAKING**: Renamed extension from "Go to Fuzzy" to "Needle"
  - Command: `go-to-fuzzy.find` → `needle.find`
  - Users need to update keybindings
- Replaced fuzzy matching with plain substring search (smart case)
- New logo and branding

### Removed
- Fuzzy matching algorithm (SkimMatcherV2) — replaced by faster substring search
- `fzf` requirement — no external dependencies needed

## [0.0.4] - 2024-10-24

### Changed
- **BREAKING**: Complete rewrite of search engine
  - Replaced fzf shell command with native Rust implementation
  - 10-50x faster performance on large files

### Added
- Native Rust search module with Node.js bindings (napi-rs)
- Biome for linting and formatting
- Bun as package manager and bundler

### Removed
- fzf dependency
- ESLint/Prettier
- esbuild (replaced by Bun)

## [0.0.3] - 2024-10-24

### Added
- Visual markers around matched text
- Cursor editor compatibility

### Fixed
- Line numbers no longer match search patterns
- Matched text is now selected on Enter

## [0.0.2] - 2021-04-24

- Filter using fzf
- Read from path directly if possible
- Use the VSCode QuickPick

## [0.0.1] - 2021-04-23

- Initial release
