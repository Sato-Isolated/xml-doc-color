import {
    getLanguageDefinition,
    LANGUAGE_DEFINITIONS,
    LanguageDefinition,
    SUPPORTED_LANGUAGES,
    TokenKey,
} from './model';

export { LANGUAGE_DEFINITIONS, LanguageDefinition, SUPPORTED_LANGUAGES };

/**
 * One escaped preview fragment. The webview renders these with `textContent`,
 * so documentation samples never become executable HTML.
 */
export interface PreviewSegment {
    text: string;
    token?: TokenKey;
}

export interface PreviewLine {
    segments: readonly PreviewSegment[];
}

export interface SidebarPreviewEntry {
    id: string;
    label: string;
    usedTokenKeys: readonly TokenKey[];
    lines: readonly PreviewLine[];
}

export interface LanguageOption {
    id: string;
    label: string;
}

export interface SidebarPreviewData {
    options: readonly LanguageOption[];
    previews: Readonly<Record<string, SidebarPreviewEntry>>;
}

const segment = (text: string, token?: TokenKey): PreviewSegment => ({ text, token });
const line = (...segments: PreviewSegment[]): PreviewLine => ({ segments });

function xmlTag(name: string, closing = false): PreviewSegment[] {
    return [
        segment(closing ? '</' : '<', 'xmlDocTagDelimiter'),
        segment(name, 'xmlDocTagName'),
        segment('>', 'xmlDocTagDelimiter'),
    ];
}

function xmlSelfClosingTag(name: string, attribute: string, value: string): PreviewSegment[] {
    return [
        segment('<', 'xmlDocTagDelimiter'),
        segment(name, 'xmlDocTagName'),
        segment(' '),
        segment(attribute, 'xmlDocAttribute'),
        segment('=', 'xmlDocTagDelimiter'),
        segment(`"${value}"`, 'xmlDocReferenceValue'),
        segment('/>', 'xmlDocTagDelimiter'),
    ];
}

function lineDocumentationPreview(definition: LanguageDefinition): readonly PreviewLine[] {
    const prefix = `${definition.linePrefix} `;
    return [
        line(segment(prefix, 'xmlDocLinePrefix'), ...xmlTag('summary')),
        line(
            segment(prefix, 'xmlDocLinePrefix'),
            segment('Builds ', 'xmlDocText'),
            ...xmlSelfClosingTag('see', 'cref', 'Result'),
            segment(' from source ', 'xmlDocText'),
            segment('&amp;', 'xmlDocEntity'),
            segment('.', 'xmlDocText'),
        ),
        line(segment(prefix, 'xmlDocLinePrefix'), ...xmlTag('summary', true)),
        line(
            segment(prefix, 'xmlDocLinePrefix'),
            segment('<![CDATA[', 'xmlDocCDataDelimiter'),
            segment('value < limit', 'xmlDocCDataText'),
            segment(']]>', 'xmlDocCDataDelimiter'),
        ),
        line(
            segment(prefix, 'xmlDocLinePrefix'),
            segment('<!--', 'xmlDocTagDelimiter'),
            segment(' generated docs ', 'xmlDocText'),
            segment('-->', 'xmlDocTagDelimiter'),
        ),
    ];
}

function blockDocumentationPreview(definition: LanguageDefinition): readonly PreviewLine[] {
    return [
        line(segment('/*', 'xmlDocBlockDelimiter')),
        line(
            segment(' * ', 'xmlDocLinePrefix'),
            segment('Regular block comments use the same palette.', 'xmlDocText'),
        ),
        line(segment(' '), segment('*/', 'xmlDocBlockDelimiter')),
        line(
            segment('/***', 'xmlDocBlockDelimiter'),
            segment(' Extra-star block comments are supported. ', 'xmlDocText'),
            segment('*/', 'xmlDocBlockDelimiter'),
        ),
        line(),
        // Exact `/** */` delimiters remain owned by the native documentation grammar.
        line(segment('/**')),
        line(
            segment(' * ', 'xmlDocLinePrefix'),
            segment('Builds ', 'xmlDocText'),
            segment('{', 'xmlDocInlineDelimiter'),
            segment('@link', 'xmlDocAtTag'),
            segment(' Result', 'xmlDocReferenceValue'),
            segment('}', 'xmlDocInlineDelimiter'),
            segment(' from source.', 'xmlDocText'),
        ),
        line(
            segment(' * ', 'xmlDocLinePrefix'),
            segment('<', 'xmlDocTagDelimiter'),
            segment('a', 'xmlDocTagName'),
            segment(' '),
            segment('href', 'xmlDocAttribute'),
            segment('=', 'xmlDocTagDelimiter'),
            segment('"#api"', 'xmlDocReferenceValue'),
            segment(' '),
            segment('title', 'xmlDocAttribute'),
            segment('=', 'xmlDocTagDelimiter'),
            segment('"Docs"', 'xmlDocAttributeValue'),
            segment('>', 'xmlDocTagDelimiter'),
            segment('API', 'xmlDocText'),
            ...xmlTag('a', true),
            segment(' ', 'xmlDocText'),
            segment('&amp;', 'xmlDocEntity'),
        ),
        line(
            segment(' * ', 'xmlDocLinePrefix'),
            segment('@param', 'xmlDocAtTag'),
            segment(' source Input value', 'xmlDocText'),
        ),
        line(
            segment(' * ', 'xmlDocLinePrefix'),
            segment('<![CDATA[', 'xmlDocCDataDelimiter'),
            segment('value < limit', 'xmlDocCDataText'),
            segment(']]>', 'xmlDocCDataDelimiter'),
        ),
        line(segment(' */')),
    ];
}

function usedTokens(lines: readonly PreviewLine[]): readonly TokenKey[] {
    const used = new Set<TokenKey>();
    for (const previewLine of lines) {
        for (const previewSegment of previewLine.segments) {
            if (previewSegment.token) {
                used.add(previewSegment.token);
            }
        }
    }
    return [...used];
}

function previewFor(definition: LanguageDefinition): SidebarPreviewEntry {
    const lines = definition.documentationStyle === 'line'
        ? lineDocumentationPreview(definition)
        : blockDocumentationPreview(definition);
    return {
        id: definition.id,
        label: definition.label,
        usedTokenKeys: usedTokens(lines),
        lines,
    };
}

/**
 * Builds serializable preview data from the same language/token model used by
 * grammar generation. The `*` entry intentionally demonstrates both comment
 * families and all thirteen token categories.
 */
export function getSidebarPreviewData(): SidebarPreviewData {
    const entries = LANGUAGE_DEFINITIONS.map(previewFor);
    const allLines = [
        ...lineDocumentationPreview(LANGUAGE_DEFINITIONS[0]),
        { segments: [] },
        ...blockDocumentationPreview(LANGUAGE_DEFINITIONS[3]),
    ];
    const previews: Record<string, SidebarPreviewEntry> = {
        '*': {
            id: '*',
            label: 'All Languages',
            usedTokenKeys: usedTokens(allLines),
            lines: allLines,
        },
    };
    for (const entry of entries) {
        previews[entry.id] = entry;
    }

    return {
        options: [
            { id: '*', label: 'All Languages' },
            ...LANGUAGE_DEFINITIONS.map(({ id, label }) => ({ id, label })),
        ],
        previews,
    };
}

/** Compatibility accessor for callers that previously queried enabled languages. */
export function getEnabledLanguages(): readonly string[] {
    return SUPPORTED_LANGUAGES;
}

/** Returns whether a VS Code language ID has a generated injection grammar. */
export function isSupportedLanguage(languageId: string): boolean {
    return !!getLanguageDefinition(languageId);
}
