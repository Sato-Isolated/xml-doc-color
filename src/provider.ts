import * as vscode from 'vscode';
import { getEnabledLanguages, LANGUAGE_CONFIGS, LanguageConfig } from './languages';
import { parseDocLine, TOKEN_TYPES, TokenTypeName } from './parser';

interface CachedTokenEntry {
    line: number;
    start: number;
    length: number;
    typeIndex: number;
    modifiers: number;
}

interface DocumentTokenCache {
    version: number;
    languageId: string;
    tokenMode: 'structuredOnly' | 'full';
    tokens: CachedTokenEntry[];
}

/**
 * Ordered list of token type names that forms the SemanticTokensLegend.
 * The index of each type in this array is the numeric token type ID used by the builder.
 */
export const TOKEN_TYPES_ARRAY: TokenTypeName[] = [
    TOKEN_TYPES.xmlDocTagDelimiter,
    TOKEN_TYPES.xmlDocTagName,
    TOKEN_TYPES.xmlDocAttribute,
    TOKEN_TYPES.xmlDocAttributeValue,
    TOKEN_TYPES.xmlDocEntity,
    TOKEN_TYPES.xmlDocCDataDelimiter,
    TOKEN_TYPES.xmlDocCDataText,
    TOKEN_TYPES.xmlDocInlineDelimiter,
    TOKEN_TYPES.xmlDocReferenceValue,
    TOKEN_TYPES.xmlDocAtTag,
    TOKEN_TYPES.xmlDocLinePrefix,
    TOKEN_TYPES.xmlDocText,
];

export const LEGEND = new vscode.SemanticTokensLegend(TOKEN_TYPES_ARRAY, []);

const TOKEN_TYPE_TO_INDEX: Readonly<Record<TokenTypeName, number>> = TOKEN_TYPES_ARRAY.reduce(
    (result, tokenType, index) => {
        result[tokenType] = index;
        return result;
    },
    {} as Record<TokenTypeName, number>,
);

export class XmlDocSemanticTokensProvider
    implements vscode.DocumentSemanticTokensProvider, vscode.DocumentRangeSemanticTokensProvider
{
    private readonly _onDidChangeSemanticTokens = new vscode.EventEmitter<void>();
    private readonly _documentCache = new Map<string, DocumentTokenCache>();

    readonly onDidChangeSemanticTokens = this._onDidChangeSemanticTokens.event;

    provideDocumentSemanticTokens(
        document: vscode.TextDocument,
        token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.SemanticTokens> {
        const fullRange = new vscode.Range(0, 0, document.lineCount - 1, Number.MAX_SAFE_INTEGER);
        return this.provideDocumentRangeSemanticTokens(document, fullRange, token);
    }

    provideDocumentRangeSemanticTokens(
        document: vscode.TextDocument,
        range: vscode.Range,
        token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.SemanticTokens> {
        if (token.isCancellationRequested) {
            return emptyTokens();
        }

        if (!isXmlDocColorEnabled(document)) {
            return emptyTokens();
        }

        const config = LANGUAGE_CONFIGS[document.languageId];
        if (!config) {
            return emptyTokens();
        }

        const tokenMode = getTokenMode(document);
        const cached = this.getCachedTokens(document, config, tokenMode, token);
        const builder = new vscode.SemanticTokensBuilder(LEGEND);

        for (const entry of cached) {
            if (isTokenInRange(entry, range)) {
                builder.push(entry.line, entry.start, entry.length, entry.typeIndex, entry.modifiers);
            }
        }

        return builder.build();
    }

    // -------------------------------------------------------------------------
    // Line-based doc comments: ///, '''
    // -------------------------------------------------------------------------

    private getCachedTokens(
        document: vscode.TextDocument,
        config: LanguageConfig,
        tokenMode: 'structuredOnly' | 'full',
        token: vscode.CancellationToken,
    ): CachedTokenEntry[] {
        const key = `${document.uri.toString()}:${document.version}:${document.languageId}:${tokenMode}`;
        const cached = this._documentCache.get(key);
        if (cached && cached.version === document.version && cached.languageId === document.languageId) {
            return cached.tokens;
        }

        const tokens: CachedTokenEntry[] = [];
        const pushToken = (line: number, start: number, length: number, typeIndex: number, modifiers: number): void => {
            tokens.push({ line, start, length, typeIndex, modifiers });
        };

        if (config.lineDocPrefix) {
            this.processLineDoc(document, new vscode.Range(0, 0, document.lineCount - 1, Number.MAX_SAFE_INTEGER), config, pushToken, token, tokenMode);
        }
        if (config.blockDocStart) {
            this.processBlockDoc(document, new vscode.Range(0, 0, document.lineCount - 1, Number.MAX_SAFE_INTEGER), config, pushToken, token, tokenMode);
        }

        this._documentCache.set(key, { version: document.version, languageId: document.languageId, tokenMode, tokens });
        return tokens;
    }

    private processLineDoc(
        document: vscode.TextDocument,
        range: vscode.Range,
        config: LanguageConfig,
        pushToken: (line: number, start: number, length: number, typeIndex: number, modifiers: number) => void,
        token: vscode.CancellationToken,
        tokenMode: 'structuredOnly' | 'full',
    ): void {
        const startLine = range.start.line;
        const endLine   = Math.min(range.end.line, document.lineCount - 1);

        for (let li = startLine; li <= endLine; li++) {
            if (token.isCancellationRequested) { return; }

            const text  = document.lineAt(li).text;
            const match = config.lineDocPrefix!.exec(text);
            if (!match) { continue; }

            const contentCol = match[0].length;
            const content    = text.slice(contentCol);

            // Emit prefix token for the /// or ''' marker itself
            const prefixCol = leadingSpaces(match[0]);
            const prefixLen = match[0].trim().length;
            if (prefixLen > 0) {
                pushToken(li, prefixCol, prefixLen, TOKEN_TYPE_TO_INDEX[TOKEN_TYPES.xmlDocLinePrefix], 0);
            }

            if (!content.trim()) { continue; }

            for (const tok of parseDocLine(content, { includeText: tokenMode === 'full' })) {
                pushToken(li, contentCol + tok.start, tok.length, TOKEN_TYPE_TO_INDEX[tok.type], 0);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Block doc comments: /** ... */
    // Scans from line 0 so blocks beginning before `range.start` are handled
    // correctly; tokens are only emitted when the line falls within the range.
    // -------------------------------------------------------------------------

    private processBlockDoc(
        document: vscode.TextDocument,
        range: vscode.Range,
        config: LanguageConfig,
        pushToken: (line: number, start: number, length: number, typeIndex: number, modifiers: number) => void,
        token: vscode.CancellationToken,
        tokenMode: 'structuredOnly' | 'full',
    ): void {
        const scanEnd   = Math.min(range.end.line, document.lineCount - 1);
        const emitStart = range.start.line;
        const prefixIdx = TOKEN_TYPE_TO_INDEX[TOKEN_TYPES.xmlDocLinePrefix];

        let inBlock = false;

        for (let li = 0; li <= scanEnd; li++) {
            if (token.isCancellationRequested) { return; }

            const text       = document.lineAt(li).text;
            const shouldEmit = li >= emitStart;

            if (!inBlock) {
                const openMatch = config.blockDocStart?.exec(text);
                if (!openMatch || openMatch.index === undefined) { continue; }

                inBlock = true;
                const afterOpen = openMatch.index + openMatch[0].length;

                // Emit /** prefix token
                if (shouldEmit) {
                    pushToken(li, openMatch.index, openMatch[0].trimEnd().length, prefixIdx, 0);
                }

                // Single-line: /** content */
                const closeIdx = text.indexOf('*/', afterOpen);
                if (closeIdx !== -1) {
                    if (shouldEmit) {
                        const content = text.slice(afterOpen, closeIdx);
                        this.emitLineTokens(content, afterOpen, li, pushToken, tokenMode);
                        // Emit */ prefix token
                        pushToken(li, closeIdx, 2, prefixIdx, 0);
                    }
                    inBlock = false;
                } else if (shouldEmit) {
                    const content = text.slice(afterOpen);
                    this.emitLineTokens(content, afterOpen, li, pushToken, tokenMode);
                }
            } else {
                const closeIdx = text.indexOf('*/');

                if (closeIdx !== -1) {
                    // Last line of the block — content sits before */
                    if (shouldEmit) {
                        const beforeClose = text.slice(0, closeIdx);
                        const lineMatch   = config.blockDocLine!.exec(beforeClose);
                        const colOffset   = lineMatch ? lineMatch[0].length : leadingSpaces(beforeClose);
                        const content     = lineMatch ? beforeClose.slice(colOffset) : beforeClose.trimStart();
                        // Emit * prefix on closing line (if present)
                        if (lineMatch) {
                            const pCol = leadingSpaces(lineMatch[0]);
                            const pLen = lineMatch[0].trim().length;
                            if (pLen > 0) { pushToken(li, pCol, pLen, prefixIdx, 0); }
                        }
                        this.emitLineTokens(content, colOffset, li, pushToken, tokenMode);
                        // Emit */ token
                        pushToken(li, closeIdx, 2, prefixIdx, 0);
                    }
                    inBlock = false;
                } else {
                    // Regular content line inside the block
                    if (shouldEmit) {
                        const lineMatch = config.blockDocLine!.exec(text);
                        const colOffset = lineMatch ? lineMatch[0].length : leadingSpaces(text);
                        const content   = lineMatch ? text.slice(colOffset) : text.trimStart();
                        // Emit * prefix
                        if (lineMatch) {
                            const pCol = leadingSpaces(lineMatch[0]);
                            const pLen = lineMatch[0].trim().length;
                            if (pLen > 0) { pushToken(li, pCol, pLen, prefixIdx, 0); }
                        }
                        this.emitLineTokens(content, colOffset, li, pushToken, tokenMode);
                    }
                }
            }
        }
    }

    private emitLineTokens(
        content: string,
        colOffset: number,
        lineIndex: number,
        pushToken: (line: number, start: number, length: number, typeIndex: number, modifiers: number) => void,
        tokenMode: 'structuredOnly' | 'full',
    ): void {
        if (!content.trim()) { return; }
        for (const tok of parseDocLine(content, { includeText: tokenMode === 'full' })) {
            pushToken(lineIndex, colOffset + tok.start, tok.length, TOKEN_TYPE_TO_INDEX[tok.type], 0);
        }
    }

    refresh(): void {
        this._documentCache.clear();
        this._onDidChangeSemanticTokens.fire();
    }
}

/** Returns the number of leading space/tab characters in `s`. */
function leadingSpaces(s: string): number {
    let i = 0;
    while (i < s.length && (s[i] === ' ' || s[i] === '\t')) { i++; }
    return i;
}

function isXmlDocColorEnabled(document: vscode.TextDocument): boolean {
    const config = vscode.workspace.getConfiguration('xmlDocColor', document);
    const enabled = config.get<boolean>('enabled', true);
    const enabledLanguages = config.get<readonly string[]>('enabledLanguages', getEnabledLanguages());

    return enabled && enabledLanguages.includes(document.languageId);
}

function emptyTokens(): vscode.SemanticTokens {
    return new vscode.SemanticTokensBuilder(LEGEND).build();
}

function isTokenInRange(entry: CachedTokenEntry, range: vscode.Range): boolean {
    const line = entry.line;
    const start = entry.start;
    const end = entry.start + entry.length;

    if (line < range.start.line || line > range.end.line) {
        return false;
    }

    if (line === range.start.line && start < range.start.character) {
        return false;
    }

    if (line === range.end.line && end > range.end.character) {
        return false;
    }

    return true;
}

function getTokenMode(document: vscode.TextDocument): 'structuredOnly' | 'full' {
    const config = vscode.workspace.getConfiguration('xmlDocColor', document);
    return config.get<'structuredOnly' | 'full'>('tokenMode', 'structuredOnly') ?? 'structuredOnly';
}
