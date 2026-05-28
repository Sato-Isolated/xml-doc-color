import * as vscode from 'vscode';

export interface DocColors {
    xmlDocTagName:        string;
    xmlDocTagDelimiter:   string;
    xmlDocAttribute:      string;
    xmlDocAttributeValue: string;
    xmlDocAtTag:          string;
    xmlDocLinePrefix:     string;
    xmlDocText:           string;
}

export const DEFAULT_COLORS: DocColors = {
    xmlDocTagName:        '#4EC9B0',
    xmlDocTagDelimiter:   '#6D8B6D',
    xmlDocAttribute:      '#9CDCFE',
    xmlDocAttributeValue: '#CE9178',
    xmlDocAtTag:          '#C586C0',
    xmlDocLinePrefix:     '#6A9955',
    xmlDocText:           '#D4D4D4',
};

type SemanticTokenColorRule = {
    foreground: string;
    bold?: boolean;
};

/** Extract a foreground hex string from a semantic token rule value (string or object). */
function extractHex(value: unknown): string | undefined {
    if (typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value)) {
        return value;
    }
    if (typeof value === 'object' && value !== null) {
        const fg = (value as { foreground?: unknown }).foreground;
        if (typeof fg === 'string' && /^#[0-9A-Fa-f]{6}$/.test(fg)) {
            return fg;
        }
    }
    return undefined;
}

const COLOR_KEYS: ReadonlyArray<keyof DocColors> = [
    'xmlDocTagName', 'xmlDocTagDelimiter', 'xmlDocAttribute',
    'xmlDocAttributeValue', 'xmlDocAtTag', 'xmlDocLinePrefix', 'xmlDocText',
];

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const BOLD_COLOR_KEYS = new Set<keyof DocColors>(['xmlDocTagName', 'xmlDocAtTag']);

function validateColors(colors: DocColors): void {
    for (const key of COLOR_KEYS) {
        if (!HEX_COLOR_RE.test(colors[key])) {
            throw new Error(`Invalid XML doc color for ${key}: ${colors[key]}`);
        }
    }
}

function createRule(key: keyof DocColors, foreground: string): SemanticTokenColorRule {
    return BOLD_COLOR_KEYS.has(key)
        ? { foreground, bold: true }
        : { foreground };
}

/**
 * Read the current XML doc colors from VS Code settings.
 * @param language  VS Code language ID (e.g. 'csharp') or '*' for all languages.
 */
export function readColors(language = '*'): DocColors {
    const config        = vscode.workspace.getConfiguration('editor');
    const customization = config.get<Record<string, unknown>>('semanticTokenColorCustomizations') ?? {};
    const rules         = (customization['rules'] as Record<string, unknown> | undefined) ?? {};

    function getColor(token: keyof DocColors): string {
        if (language !== '*') {
            const langHex = extractHex(rules[`${token}:${language}`]);
            if (langHex) { return langHex; }
        }
        return extractHex(rules[token]) ?? DEFAULT_COLORS[token];
    }

    return {
        xmlDocTagName:        getColor('xmlDocTagName'),
        xmlDocTagDelimiter:   getColor('xmlDocTagDelimiter'),
        xmlDocAttribute:      getColor('xmlDocAttribute'),
        xmlDocAttributeValue: getColor('xmlDocAttributeValue'),
        xmlDocAtTag:          getColor('xmlDocAtTag'),
        xmlDocLinePrefix:     getColor('xmlDocLinePrefix'),
        xmlDocText:           getColor('xmlDocText'),
    };
}

/**
 * Persist XML doc colors into VS Code settings for the given language scope.
 * @param colors    Colors to write.
 * @param language  VS Code language ID (e.g. 'csharp') or '*' for all languages.
 */
export async function writeColors(colors: DocColors, language = '*'): Promise<void> {
    validateColors(colors);

    const config        = vscode.workspace.getConfiguration('editor');
    const existing      = config.get<Record<string, unknown>>('semanticTokenColorCustomizations') ?? {};
    const existingRules = (existing['rules'] as Record<string, unknown> | undefined) ?? {};

    const newEntries: Record<string, SemanticTokenColorRule> = {};
    for (const key of COLOR_KEYS) {
        const ruleKey = language === '*' ? key : `${key}:${language}`;
        newEntries[ruleKey] = createRule(key, colors[key]);
    }

    const merged = {
        ...existing,
        rules: { ...existingRules, ...newEntries },
    };

    await config.update('semanticTokenColorCustomizations', merged, vscode.ConfigurationTarget.Global);
}

/** Remove XML doc color overrides for the given language scope. */
export async function resetColors(language = '*'): Promise<void> {
    const config        = vscode.workspace.getConfiguration('editor');
    const existing      = config.get<Record<string, unknown>>('semanticTokenColorCustomizations') ?? {};
    const existingRules = (existing['rules'] as Record<string, unknown> | undefined) ?? {};
    const nextRules = { ...existingRules };

    for (const key of COLOR_KEYS) {
        const ruleKey = language === '*' ? key : `${key}:${language}`;
        delete nextRules[ruleKey];
    }

    const merged = {
        ...existing,
        rules: nextRules,
    };

    await config.update('semanticTokenColorCustomizations', merged, vscode.ConfigurationTarget.Global);
}
