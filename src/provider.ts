import * as vscode from 'vscode';
import { LANGUAGE_CONFIGS, LanguageConfig } from './languages';
import { parseDocLine, TOKEN_TYPES, TokenTypeName } from './parser';

/**
 * Ordered list of token type names that forms the SemanticTokensLegend.
 * The index of each type in this array is the numeric token type ID used by the builder.
 */
export const TOKEN_TYPES_ARRAY: TokenTypeName[] = [
    TOKEN_TYPES.xmlDocTagDelimiter,
    TOKEN_TYPES.xmlDocTagName,
    TOKEN_TYPES.xmlDocAttribute,
    TOKEN_TYPES.xmlDocAttributeValue,
    TOKEN_TYPES.xmlDocAtTag,
    TOKEN_TYPES.xmlDocLinePrefix,
    TOKEN_TYPES.xmlDocText,
];

export const LEGEND = new vscode.SemanticTokensLegend(TOKEN_TYPES_ARRAY, []);

export class XmlDocSemanticTokensProvider
    implements vscode.DocumentSemanticTokensProvider, vscode.DocumentRangeSemanticTokensProvider
{
    private readonly _onDidChangeSemanticTokens = new vscode.EventEmitter<void>();

    readonly onDidChangeSemanticTokens = this._onDidChangeSemanticTokens.event;

    provideDocumentSemanticTokens(
        document: vscode.TextDocument,
        token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.SemanticTokens> {
        const fullRange = new vscode.Range(0, 0, document.lineCount - 1, 0);
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

        if (!isXmlDocColorEnabled()) {
            return emptyTokens();
        }

        const config = LANGUAGE_CONFIGS[document.languageId];
        if (!config) {
            return emptyTokens();
        }

        const builder = new vscode.SemanticTokensBuilder(LEGEND);

        if (config.lineDocPrefix) {
            this.processLineDoc(document, range, config, builder, token);
        }
        if (config.blockDocStart) {
            this.processBlockDoc(document, range, config, builder, token);
        }

        return builder.build();
    }

    // -------------------------------------------------------------------------
    // Line-based doc comments: ///, '''
    // -------------------------------------------------------------------------

    private processLineDoc(
        document: vscode.TextDocument,
        range: vscode.Range,
        config: LanguageConfig,
        builder: vscode.SemanticTokensBuilder,
        token: vscode.CancellationToken,
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
                const prefixIdx = TOKEN_TYPES_ARRAY.indexOf(TOKEN_TYPES.xmlDocLinePrefix);
                builder.push(li, prefixCol, prefixLen, prefixIdx, 0);
            }

            if (!content.trim()) { continue; }

            for (const tok of parseDocLine(content)) {
                const typeIdx = TOKEN_TYPES_ARRAY.indexOf(tok.type);
                builder.push(li, contentCol + tok.start, tok.length, typeIdx, 0);
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
        builder: vscode.SemanticTokensBuilder,
        token: vscode.CancellationToken,
    ): void {
        const scanEnd   = Math.min(range.end.line, document.lineCount - 1);
        const emitStart = range.start.line;
        const prefixIdx = TOKEN_TYPES_ARRAY.indexOf(TOKEN_TYPES.xmlDocLinePrefix);

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
                    builder.push(li, openMatch.index, openMatch[0].trimEnd().length, prefixIdx, 0);
                }

                // Single-line: /** content */
                const closeIdx = text.indexOf('*/', afterOpen);
                if (closeIdx !== -1) {
                    if (shouldEmit) {
                        const content = text.slice(afterOpen, closeIdx);
                        this.emitLineTokens(content, afterOpen, li, builder);
                        // Emit */ prefix token
                        builder.push(li, closeIdx, 2, prefixIdx, 0);
                    }
                    inBlock = false;
                } else if (shouldEmit) {
                    const content = text.slice(afterOpen);
                    this.emitLineTokens(content, afterOpen, li, builder);
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
                            if (pLen > 0) { builder.push(li, pCol, pLen, prefixIdx, 0); }
                        }
                        this.emitLineTokens(content, colOffset, li, builder);
                        // Emit */ token
                        builder.push(li, closeIdx, 2, prefixIdx, 0);
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
                            if (pLen > 0) { builder.push(li, pCol, pLen, prefixIdx, 0); }
                        }
                        this.emitLineTokens(content, colOffset, li, builder);
                    }
                }
            }
        }
    }

    private emitLineTokens(
        content: string,
        colOffset: number,
        lineIndex: number,
        builder: vscode.SemanticTokensBuilder,
    ): void {
        if (!content.trim()) { return; }
        for (const tok of parseDocLine(content)) {
            const typeIdx = TOKEN_TYPES_ARRAY.indexOf(tok.type);
            builder.push(lineIndex, colOffset + tok.start, tok.length, typeIdx, 0);
        }
    }

    refresh(): void {
        this._onDidChangeSemanticTokens.fire();
    }
}

/** Returns the number of leading space/tab characters in `s`. */
function leadingSpaces(s: string): number {
    let i = 0;
    while (i < s.length && (s[i] === ' ' || s[i] === '\t')) { i++; }
    return i;
}

function isXmlDocColorEnabled(): boolean {
    return vscode.workspace.getConfiguration('xmlDocColor').get<boolean>('enabled', true);
}

function emptyTokens(): vscode.SemanticTokens {
    return new vscode.SemanticTokensBuilder(LEGEND).build();
}
