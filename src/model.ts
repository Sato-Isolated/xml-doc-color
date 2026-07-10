/** Languages whose root grammars allow XML Doc Color to own regular blocks. */
export const REGULAR_BLOCK_LANGUAGE_IDS = [
    'java',
    'typescript',
    'typescriptreact',
    'javascript',
    'javascriptreact',
    'php',
    'kotlin',
] as const;

/**
 * Stable identifiers for every independently colorable documentation fragment.
 *
 * These keys are persisted in rule names and are therefore part of the settings
 * migration contract. Renaming one requires an explicit migration.
 */
export const TOKEN_KEYS = [
    'xmlDocTagName',
    'xmlDocTagDelimiter',
    'xmlDocAttribute',
    'xmlDocAttributeValue',
    'xmlDocEntity',
    'xmlDocCDataDelimiter',
    'xmlDocCDataText',
    'xmlDocInlineDelimiter',
    'xmlDocReferenceValue',
    'xmlDocAtTag',
    'xmlDocBlockDelimiter',
    'xmlDocLinePrefix',
    'xmlDocText',
] as const;

export type TokenKey = typeof TOKEN_KEYS[number];

/** A complete foreground-color set. Partial palettes are deliberately rejected. */
export type DocColors = Record<TokenKey, string>;

/** Metadata shared by grammar generation, rule management, and the webview. */
export interface TokenDefinition {
    key: TokenKey;
    label: string;
    scopeBase: string;
    boldByDefault?: boolean;
    /** Omitted when the token is meaningful in every supported language. */
    languageIds?: readonly string[];
}

/**
 * Canonical mapping from persisted token keys to their user-facing labels and
 * language-independent TextMate scope bases.
 */
export const TOKEN_DEFINITIONS: readonly TokenDefinition[] = [
    { key: 'xmlDocTagName', label: 'Tag names', scopeBase: 'entity.name.tag.xml-doc-color', boldByDefault: true },
    { key: 'xmlDocTagDelimiter', label: 'Tag delimiters', scopeBase: 'punctuation.definition.tag.xml-doc-color' },
    { key: 'xmlDocAttribute', label: 'Attributes', scopeBase: 'entity.other.attribute-name.xml-doc-color' },
    { key: 'xmlDocAttributeValue', label: 'Attribute values', scopeBase: 'string.quoted.xml-doc-color' },
    { key: 'xmlDocEntity', label: 'Entities', scopeBase: 'constant.character.entity.xml-doc-color' },
    { key: 'xmlDocCDataDelimiter', label: 'CDATA delimiters', scopeBase: 'punctuation.definition.cdata.xml-doc-color' },
    { key: 'xmlDocCDataText', label: 'CDATA text', scopeBase: 'string.unquoted.cdata.xml-doc-color' },
    { key: 'xmlDocInlineDelimiter', label: 'Inline delimiters', scopeBase: 'punctuation.section.inline.documentation.xml-doc-color' },
    { key: 'xmlDocReferenceValue', label: 'References', scopeBase: 'variable.other.reference.documentation.xml-doc-color' },
    { key: 'xmlDocAtTag', label: '@-tags', scopeBase: 'keyword.other.documentation.xml-doc-color', boldByDefault: true },
    {
        key: 'xmlDocBlockDelimiter',
        label: 'Block comment delimiters',
        scopeBase: 'punctuation.definition.comment.block.xml-doc-color',
        languageIds: REGULAR_BLOCK_LANGUAGE_IDS,
    },
    { key: 'xmlDocLinePrefix', label: 'Comment prefix', scopeBase: 'punctuation.definition.comment.xml-doc-color' },
    { key: 'xmlDocText', label: 'Documentation text', scopeBase: 'comment.documentation.xml-doc-color' },
];

/** Explicit dark preset; inherited theme colors are represented by no rule. */
export const DARK_PRESET_COLORS: DocColors = {
    xmlDocTagName: '#4EC9B0',
    xmlDocTagDelimiter: '#6D8B6D',
    xmlDocAttribute: '#9CDCFE',
    xmlDocAttributeValue: '#CE9178',
    xmlDocEntity: '#DCDCAA',
    xmlDocCDataDelimiter: '#6D8B6D',
    xmlDocCDataText: '#CE9178',
    xmlDocInlineDelimiter: '#6D8B6D',
    xmlDocReferenceValue: '#4FC1FF',
    xmlDocAtTag: '#C586C0',
    xmlDocBlockDelimiter: '#6A9955',
    xmlDocLinePrefix: '#6A9955',
    xmlDocText: '#D4D4D4',
};

/** Explicit light preset; inherited theme colors are represented by no rule. */
export const LIGHT_PRESET_COLORS: DocColors = {
    xmlDocTagName: '#0F766E',
    xmlDocTagDelimiter: '#4D7C0F',
    xmlDocAttribute: '#1D4ED8',
    xmlDocAttributeValue: '#B45309',
    xmlDocEntity: '#92400E',
    xmlDocCDataDelimiter: '#4D7C0F',
    xmlDocCDataText: '#B45309',
    xmlDocInlineDelimiter: '#4D7C0F',
    xmlDocReferenceValue: '#0369A1',
    xmlDocAtTag: '#9333EA',
    xmlDocBlockDelimiter: '#15803D',
    xmlDocLinePrefix: '#15803D',
    xmlDocText: '#111827',
};

export type DocumentationStyle = 'line' | 'block';

/**
 * Describes one VS Code language and the native TextMate scopes into which its
 * XML documentation grammar must be injected.
 */
export interface LanguageDefinition {
    /** VS Code language identifier and suffix used by generated custom scopes. */
    id: string;
    label: string;
    /** Root scopes declared in package.json's `injectTo` contribution. */
    sourceScopes: readonly string[];
    documentationStyle: DocumentationStyle;
    /** Prefix used to keep line-documentation state across consecutive lines. */
    linePrefix?: string;
    /** Existing Javadoc/JSDoc/PHPDoc/KDoc scopes that constrain block injection. */
    documentationScopes?: readonly string[];
    /** Root scopes where a separate ordinary block-comment grammar may take ownership. */
    regularBlockSelectors?: readonly string[];
}

/** Single source of truth for all generated grammar contributions. */
export const LANGUAGE_DEFINITIONS: readonly LanguageDefinition[] = [
    { id: 'csharp', label: 'C# (///)', sourceScopes: ['source.cs'], documentationStyle: 'line', linePrefix: '///' },
    { id: 'vb', label: "VB.NET (''')", sourceScopes: ['source.asp.vb.net'], documentationStyle: 'line', linePrefix: "'''" },
    { id: 'fsharp', label: 'F# (///)', sourceScopes: ['source.fsharp'], documentationStyle: 'line', linePrefix: '///' },
    { id: 'java', label: 'Java (block comments)', sourceScopes: ['source.java'], documentationStyle: 'block', documentationScopes: ['comment.block.javadoc.java'], regularBlockSelectors: ['source.java'] },
    { id: 'typescript', label: 'TypeScript (block comments)', sourceScopes: ['source.ts'], documentationStyle: 'block', documentationScopes: ['comment.block.documentation.ts'], regularBlockSelectors: ['source.ts'] },
    { id: 'typescriptreact', label: 'TSX (block comments)', sourceScopes: ['source.tsx'], documentationStyle: 'block', documentationScopes: ['comment.block.documentation.tsx'], regularBlockSelectors: ['source.tsx'] },
    { id: 'javascript', label: 'JavaScript (block comments)', sourceScopes: ['source.js'], documentationStyle: 'block', documentationScopes: ['comment.block.documentation.js'], regularBlockSelectors: ['source.js'] },
    { id: 'javascriptreact', label: 'JSX (block comments)', sourceScopes: ['source.js.jsx'], documentationStyle: 'block', documentationScopes: ['comment.block.documentation.js.jsx'], regularBlockSelectors: ['source.js.jsx'] },
    { id: 'php', label: 'PHP (block comments)', sourceScopes: ['source.php', 'text.html.php'], documentationStyle: 'block', documentationScopes: ['comment.block.documentation.phpdoc.php'], regularBlockSelectors: ['source.php'] },
    {
        id: 'kotlin',
        label: 'Kotlin (/** */)',
        sourceScopes: ['source.kotlin'],
        documentationStyle: 'block',
        documentationScopes: ['comment.block.javadoc.kotlin', 'comment.block.documentation.kotlin'],
        regularBlockSelectors: ['source.kotlin'],
    },
];

export const SUPPORTED_LANGUAGES: readonly string[] = LANGUAGE_DEFINITIONS.map(({ id }) => id);

/** Returns the canonical metadata for a VS Code language identifier. */
export function getLanguageDefinition(languageId: string): LanguageDefinition | undefined {
    return LANGUAGE_DEFINITIONS.find(({ id }) => id === languageId);
}

/** Returns token metadata and fails fast if a non-canonical key reaches runtime. */
export function getTokenDefinition(key: TokenKey): TokenDefinition {
    const definition = TOKEN_DEFINITIONS.find((candidate) => candidate.key === key);
    if (!definition) {
        throw new Error(`Unknown XML Doc Color token: ${key}`);
    }
    return definition;
}

/** Whether a token has a real generated scope in the selected language. */
export function tokenSupportsLanguage(key: TokenKey, languageId: string): boolean {
    if (languageId === '*') {
        return true;
    }
    const languageIds = getTokenDefinition(key).languageIds;
    return !languageIds || languageIds.includes(languageId);
}

/** Returns only tokens that can produce a rule for the selected scope. */
export function getTokenKeysForLanguage(languageId: string): readonly TokenKey[] {
    return TOKEN_KEYS.filter((key) => tokenSupportsLanguage(key, languageId));
}

/** Builds the stable language-specific scope contributed by a generated grammar. */
export function getTokenScope(key: TokenKey, languageId: string): string {
    return `${getTokenDefinition(key).scopeBase}.${languageId}`;
}
