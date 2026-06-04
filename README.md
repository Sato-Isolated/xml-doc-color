# XML Doc Color

[![VS Marketplace](https://img.shields.io/badge/VS%20Marketplace-xml--doc--color-blue?style=flat-square&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=MindLated.xml-doc-color)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/Sato-Isolated/xml-doc-color?style=flat-square)](https://github.com/Sato-Isolated/xml-doc-color)

Bring your XML documentation comments to life. **XML Doc Color** uses semantic highlighting to give distinct colors to every part of a doc comment — tag names, delimiters, attributes, values, `@`-tags, prefixes, and plain text — across 8 languages.

![XML Doc Color sidebar and highlighted code](img/image.png)

---

## Features

- **Semantic highlighting** for XML doc comments (`///`, `'''`, `/** */`) across 8 languages
- **7 individually configurable token types** — fully customizable via the sidebar Color Picker or your theme JSON
- **Sidebar Color Picker** — per-language color overrides with live preview, presets, inherited-theme reset, JSON export, and instant apply
- **Two bundled themes** — *XML Doc Color Dark* and *XML Doc Color Light* for explicit, zero-config color control
- **Helpful commands** — toggle the extension, copy semantic-token JSON, or open a ready-to-paste snippet
- **Fine-grained settings** — enable only selected languages, hide the status item, and choose whether changes write to global or workspace settings
- **`xmlDocColor.enabled` setting** — disable the extension entirely without uninstalling

---

## Supported Languages

| Language | Comment style | Doc format |
|---|---|---|
| C# | `///` | XML doc comments |
| F# | `///` | XML doc comments |
| VB.NET | `'''` | XML doc comments |
| Java | `/** … */` | Javadoc |
| TypeScript | `/** … */` | TSDoc / JSDoc |
| JavaScript | `/** … */` | JSDoc |
| PHP | `/** … */` | PHPDoc |
| Kotlin | `/** … */` | KDoc |

---

## Token Colors

All 7 token types inherit from a standard VS Code token type so they work out of the box with any theme. Each can be overridden individually.

| Token type | Colors | Inherits from |
|---|---|---|
| `xmlDocTagName` | `<summary>`, `<param>`, `<returns>` … | `type` |
| `xmlDocTagDelimiter` | `<`, `>`, `</`, `/>`, `<!--`, `-->` | `operator` |
| `xmlDocAttribute` | `name`, `cref`, `href` … | `property` |
| `xmlDocAttributeValue` | `"paramName"` … | `string` |
| `xmlDocAtTag` | `@param`, `@returns`, `@link` … | `keyword` |
| `xmlDocLinePrefix` | `///`, `'''`, `*`, `/**`, `*/` | `comment` |
| `xmlDocText` | Plain text between tags | `comment` |

---

## Color Picker

Open the sidebar panel via the **XML Doc Color** icon in the Activity Bar, or run **XML Doc Color: Open Color Picker** from the Command Palette (`Ctrl+Shift+P`).

- Pick a language from the dropdown
- Choose a preset: **Default**, **Dark**, **Light**, or **Reset to inherited theme**
- Adjust any token color using the color inputs
- See which rows are currently **Inherited** versus explicitly **Overridden**
- Hit **Apply** to write the colors to your VS Code settings instantly
- Use **Copy JSON** to export the exact semantic-token rules for the selected scope
- Use **Reset** to revert a language back to inherited/global defaults

### Example Theme JSON

```jsonc
{
  "editor.semanticTokenColorCustomizations": {
    "rules": {
      "xmlDocTagName": { "foreground": "#4EC9B0", "bold": true },
      "xmlDocTagDelimiter": "#6D8B6D",
      "xmlDocAttribute": "#9CDCFE",
      "xmlDocAttributeValue": "#CE9178",
      "xmlDocAtTag": { "foreground": "#C586C0", "bold": true },
      "xmlDocLinePrefix": "#6A9955",
      "xmlDocText": "#D4D4D4"
    }
  }
}
```

To scope colors to one language, suffix the token with `:languageId`, for example `xmlDocTagName:typescript`.

## Why semantic highlighting may need to be enabled

XML Doc Color contributes semantic token types, so your editor theme must allow semantic highlighting.

- This extension enables `editor.semanticHighlighting.enabled` by default for supported languages
- If another setting or theme disables semantic highlighting, colors may not appear
- Use the status item or reopen the color picker after changing theme settings if the preview and editor look out of sync

---

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `xmlDocColor.enabled` | `boolean` | `true` | Enable or disable XML doc comment colorization entirely |
| `xmlDocColor.enabledLanguages` | `string[]` | all supported languages | Limit XML Doc Color to a subset of supported languages |
| `xmlDocColor.showStatusItem` | `boolean` | `true` | Show the XML Doc Color language status item |
| `xmlDocColor.configurationTarget` | `"global" \| "workspace"` | `"global"` | Choose where sidebar and command changes are persisted |

---

## Commands

| Command | Description |
|---|---|
| `XML Doc Color: Open Color Picker` | Opens the sidebar Color Picker panel |
| `XML Doc Color: Toggle Enabled` | Enables or disables XML Doc Color using your configured settings target |
| `XML Doc Color: Copy Theme Customization JSON` | Copies the current scope's semantic-token rules to the clipboard |
| `XML Doc Color: Open Theme Customization Snippet` | Opens a ready-to-edit JSON snippet in a new editor |

---

## Links

- [GitHub Repository](https://github.com/Sato-Isolated/xml-doc-color)
- [Report an Issue](https://github.com/Sato-Isolated/xml-doc-color/issues)
- [Changelog](https://github.com/Sato-Isolated/xml-doc-color/blob/main/CHANGELOG.md)

---

Made by [MindLated](https://github.com/Sato-Isolated)
