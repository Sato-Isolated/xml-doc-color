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

export const DARK_PRESET_COLORS: DocColors = {
    xmlDocTagName:        '#4EC9B0',
    xmlDocTagDelimiter:   '#6D8B6D',
    xmlDocAttribute:      '#9CDCFE',
    xmlDocAttributeValue: '#CE9178',
    xmlDocAtTag:          '#C586C0',
    xmlDocLinePrefix:     '#6A9955',
    xmlDocText:           '#D4D4D4',
};

export const LIGHT_PRESET_COLORS: DocColors = {
    xmlDocTagName:        '#0F766E',
    xmlDocTagDelimiter:   '#4D7C0F',
    xmlDocAttribute:      '#1D4ED8',
    xmlDocAttributeValue: '#B45309',
    xmlDocAtTag:          '#9333EA',
    xmlDocLinePrefix:     '#15803D',
    xmlDocText:           '#111827',
};

export const DEFAULT_COLORS: DocColors = DARK_PRESET_COLORS;

export const DOC_COLOR_KEYS: ReadonlyArray<keyof DocColors> = [
    'xmlDocTagName', 'xmlDocTagDelimiter', 'xmlDocAttribute',
    'xmlDocAttributeValue', 'xmlDocAtTag', 'xmlDocLinePrefix', 'xmlDocText',
];

export type ConfigurationTargetSetting = 'global' | 'workspace';

export interface ResolvedColors {
    colors: DocColors;
    overrides: Record<keyof DocColors, boolean>;
}

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

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const BOLD_COLOR_KEYS = new Set<keyof DocColors>(['xmlDocTagName', 'xmlDocAtTag']);

function validateColors(colors: DocColors): void {
    for (const key of DOC_COLOR_KEYS) {
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
    return readResolvedColors(language).colors;
}

export function readResolvedColors(language = '*'): ResolvedColors {
    const config        = vscode.workspace.getConfiguration('editor');
    const customization = config.get<Record<string, unknown>>('semanticTokenColorCustomizations') ?? {};
    const rules         = (customization['rules'] as Record<string, unknown> | undefined) ?? {};

    function getColor(token: keyof DocColors): { color: string; override: boolean } {
        if (language !== '*') {
            const langHex = extractHex(rules[`${token}:${language}`]);
            if (langHex) {
                return { color: langHex, override: true };
            }
        }
        const globalHex = extractHex(rules[token]);
        if (globalHex) {
            return { color: globalHex, override: true };
        }
        return { color: DEFAULT_COLORS[token], override: false };
    }

    const tagName = getColor('xmlDocTagName');
    const tagDelimiter = getColor('xmlDocTagDelimiter');
    const attribute = getColor('xmlDocAttribute');
    const attributeValue = getColor('xmlDocAttributeValue');
    const atTag = getColor('xmlDocAtTag');
    const linePrefix = getColor('xmlDocLinePrefix');
    const text = getColor('xmlDocText');

    return {
        colors: {
            xmlDocTagName:        tagName.color,
            xmlDocTagDelimiter:   tagDelimiter.color,
            xmlDocAttribute:      attribute.color,
            xmlDocAttributeValue: attributeValue.color,
            xmlDocAtTag:          atTag.color,
            xmlDocLinePrefix:     linePrefix.color,
            xmlDocText:           text.color,
        },
        overrides: {
            xmlDocTagName:        tagName.override,
            xmlDocTagDelimiter:   tagDelimiter.override,
            xmlDocAttribute:      attribute.override,
            xmlDocAttributeValue: attributeValue.override,
            xmlDocAtTag:          atTag.override,
            xmlDocLinePrefix:     linePrefix.override,
            xmlDocText:           text.override,
        },
    };
}

export function getConfigurationTarget(): vscode.ConfigurationTarget {
    const target = vscode.workspace.getConfiguration('xmlDocColor').get<ConfigurationTargetSetting>(
        'configurationTarget',
        'global',
    );
    return target === 'workspace'
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
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
    for (const key of DOC_COLOR_KEYS) {
        const ruleKey = language === '*' ? key : `${key}:${language}`;
        newEntries[ruleKey] = createRule(key, colors[key]);
    }

    const merged = {
        ...existing,
        rules: { ...existingRules, ...newEntries },
    };

    await config.update('semanticTokenColorCustomizations', merged, getConfigurationTarget());
}

/** Remove XML doc color overrides for the given language scope. */
export async function resetColors(language = '*'): Promise<void> {
    const config        = vscode.workspace.getConfiguration('editor');
    const existing      = config.get<Record<string, unknown>>('semanticTokenColorCustomizations') ?? {};
    const existingRules = (existing['rules'] as Record<string, unknown> | undefined) ?? {};
    const nextRules = { ...existingRules };

    for (const key of DOC_COLOR_KEYS) {
        const ruleKey = language === '*' ? key : `${key}:${language}`;
        delete nextRules[ruleKey];
    }

    const merged = {
        ...existing,
        rules: nextRules,
    };

    await config.update('semanticTokenColorCustomizations', merged, getConfigurationTarget());
}

export function getThemeCustomizationSnippet(colors: DocColors, language = '*'): string {
    const rules = DOC_COLOR_KEYS.reduce<Record<string, SemanticTokenColorRule>>((result, key) => {
        const ruleKey = language === '*' ? key : `${key}:${language}`;
        result[ruleKey] = createRule(key, colors[key]);
        return result;
    }, {});

    return JSON.stringify({
        'editor.semanticTokenColorCustomizations': {
            rules,
        },
    }, null, 2);
}
