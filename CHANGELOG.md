# Change Log

All notable changes to the "xml-doc-color" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.1.0] - 2026-07-10

### Changed

- Replaced the runtime semantic token provider with seventeen TextMate injection grammars so XML Doc Color coexists with language-server semantic highlighting
- Added full `/* … */` block-comment coloring for Java, JavaScript, JSX, TypeScript, TSX, PHP and Kotlin without intercepting strings, regexes, templates or embedded CSS
- Moved color customization to named `editor.tokenColorCustomizations.textMateRules` with global and per-language precedence
- Rebuilt the color picker as a typed, CSP-safe and keyboard-accessible webview with all thirteen token categories and persistent drafts
- Added separate desktop, WebWorker and webview bundles, including virtual workspace and VS Code Web support
- Lowered the minimum supported VS Code version to 1.74.0

### Migration

- Automatically moves XML Doc Color rules from `editor.semanticTokenColorCustomizations` after the matching TextMate rules have been written and verified
- Preserves unrelated semantic and TextMate rules in global, workspace, language and theme-specific configuration blocks

### Removed

- Removed `xmlDocColor.enabled`, `xmlDocColor.enabledLanguages`, `xmlDocColor.tokenMode` and the Toggle Enabled command because declarative TextMate grammars remain active while installed
- Removed the semantic token legend, full-document parser, cache and range provider

### Fixed

- Fixed the sidebar contract mismatch that sent seven colors while the extension required twelve
- Prevented global/workspace settings from being copied across configuration layers
- Fixed **All Languages** palettes being masked by previously saved language-specific overrides
- Colored block comments beginning with three or more stars (`/*** … */`) while keeping exact `/** … */` comments on the native documentation path
- Added an independent block-comment delimiter color, complete opener capture and a standard `comment.block` parent for theme inheritance
- Fixed Javadoc/JSDoc block injections so XML attributes are colored and `*/` reliably returns to source-code tokenization
- Added grammar, migration, Extension Host and browser-level webview tests

## [0.0.5] - 2026-06-12

### Added

- TSX and JSX support for the semantic token provider and sidebar previews
- Richer token coverage for entities, CDATA, inline delimiters, and reference-style values
- New `xmlDocColor.tokenMode` setting to switch between structured-only and full prose coloring

### Changed

- Updated the semantic token legend, presets, and read/write color logic to cover the full doc-token model
- Refreshed language metadata and preview data to reflect the current supported language set

### Fixed

- Fixed the token provider range handling for full-document scans and alignment issues in the tests and manifest

## [0.0.4] - 2026-06-04

### Added

- New commands to toggle the extension, copy semantic token JSON, and open a theme customization snippet
- Sidebar preset modes: Default, Dark, Light, and Reset to inherited theme
- Onboarding hint when the color picker opens without a supported editor
- New settings: `xmlDocColor.enabledLanguages`, `xmlDocColor.showStatusItem`, and `xmlDocColor.configurationTarget`

### Changed

- Sidebar now shows whether each token color is inherited or explicitly overridden
- Parser is more conservative around inline generic syntax such as `List<T>`
- Semantic token provider now uses a static token-type index map instead of repeated array lookups

### Fixed

- Added coverage for single-quoted XML attributes, larger documents, and untitled editor scenarios

## [0.0.3] - 2026-05-28

### Added

- Colorization now works in **diff editors** — both the original (left) and modified (right) sides are colored for all supported languages

## [0.0.2] - 2026-05-28

### Changed

- README rewritten for GitHub and VS Code Marketplace
- Added MIT license
- Publisher set to MindLated
- Added `repository`, `homepage`, `bugs`, `galleryBanner`, and `icon` fields to package.json
- Added categories: Themes, Programming Languages

## [0.0.1] - 2026-05-28

### Added

- Semantic token colorization for 7 token types: `xmlDocTagName`, `xmlDocTagDelimiter`, `xmlDocAttribute`, `xmlDocAttributeValue`, `xmlDocAtTag`, `xmlDocLinePrefix`, `xmlDocText`
- Support for 8 languages: C#, F#, VB.NET, Java, TypeScript, JavaScript, PHP, Kotlin
- Sidebar Color Picker webview with per-language color overrides, live preview, Apply and Reset actions
- Two bundled themes: **XML Doc Color Dark** and **XML Doc Color Light**
- `xmlDocColor.enabled` setting to toggle colorization without uninstalling
