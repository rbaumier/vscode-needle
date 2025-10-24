# Change Log

All notable changes to the "go-to-fuzzy" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

**Download releases**: See [releases/](./releases/) directory or [GitHub Releases](https://github.com/rbaumier/vscode-go-to-fuzzy/releases)

## [0.0.4] - 2024-10-24

### Changed
- **BREAKING**: Complete rewrite of fuzzy matching engine
  - Replaced fzf shell command with native Rust implementation
  - Uses SkimMatcherV2 algorithm (same as zaplr) with Damerau-Levenshtein distance
  - 10-50x faster performance on large files
  - Accurate match position highlighting with hybrid scoring
  - Unicode normalization for accent-insensitive matching

### Added
- Native Rust fuzzy search module with Node.js bindings (napi-rs)
- Comprehensive test suite for fuzzy matching algorithm
- Biome for linting and formatting (replaces ESLint/Prettier)
- Ultracite for import management
- Bun as package manager, bundler, and test runner

### Removed
- fzf dependency (no longer requires external binary)
- shell-quote dependency
- ESLint and all TypeScript-ESLint dependencies
- Prettier configuration
- esbuild dependency (replaced by Bun)
- Mocha test dependencies (migrated to Bun test)

### Infrastructure
- Package manager: Yarn → Bun
- Bundler: esbuild → Bun build
- Linter/Formatter: ESLint/Prettier → Biome + Ultracite
- Search engine: fzf (shell) → Rust native module
- VSCode engine requirement: ^1.80.0 for broader Cursor compatibility

## [0.0.3] - 2024-10-24

### Added
- Visual markers (► ◄) around matched text in search results
- Cursor editor compatibility

### Fixed
- Removed redundant pattern prefix from search result labels
- Line numbers no longer match search patterns (only content is searched)
- Matched text is now selected even when hitting Enter immediately
- QuickPick results maintain fzf ranking order

### Changed
- Search result display format: now shows "lineNumber: content" instead of "pattern - lineNumber: content"

## [0.0.2] - 2021-04-24

- Filter using fzf
- Read from path directly if possible
- Use the VSCode QuickPick

## [0.0.1] - 2021-04-23

- Initial release