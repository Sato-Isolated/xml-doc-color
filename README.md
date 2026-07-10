# XML Doc Color

[![VS Marketplace](https://img.shields.io/badge/VS%20Marketplace-xml--doc--color-blue?style=flat-square&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=MindLated.xml-doc-color)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/Sato-Isolated/xml-doc-color?style=flat-square)](https://github.com/Sato-Isolated/xml-doc-color)

XML Doc Color adds precise TextMate scopes to XML documentation, Javadoc, TSDoc, JSDoc, PHPDoc, KDoc and ordinary block comments, including `/*** … */` forms. It colors tags, delimiters, attributes, entities, references, CDATA, `@`-tags, prefixes and prose without replacing the semantic token provider supplied by your language extension.

![XML Doc Color sidebar and highlighted code](img/image.png)

## Features

- Seventeen TextMate injection grammars that coexist with C#, TypeScript, Java and Kotlin language services
- Ten supported VS Code language IDs, including TSX and JSX
- Thirteen independently configurable documentation token categories
- Global colors with optional per-language overrides
- Dark, Light, Custom and Inherited Theme modes
- A typed, keyboard-accessible sidebar with persistent per-language drafts
- Desktop, remote, virtual workspace and VS Code Web support
- Automatic migration from XML Doc Color 0.0.x semantic color rules

## Supported languages

| Language | Comment style | Documentation format |
|---|---|---|
| C# | `///` | XML documentation |
| VB.NET | `'''` | XML documentation |
| F# | `///` | XML documentation |
| Java | `/** … */`, `/* … */`, `/*** … */` | Javadoc and owned block comments |
| TypeScript / TSX | `/** … */`, `/* … */`, `/*** … */` | TSDoc/JSDoc and owned block comments |
| JavaScript / JSX | `/** … */`, `/* … */`, `/*** … */` | JSDoc and owned block comments |
| PHP | `/** … */`, `/* … */`, `/*** … */` | PHPDoc and owned PHP block comments |
| Kotlin | `/** … */`, `/* … */`, `/*** … */` | KDoc and owned block comments |

Owned `/* … */` and three-or-more-star comments in these seven block-comment languages use the same thirteen-color palette. Exact `/** … */` delimiters remain native to Javadoc/JSDoc/PHPDoc/KDoc. Comment-like text inside strings, templates, regular expressions, line comments, or embedded CSS in PHP/HTML files is left to the host grammar. C# remains limited to `///` documentation.

## Color picker

Open the XML Doc Color view from the Activity Bar or run **XML Doc Color: Open Color Picker**.

1. Select **All Languages** or one language.
2. Keep the inherited theme colors, choose a preset, or edit any of the thirteen hexadecimal colors.
3. Apply the rules to your global settings or the current workspace.
4. Use **Copy JSON** to export the corresponding `editor.tokenColorCustomizations` snippet.
5. Use **Reset** to remove only XML Doc Color rules for the selected scope.

All-language rules are applied first. A language rule is more specific and therefore wins for that language. Resetting one language falls back to the all-language rule and then to the active theme.

## TextMate scopes

Every category uses a stable scope suffixed with the VS Code language ID. Examples:

- `entity.name.tag.xml-doc-color.typescript`
- `punctuation.definition.tag.xml-doc-color.csharp`
- `variable.other.reference.documentation.xml-doc-color.java`
- `keyword.other.documentation.xml-doc-color.kotlin`
- `punctuation.definition.comment.block.xml-doc-color.typescript`
- `comment.documentation.xml-doc-color.php`

**Block comment delimiters** controls owned `/*`, `/***`, `/****` and `*/`
markers. **Comment prefix** controls `///`, `'''` and interior multiline `*`
prefixes. **Tag delimiters** controls XML punctuation such as `<`, `>`, `</`
and `/>`.

The owned block region also carries a standard `comment.block` parent scope.
This lets normal theme rules such as `comment` color a new block delimiter in
**Inherited Theme** mode without requiring access to private theme variables.

The sidebar writes named rules such as:

```jsonc
{
  "editor.tokenColorCustomizations": {
    "textMateRules": [
      {
        "name": "XML Doc Color / xmlDocTagName / typescript",
        "scope": "entity.name.tag.xml-doc-color.typescript",
        "settings": {
          "foreground": "#4EC9B0",
          "fontStyle": "bold"
        }
      }
    ]
  }
}
```

Rules not created by XML Doc Color are preserved when colors are applied or reset.

Applying a palette to **All Languages** removes existing XML Doc Color
language overrides so the selected palette takes effect in every supported
language. Resetting **All Languages** removes only the global rules and keeps
any language overrides created afterwards.

## Migration from 0.0.x

On first activation of 0.1.0, XML Doc Color scans the global and workspace values of `editor.semanticTokenColorCustomizations`. Rules owned by the extension are converted to equivalent TextMate rules in the same configuration layer, including language and theme-specific entries.

The new rules are written and verified before the legacy keys are removed. Unrelated semantic and TextMate customizations are never changed. If migration cannot be verified, the legacy rules remain in place and an error is shown.

The old `xmlDocColor.enabled`, `xmlDocColor.enabledLanguages` and `xmlDocColor.tokenMode` settings were removed because TextMate grammars are declarative and stay active while the extension is installed. With no explicit override, the new scopes inherit your active theme.

Existing twelve-color TextMate palettes are not rewritten automatically. The
new block-delimiter category inherits the theme until the next **Apply**, which
writes the complete thirteen-color palette.

## Settings

| Setting | Default | Description |
|---|---|---|
| `xmlDocColor.showStatusItem` | `true` | Show the language status item in supported editors |
| `xmlDocColor.configurationTarget` | `"global"` | Write sidebar changes to global or workspace settings |

## Commands

| Command | Description |
|---|---|
| `XML Doc Color: Open Color Picker` | Focus the sidebar color editor |
| `XML Doc Color: Copy TextMate Customization JSON` | Copy rules for the active language or all languages |
| `XML Doc Color: Open TextMate Customization Snippet` | Open editable JSONC in a new editor |

## Troubleshooting

- Run **Developer: Inspect Editor Tokens and Scopes** to inspect the generated TextMate scopes.
- Run **Developer: Reload Window** once after installing or updating a local VSIX so VS Code reloads grammar contributions.
- If a workspace target is selected, open a folder or workspace before applying colors.
- Reset the selected scope to check the active theme's inherited colors.
- Report grammar conflicts with a small documentation-comment sample and the language extension/version in use.

## Development

```powershell
npm install
npm run compile
npm test
npm run test:webview
npm run test:web
npm run vsix
```

The build generates seventeen injection grammars in `dist/syntaxes`, desktop and WebWorker extension bundles, and a separate browser bundle for the sidebar.

## Links

- [GitHub repository](https://github.com/Sato-Isolated/xml-doc-color)
- [Report an issue](https://github.com/Sato-Isolated/xml-doc-color/issues)
- [Changelog](CHANGELOG.md)

Made by [MindLated](https://github.com/Sato-Isolated)
