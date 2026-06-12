import * as vscode from 'vscode';

export type DocStyle = 'xml' | 'atTag' | 'both';

export interface PreviewLine {
    prefix: string;
    text: string;
    html: string;
}

export type PreviewTokenKey =
    | 'xmlDocTagName'
    | 'xmlDocTagDelimiter'
    | 'xmlDocAttribute'
    | 'xmlDocAttributeValue'
    | 'xmlDocAtTag'
    | 'xmlDocLinePrefix'
    | 'xmlDocText';

export interface PreviewConfig {
    usesAtTags: boolean;
    usedTokenKeys: readonly PreviewTokenKey[];
    lines: readonly PreviewLine[];
}

export interface LanguageOption {
    id: string;
    label: string;
}

export interface SidebarPreviewEntry extends PreviewConfig {
    id: string;
    label: string;
}

export interface SidebarPreviewData {
    options: readonly LanguageOption[];
    previews: Readonly<Record<string, SidebarPreviewEntry>>;
}

export interface LanguageConfig {
    selectorLabel: string;
    /** Regex that matches and consumes the doc line prefix (e.g. `///`, `'''`). */
    lineDocPrefix?: RegExp;
    /** Regex that matches `/**` anywhere on a line (used for block doc detection). */
    blockDocStart?: RegExp;
    /**
     * Regex that matches the leading ` * ` (or ` *`) on a block doc content line.
     * Captures nothing; the match length determines the content start column.
     */
    blockDocLine?: RegExp;
    /** What flavour of tags this language uses. */
    docStyle: DocStyle;
    /** Language-specific preview shown in the color picker sidebar. */
    preview: PreviewConfig;
}

type PreviewAttribute = readonly [name: string, value: string];

interface XmlTagOptions {
    closing?: boolean;
    selfClosing?: boolean;
}

function escapePreviewText(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function span(className: string, text: string): string {
    return `<span class="${className}">${escapePreviewText(text)}</span>`;
}

function xmlTag(name: string, attrs: readonly PreviewAttribute[] = [], options: XmlTagOptions = {}): string {
    if (options.closing) {
        return `${span('t-delim', '</')}${span('t-tagname', name)}${span('t-delim', '>')}`;
    }

    const renderedAttrs = attrs.map(([attrName, attrValue]) => (
        ` ${span('t-attr', attrName)}=${span('t-value', `"${attrValue}"`)}`
    )).join('');
    const endDelimiter = options.selfClosing ? '/>' : '>';
    return `${span('t-delim', '<')}${span('t-tagname', name)}${renderedAttrs}${span('t-delim', endDelimiter)}`;
}

function atTag(name: string): string {
    return span('t-attag', `@${name}`);
}

function inlineAtTag(name: string, target: string): string {
    return `{${atTag(name)} ${escapePreviewText(target)}}`;
}

function xmlElement(name: string, text: string, attrs: readonly PreviewAttribute[] = []): string {
    return `${xmlTag(name, attrs)}${escapePreviewText(text)}${xmlTag(name, [], { closing: true })}`;
}

function line(prefix: string, text: string, html = escapePreviewText(text)): PreviewLine {
    return { prefix, text, html };
}

function blankLine(prefix: string): PreviewLine {
    return { prefix, text: '', html: '' };
}

const PREVIEW_CLASS_TO_TOKEN_KEY: Readonly<Record<string, PreviewTokenKey>> = {
    't-tagname': 'xmlDocTagName',
    't-delim': 'xmlDocTagDelimiter',
    't-attr': 'xmlDocAttribute',
    't-value': 'xmlDocAttributeValue',
    't-attag': 'xmlDocAtTag',
    't-text': 'xmlDocText',
};

const PREVIEW_TOKEN_KEYS: readonly PreviewTokenKey[] = [
    'xmlDocTagName',
    'xmlDocTagDelimiter',
    'xmlDocAttribute',
    'xmlDocAttributeValue',
    'xmlDocAtTag',
    'xmlDocLinePrefix',
    'xmlDocText',
];

function collectUsedTokenKeys(lines: readonly PreviewLine[]): readonly PreviewTokenKey[] {
    const usedKeys = new Set<PreviewTokenKey>();

    // Any line with a prefix marker uses xmlDocLinePrefix
    if (lines.some((l) => l.prefix.trim())) {
        usedKeys.add('xmlDocLinePrefix');
    }
    // Any line with text content uses xmlDocText
    if (lines.some((l) => l.text.trim())) {
        usedKeys.add('xmlDocText');
    }

    for (const previewLine of lines) {
        for (const [className, tokenKey] of Object.entries(PREVIEW_CLASS_TO_TOKEN_KEY)) {
            if (previewLine.html.includes(`class="${className}"`)) {
                usedKeys.add(tokenKey);
            }
        }
    }

    return PREVIEW_TOKEN_KEYS.filter((tokenKey) => usedKeys.has(tokenKey));
}

function preview(usesAtTags: boolean, lines: readonly PreviewLine[]): PreviewConfig {
    return {
        usesAtTags,
        usedTokenKeys: collectUsedTokenKeys(lines),
        lines,
    };
}

const ALL_LANGUAGES_PREVIEW = preview(true, [
        line('/// ', '<summary>', xmlTag('summary')),
        line(
            '/// ',
            'Colors <paramref name="source"/> docs in C#, VB.NET, and F#.',
            `Colors ${xmlTag('paramref', [['name', 'source']], { selfClosing: true })} docs in C#, VB.NET, and F#.`,
        ),
        line('/// ', '</summary>', xmlTag('summary', [], { closing: true })),
        blankLine(''),
        line('/**', ''),
        line(
            ' * ',
            'See <a href="#api">docs</a> for details.',
            `See ${xmlElement('a', 'docs', [['href', '#api']])} for details.`,
        ),
        line(' * ', '@param source Input sequence', `${atTag('param')} source Input sequence`),
        line(' * ', '@return Result', `${atTag('return')} Result`),
        line(' */', ''),
    ]);

export const LANGUAGE_CONFIGS: Readonly<Record<string, LanguageConfig>> = {
    csharp: {
        selectorLabel: 'C# (///)',
        lineDocPrefix: /^\s*\/\/\/\s?/,
        docStyle: 'xml',
        preview: preview(false, [
                line('/// ', '<summary>', xmlTag('summary')),
                line(
                    '/// ',
                    'Computes <see cref="Result"/> for the given <paramref name="source"/>.',
                    `Computes ${xmlTag('see', [['cref', 'Result']], { selfClosing: true })} for the given ${xmlTag('paramref', [['name', 'source']], { selfClosing: true })}.`,
                ),
                line('/// ', '</summary>', xmlTag('summary', [], { closing: true })),
                line(
                    '/// ',
                    '<typeparam name="T">Element type.</typeparam>',
                    `${xmlTag('typeparam', [['name', 'T']])}Element type.${xmlTag('typeparam', [], { closing: true })}`,
                ),
                line(
                    '/// ',
                    '<param name="source">Input sequence.</param>',
                    `${xmlTag('param', [['name', 'source']])}Input sequence.${xmlTag('param', [], { closing: true })}`,
                ),
                line(
                    '/// ',
                    '<param name="count">Maximum items.</param>',
                    `${xmlTag('param', [['name', 'count']])}Maximum items.${xmlTag('param', [], { closing: true })}`,
                ),
                line(
                    '/// ',
                    '<returns>The <see cref="Result"/>.</returns>',
                    `${xmlTag('returns')}The ${xmlTag('see', [['cref', 'Result']], { selfClosing: true })}.${xmlTag('returns', [], { closing: true })}`,
                ),
                line(
                    '/// ',
                    '<exception cref="ArgumentNullException">When <paramref name="source"/> is null.</exception>',
                    `${xmlTag('exception', [['cref', 'ArgumentNullException']])}When ${xmlTag('paramref', [['name', 'source']], { selfClosing: true })} is null.${xmlTag('exception', [], { closing: true })}`,
                ),
            ]),
    },
    vb: {
        selectorLabel: "VB.NET (''')",
        lineDocPrefix: /^\s*'''\s?/,
        docStyle: 'xml',
        preview: preview(false, [
                line("''' ", '<summary>', xmlTag('summary')),
                line(
                    "''' ",
                    'Builds the <see cref="Result"/> value from <paramref name="source"/>.',
                    `Builds the ${xmlTag('see', [['cref', 'Result']], { selfClosing: true })} value from ${xmlTag('paramref', [['name', 'source']], { selfClosing: true })}.`,
                ),
                line("''' ", '</summary>', xmlTag('summary', [], { closing: true })),
                line(
                    "''' ",
                    '<typeparam name="T">Element type.</typeparam>',
                    `${xmlTag('typeparam', [['name', 'T']])}Element type.${xmlTag('typeparam', [], { closing: true })}`,
                ),
                line(
                    "''' ",
                    '<param name="source">Input sequence.</param>',
                    `${xmlTag('param', [['name', 'source']])}Input sequence.${xmlTag('param', [], { closing: true })}`,
                ),
                line(
                    "''' ",
                    '<returns>The computed value.</returns>',
                    `${xmlTag('returns')}The computed value.${xmlTag('returns', [], { closing: true })}`,
                ),
                line(
                    "''' ",
                    '<exception cref="ArgumentNullException">When <paramref name="source"/> is Nothing.</exception>',
                    `${xmlTag('exception', [['cref', 'ArgumentNullException']])}When ${xmlTag('paramref', [['name', 'source']], { selfClosing: true })} is Nothing.${xmlTag('exception', [], { closing: true })}`,
                ),
            ]),
    },
    fsharp: {
        selectorLabel: 'F# (///)',
        lineDocPrefix: /^\s*\/\/\/\s?/,
        docStyle: 'xml',
        preview: preview(false, [
                line('/// ', '<summary>', xmlTag('summary')),
                line(
                    '/// ',
                    'Builds a <see cref="Result"/> from <paramref name="source"/>.',
                    `Builds a ${xmlTag('see', [['cref', 'Result']], { selfClosing: true })} from ${xmlTag('paramref', [['name', 'source']], { selfClosing: true })}.`,
                ),
                line('/// ', '</summary>', xmlTag('summary', [], { closing: true })),
                line(
                    '/// ',
                    '<typeparam name="\'T">Element type.</typeparam>',
                    `${xmlTag('typeparam', [["name", "'T"]])}Element type.${xmlTag('typeparam', [], { closing: true })}`,
                ),
                line(
                    '/// ',
                    '<param name="source">Input sequence.</param>',
                    `${xmlTag('param', [['name', 'source']])}Input sequence.${xmlTag('param', [], { closing: true })}`,
                ),
                line(
                    '/// ',
                    '<returns>The computed result.</returns>',
                    `${xmlTag('returns')}The computed result.${xmlTag('returns', [], { closing: true })}`,
                ),
            ]),
    },
    java: {
        selectorLabel: 'Java (/** */)',
        blockDocStart: /\/\*\*/,
        blockDocLine: /^\s*\*\s?/,
        docStyle: 'both',
        preview: preview(true, [
                line('/**', ''),
                line(
                    ' * ',
                    'Computes a <code>Result</code> for the given source.',
                    `Computes a ${xmlTag('code')}Result${xmlTag('code', [], { closing: true })} for the given source.`,
                ),
                line(
                    ' * ',
                    'Use <a href="#options">Options</a> to customize the operation.',
                    `Use ${xmlElement('a', 'Options', [['href', '#options']])} to customize the operation.`,
                ),
                blankLine(' *'),
                line(' * ', '@param <T> element type', `${atTag('param')} ${xmlTag('T')}element type`),
                line(' * ', '@param source input sequence', `${atTag('param')} source input sequence`),
                line(' * ', '@param count maximum items', `${atTag('param')} count maximum items`),
                line(' * ', '@return computed result', `${atTag('return')} computed result`),
                line(
                    ' * ',
                    '@throws IllegalArgumentException when source is null',
                    `${atTag('throws')} IllegalArgumentException when source is null`,
                ),
                line(' */', ''),
            ]),
    },
    typescript: {
        selectorLabel: 'TypeScript (/** */)',
        blockDocStart: /\/\*\*/,
        blockDocLine: /^\s*\*\s?/,
        docStyle: 'both',
        preview: preview(true, [
                line('/**', ''),
                line(
                    ' * ',
                    'Builds a {@link Result} from the provided source.',
                    `Builds a ${inlineAtTag('link', 'Result')} from the provided source.`,
                ),
                line(
                    ' * ',
                    'Use <a href="#options">Options</a> to cap the <code>count</code> limit.',
                    `Use ${xmlElement('a', 'Options', [['href', '#options']])} to cap the ${xmlElement('code', 'count')} limit.`,
                ),
                blankLine(' *'),
                line(' * ', '@typeParam T - Element type', `${atTag('typeParam')} T - Element type`),
                line(' * ', '@param source - Input sequence', `${atTag('param')} source - Input sequence`),
                line(' * ', '@param count - Maximum items to read', `${atTag('param')} count - Maximum items to read`),
                line(' * ', '@returns The computed {@link Result}', `${atTag('returns')} The computed ${inlineAtTag('link', 'Result')}`),
                line(' * ', '@throws Error When source is null', `${atTag('throws')} Error When source is null`),
                line(' */', ''),
            ]),
    },
    javascript: {
        selectorLabel: 'JavaScript (/** */)',
        blockDocStart: /\/\*\*/,
        blockDocLine: /^\s*\*\s?/,
        docStyle: 'both',
        preview: preview(true, [
                line('/**', ''),
                line(' * ', 'Computes a result for the provided source.'),
                line(
                    ' * ',
                    'See <a href="#options">Options</a> for {@link Result} examples.',
                    `See ${xmlElement('a', 'Options', [['href', '#options']])} for ${inlineAtTag('link', 'Result')} examples.`,
                ),
                blankLine(' *'),
                line(' * ', '@template T', `${atTag('template')} T`),
                line(' * ', '@param {T[]} source Input sequence', `${atTag('param')} {T[]} source Input sequence`),
                line(' * ', '@param {number} count Maximum items to read', `${atTag('param')} {number} count Maximum items to read`),
                line(' * ', '@returns {Result} Computed result', `${atTag('returns')} {Result} Computed result`),
                line(' * ', '@throws {TypeError} When source is null', `${atTag('throws')} {TypeError} When source is null`),
                line(' */', ''),
            ]),
    },
    typescriptreact: {
        selectorLabel: 'TSX (/** */)',
        blockDocStart: /\/\*\*/,
        blockDocLine: /^\s*\*\s?/,
        docStyle: 'both',
        preview: preview(true, [
                line('/**', ''),
                line(
                    ' * ',
                    'Builds a {@link Result} from the provided source.',
                    `Builds a ${inlineAtTag('link', 'Result')} from the provided source.`,
                ),
                line(
                    ' * ',
                    'Use <a href="#options">Options</a> to cap the <code>count</code> limit.',
                    `Use ${xmlElement('a', 'Options', [['href', '#options']])} to cap the ${xmlElement('code', 'count')} limit.`,
                ),
                blankLine(' *'),
                line(' * ', '@typeParam T - Element type', `${atTag('typeParam')} T - Element type`),
                line(' * ', '@param source - Input sequence', `${atTag('param')} source - Input sequence`),
                line(' * ', '@param count - Maximum items to read', `${atTag('param')} count - Maximum items to read`),
                line(' * ', '@returns The computed {@link Result}', `${atTag('returns')} The computed ${inlineAtTag('link', 'Result')}`),
                line(' * ', '@throws Error When source is null', `${atTag('throws')} Error When source is null`),
                line(' */', ''),
            ]),
    },
    javascriptreact: {
        selectorLabel: 'JSX (/** */)',
        blockDocStart: /\/\*\*/,
        blockDocLine: /^\s*\*\s?/,
        docStyle: 'both',
        preview: preview(true, [
                line('/**', ''),
                line(' * ', 'Computes a result for the provided source.'),
                line(
                    ' * ',
                    'See <a href="#options">Options</a> for {@link Result} examples.',
                    `See ${xmlElement('a', 'Options', [['href', '#options']])} for ${inlineAtTag('link', 'Result')} examples.`,
                ),
                blankLine(' *'),
                line(' * ', '@template T', `${atTag('template')} T`),
                line(' * ', '@param {T[]} source Input sequence', `${atTag('param')} {T[]} source Input sequence`),
                line(' * ', '@param {number} count Maximum items to read', `${atTag('param')} {number} count Maximum items to read`),
                line(' * ', '@returns {Result} Computed result', `${atTag('returns')} {Result} Computed result`),
                line(' * ', '@throws {TypeError} When source is null', `${atTag('throws')} {TypeError} When source is null`),
                line(' */', ''),
            ]),
    },
    php: {
        selectorLabel: 'PHP (/** */)',
        blockDocStart: /\/\*\*/,
        blockDocLine: /^\s*\*\s?/,
        docStyle: 'both',
        preview: preview(true, [
                line('/**', ''),
                line(' * ', 'Computes a result for the provided source.'),
                line(
                    ' * ',
                    'See <a href="#options">Options</a> for {@see Result} details.',
                    `See ${xmlElement('a', 'Options', [['href', '#options']])} for ${inlineAtTag('see', 'Result')} details.`,
                ),
                blankLine(' *'),
                line(' * ', '@template T', `${atTag('template')} T`),
                line(' * ', '@param list<T> $source Input sequence', `${atTag('param')} list&lt;T&gt; $source Input sequence`),
                line(' * ', '@param int $count Maximum items to read', `${atTag('param')} int $count Maximum items to read`),
                line(' * ', '@return Result<T>', `${atTag('return')} Result&lt;T&gt;`),
                line(
                    ' * ',
                    '@throws InvalidArgumentException When $source is null',
                    `${atTag('throws')} InvalidArgumentException When $source is null`,
                ),
                line(' */', ''),
            ]),
    },
    kotlin: {
        selectorLabel: 'Kotlin (/** */)',
        blockDocStart: /\/\*\*/,
        blockDocLine: /^\s*\*\s?/,
        docStyle: 'both',
        preview: preview(true, [
                line('/**', ''),
                line(
                    ' * ',
                    'Computes a <code>Result</code> from the provided source.',
                    `Computes a ${xmlTag('code')}Result${xmlTag('code', [], { closing: true })} from the provided source.`,
                ),
                line(
                    ' * ',
                    'See <a href="#options">Options</a> before returning <code>Result</code>.',
                    `See ${xmlElement('a', 'Options', [['href', '#options']])} before returning ${xmlElement('code', 'Result')}.`,
                ),
                blankLine(' *'),
                line(' * ', '@param T element type', `${atTag('param')} T element type`),
                line(' * ', '@param source input sequence', `${atTag('param')} source input sequence`),
                line(' * ', '@param count maximum items to read', `${atTag('param')} count maximum items to read`),
                line(' * ', '@return computed result', `${atTag('return')} computed result`),
                line(' * ', '@throws IllegalArgumentException when source is null', `${atTag('throws')} IllegalArgumentException when source is null`),
                line(' * ', '@see Options', `${atTag('see')} Options`),
                line(' */', ''),
            ]),
    },
};

export const SUPPORTED_LANGUAGES: readonly string[] = Object.keys(LANGUAGE_CONFIGS);

export function getSidebarPreviewData(): SidebarPreviewData {
    const options: LanguageOption[] = [
        { id: '*', label: 'All Languages' },
        ...SUPPORTED_LANGUAGES.map((languageId) => ({
            id: languageId,
            label: LANGUAGE_CONFIGS[languageId].selectorLabel,
        })),
    ];

    const previews = SUPPORTED_LANGUAGES.reduce<Record<string, SidebarPreviewEntry>>((result, languageId) => {
        const config = LANGUAGE_CONFIGS[languageId];
        result[languageId] = {
            id: languageId,
            label: config.selectorLabel,
            usesAtTags: config.preview.usesAtTags,
            usedTokenKeys: config.preview.usedTokenKeys,
            lines: config.preview.lines,
        };
        return result;
    }, {
        '*': {
            id: '*',
            label: 'All Languages',
            usesAtTags: ALL_LANGUAGES_PREVIEW.usesAtTags,
            usedTokenKeys: ALL_LANGUAGES_PREVIEW.usedTokenKeys,
            lines: ALL_LANGUAGES_PREVIEW.lines,
        },
    });

    return { options, previews };
}

export function getEnabledLanguages(): readonly string[] {
    const configured = vscode.workspace.getConfiguration('xmlDocColor').get<readonly string[]>(
        'enabledLanguages',
        SUPPORTED_LANGUAGES,
    );

    if (!configured || configured.length === 0) {
        return [];
    }

    const normalized = configured.filter((language) => SUPPORTED_LANGUAGES.includes(language));
    return normalized.length > 0 ? normalized : SUPPORTED_LANGUAGES;
}
