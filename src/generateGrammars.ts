import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
    getTokenScope,
    LANGUAGE_DEFINITIONS,
    LanguageDefinition,
    TokenKey,
} from './model';

/**
 * Build-time TextMate grammar generator.
 *
 * Keeping patterns here instead of maintaining ten JSON files by hand makes
 * scope names, precedence, and token coverage identical across languages.
*/

type CaptureMap = Record<string, { name: string }>;

interface GrammarPattern {
    name?: string;
    contentName?: string;
    match?: string;
    begin?: string;
    end?: string;
    while?: string;
    captures?: CaptureMap;
    beginCaptures?: CaptureMap;
    endCaptures?: CaptureMap;
    whileCaptures?: CaptureMap;
    patterns?: GrammarPattern[];
    include?: string;
}

interface InjectionGrammar {
    scopeName: string;
    injectionSelector: string;
    patterns: GrammarPattern[];
    repository: Record<string, GrammarPattern>;
}

function capture(name: string): { name: string } {
    return { name };
}

function scope(language: LanguageDefinition, token: TokenKey): string {
    return getTokenScope(token, language.id);
}

function documentationPatterns(
    language: LanguageDefinition,
    strategy: 'line' | 'native-block' | 'owned-block' = language.documentationStyle === 'line' ? 'line' : 'native-block',
): GrammarPattern[] {
    const tagDelimiter = scope(language, 'xmlDocTagDelimiter');
    const tagName = scope(language, 'xmlDocTagName');
    const attribute = scope(language, 'xmlDocAttribute');
    const attributeValue = scope(language, 'xmlDocAttributeValue');
    const reference = scope(language, 'xmlDocReferenceValue');
    const text = scope(language, 'xmlDocText');

    const referenceAttribute: GrammarPattern = {
        match: '\\b(cref|name|href|langword|path|file)(\\s*=\\s*)("[^"]*"|\'[^\']*\')',
        captures: {
            '1': capture(attribute),
            '2': capture(tagDelimiter),
            '3': capture(reference),
        },
    };
    const regularAttribute: GrammarPattern = {
        match: '\\b([A-Za-z_][\\w:.-]*)(\\s*=\\s*)("[^"]*"|\'[^\']*\')',
        captures: {
            '1': capture(attribute),
            '2': capture(tagDelimiter),
            '3': capture(attributeValue),
        },
    };

    const lineTagPatterns: GrammarPattern[] = [
        {
            begin: '(</)([A-Za-z][\\w:.-]*)',
            beginCaptures: {
                '1': capture(tagDelimiter),
                '2': capture(tagName),
            },
            end: '(>)',
            endCaptures: { '1': capture(tagDelimiter) },
        },
        {
            begin: '(?<![A-Za-z0-9_$])(<)([A-Za-z][\\w:.-]*)',
            beginCaptures: {
                '1': capture(tagDelimiter),
                '2': capture(tagName),
            },
            end: '(/?>)',
            endCaptures: { '1': capture(tagDelimiter) },
            patterns: [
                referenceAttribute,
                regularAttribute,
                { match: '&(?:#x?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]+);', name: scope(language, 'xmlDocEntity') },
            ],
        },
    ];

    // Block injections live inside native Javadoc/JSDoc tokenization. Their
    // patterns must be flat: a native sub-rule can end an injected begin/end
    // rule before the XML tag itself ends.
    const blockReferenceAttribute: GrammarPattern = {
        match: '(\\s+)(cref|name|href|langword|path|file)(\\s*=\\s*)("[^"]*"|\'[^\']*\')',
        captures: {
            '2': capture(attribute),
            '3': capture(tagDelimiter),
            '4': capture(reference),
        },
    };
    const blockRegularAttribute: GrammarPattern = {
        match: '(\\s+)([A-Za-z_][\\w:.-]*)(\\s*=\\s*)("[^"]*"|\'[^\']*\')',
        captures: {
            '2': capture(attribute),
            '3': capture(tagDelimiter),
            '4': capture(attributeValue),
        },
    };
    const blockTagPatterns: GrammarPattern[] = [
        {
            match: '(</)([A-Za-z][\\w:.-]*)(>)',
            captures: {
                '1': capture(tagDelimiter),
                '2': capture(tagName),
                '3': capture(tagDelimiter),
            },
        },
        {
            match: '(?<![A-Za-z0-9_$])(<)([A-Za-z][\\w:.-]*)(/?>)',
            captures: {
                '1': capture(tagDelimiter),
                '2': capture(tagName),
                '3': capture(tagDelimiter),
            },
        },
        {
            match: '(?<![A-Za-z0-9_$])(<)([A-Za-z][\\w:.-]*)(?=\\s+[A-Za-z_])',
            captures: {
                '1': capture(tagDelimiter),
                '2': capture(tagName),
            },
        },
        blockReferenceAttribute,
        blockRegularAttribute,
        {
            match: '(?<=["\'])(\\s*)(/?>)',
            captures: { '2': capture(tagDelimiter) },
        },
    ];
    const usesStatefulPatterns = strategy !== 'native-block';
    const tagPatterns = usesStatefulPatterns
        ? lineTagPatterns
        : blockTagPatterns;
    const textPattern = strategy === 'line'
        ? '(?:[^<&@{]+|<(?!/?[A-Za-z!])|@(?![A-Za-z])|&(?!#x?[0-9A-Fa-f]+;|[A-Za-z][A-Za-z0-9]+;)|\\{(?!@))+'
        : '(?:[^<&@{*]+|\\*(?!/)|<(?!/?[A-Za-z!])|@(?![A-Za-z])|&(?!#x?[0-9A-Fa-f]+;|[A-Za-z][A-Za-z0-9]+;)|\\{(?!@))+';

    const xmlCommentPatterns: GrammarPattern[] = usesStatefulPatterns
        ? [{
            begin: '(<!--)',
            beginCaptures: { '1': capture(tagDelimiter) },
            end: '(-->)',
            endCaptures: { '1': capture(tagDelimiter) },
            contentName: text,
        }]
        : [
            {
                match: '(<!--)(.*?)(-->)',
                captures: {
                    '1': capture(tagDelimiter),
                    '2': capture(text),
                    '3': capture(tagDelimiter),
                },
            },
            { match: '<!--|-->', name: tagDelimiter },
        ];
    const cdataPatterns: GrammarPattern[] = usesStatefulPatterns
        ? [{
            begin: '(<!\\[CDATA\\[)',
            beginCaptures: { '1': capture(scope(language, 'xmlDocCDataDelimiter')) },
            end: '(\\]\\]>)',
            endCaptures: { '1': capture(scope(language, 'xmlDocCDataDelimiter')) },
            contentName: scope(language, 'xmlDocCDataText'),
        }]
        : [
            {
                match: '(<!\\[CDATA\\[)(.*?)(\\]\\]>)',
                captures: {
                    '1': capture(scope(language, 'xmlDocCDataDelimiter')),
                    '2': capture(scope(language, 'xmlDocCDataText')),
                    '3': capture(scope(language, 'xmlDocCDataDelimiter')),
                },
            },
            { match: '<!\\[CDATA\\[|\\]\\]>', name: scope(language, 'xmlDocCDataDelimiter') },
        ];
    const inlinePatterns: GrammarPattern[] = usesStatefulPatterns
        ? [{
            begin: '(\\{)(@[A-Za-z][\\w:-]*)\\b',
            beginCaptures: {
                '1': capture(scope(language, 'xmlDocInlineDelimiter')),
                '2': capture(scope(language, 'xmlDocAtTag')),
            },
            end: '(\\})',
            endCaptures: { '1': capture(scope(language, 'xmlDocInlineDelimiter')) },
            contentName: reference,
            patterns: [
                { match: '&(?:#x?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]+);', name: scope(language, 'xmlDocEntity') },
            ],
        }]
        : [{
            match: '(\\{)(@[A-Za-z][\\w:-]*)\\b(\\s*)([^}]*)(\\})',
            captures: {
                '1': capture(scope(language, 'xmlDocInlineDelimiter')),
                '2': capture(scope(language, 'xmlDocAtTag')),
                '4': capture(reference),
                '5': capture(scope(language, 'xmlDocInlineDelimiter')),
            },
        }];

    return [
        ...xmlCommentPatterns,
        ...cdataPatterns,
        ...inlinePatterns,
        ...tagPatterns,
        { match: '&(?:#x?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]+);', name: scope(language, 'xmlDocEntity') },
        {
            match: '(?<![\\w.+-])@[A-Za-z][\\w:-]*\\b',
            name: scope(language, 'xmlDocAtTag'),
        },
        {
            match: textPattern,
            name: text,
        },
    ];
}

/**
 * Creates a stateful `begin`/`while` injection for /// and ''' documentation.
 * TextMate carries the rule stack between lines, allowing XML/CDATA constructs
 * to span consecutive documentation lines without a runtime parser.
 */
function createLineGrammar(language: LanguageDefinition): InjectionGrammar {
    const prefix = language.linePrefix?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!prefix) {
        throw new Error(`Missing line prefix for ${language.id}`);
    }

    return {
        scopeName: `xml-doc-color.${language.id}.injection`,
        injectionSelector: language.sourceScopes.map((sourceScope) => `L:${sourceScope}`).join(', '),
        patterns: [{ include: '#documentation-run' }],
        repository: {
            'documentation-run': {
                begin: `^(\\s*)(${prefix})(?!${prefix[0]})\\s?`,
                beginCaptures: { '2': capture(scope(language, 'xmlDocLinePrefix')) },
                while: `^(\\s*)(${prefix})(?!${prefix[0]})\\s?`,
                whileCaptures: { '2': capture(scope(language, 'xmlDocLinePrefix')) },
                contentName: scope(language, 'xmlDocText'),
                patterns: documentationPatterns(language),
            },
        },
    };
}

/**
 * Creates an injection constrained to native documentation-comment scopes.
 * The `L:` selector gives XML Doc Color precedence inside Javadoc/JSDoc/etc.
 * without matching ordinary block comments, strings, or JSX markup.
 */
function createBlockGrammar(language: LanguageDefinition): InjectionGrammar {
    const selectors = language.documentationScopes ?? [];
    return {
        scopeName: `xml-doc-color.${language.id}.injection`,
        injectionSelector: selectors.map((selector) => `L:${selector}`).join(', '),
        patterns: [
            {
                // Do not consume the `*` in `*/`; the native grammar must see
                // its own closing delimiter to leave documentation-comment state.
                match: '^\\s*(\\*)(?!/)\\s?',
                captures: { '1': capture(scope(language, 'xmlDocLinePrefix')) },
            },
            ...documentationPatterns(language),
        ],
        repository: {},
    };
}

/** Builds the complete injection grammar for one canonical language entry. */
export function createGrammar(language: LanguageDefinition): InjectionGrammar {
    return language.documentationStyle === 'line'
        ? createLineGrammar(language)
        : createBlockGrammar(language);
}

/**
 * Builds the root-level grammar that owns non-documentation block comments
 * without intercepting the exact `/**` documentation opener, strings,
 * templates, or regular expressions. Openers with three or more stars are
 * treated like ordinary blocks because native doc grammars do not own them
 * consistently across the supported languages.
 */
export function createRegularBlockGrammar(language: LanguageDefinition): InjectionGrammar | undefined {
    const selectors = language.regularBlockSelectors;
    if (!selectors?.length) {
        return undefined;
    }

    return {
        scopeName: `xml-doc-color.${language.id}.regular-block.injection`,
        injectionSelector: selectors
            .map((selector) => `L:${selector} -comment -string`)
            .join(', '),
        patterns: [{ include: '#regular-block' }],
        repository: {
            'regular-block': {
                // Capture the complete owned opener while leaving the final
                // star available to close compact forms such as `/***/`.
                // Exactly one extra star is `/**` and stays native.
                begin: '(/\\*(?:(?!\\*)|(?=\\*{2,})(?:\\*(?!/))*))',
                beginCaptures: { '1': capture(scope(language, 'xmlDocBlockDelimiter')) },
                end: '(\\*/)',
                endCaptures: { '1': capture(scope(language, 'xmlDocBlockDelimiter')) },
                name: `comment.block.xml-doc-color.${language.id}`,
                contentName: scope(language, 'xmlDocText'),
                patterns: [
                    {
                        match: '^\\s*(\\*)(?!/)\\s?',
                        captures: { '1': capture(scope(language, 'xmlDocLinePrefix')) },
                    },
                    ...documentationPatterns(language, 'owned-block'),
                ],
            },
        },
    };
}

/** Regenerates all seventeen deterministic `.tmLanguage.json` build artifacts. */
export async function generateGrammars(outputDirectory: string): Promise<void> {
    await mkdir(outputDirectory, { recursive: true });
    const writes = LANGUAGE_DEFINITIONS.flatMap((language) => {
        const documentationGrammar = createGrammar(language);
        const regularBlockGrammar = createRegularBlockGrammar(language);
        return [
            writeFile(
                join(outputDirectory, `${language.id}.tmLanguage.json`),
                `${JSON.stringify(documentationGrammar, null, 2)}\n`,
                'utf8',
            ),
            ...(regularBlockGrammar ? [writeFile(
                join(outputDirectory, `${language.id}.block.tmLanguage.json`),
                `${JSON.stringify(regularBlockGrammar, null, 2)}\n`,
                'utf8',
            )] : []),
        ];
    });
    await Promise.all(writes);
}

if (require.main === module) {
    void generateGrammars(join(process.cwd(), 'dist', 'syntaxes'));
}
