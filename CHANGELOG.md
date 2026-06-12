# Change Log

All notable changes to the "xml-doc-color" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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
