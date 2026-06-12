/** Semantic token type names contributed by this extension. */
export const TOKEN_TYPES = {
    xmlDocTagDelimiter:    'xmlDocTagDelimiter',
    xmlDocTagName:         'xmlDocTagName',
    xmlDocAttribute:       'xmlDocAttribute',
    xmlDocAttributeValue:  'xmlDocAttributeValue',
    xmlDocEntity:          'xmlDocEntity',
    xmlDocCDataDelimiter:  'xmlDocCDataDelimiter',
    xmlDocCDataText:       'xmlDocCDataText',
    xmlDocInlineDelimiter: 'xmlDocInlineDelimiter',
    xmlDocReferenceValue:  'xmlDocReferenceValue',
    xmlDocAtTag:           'xmlDocAtTag',
    xmlDocLinePrefix:      'xmlDocLinePrefix',
    xmlDocText:            'xmlDocText',
} as const;

export type TokenTypeName = typeof TOKEN_TYPES[keyof typeof TOKEN_TYPES];

/** A token offset within the stripped content string of a single doc line. */
export interface ParseDocLineOptions {
    includeText?: boolean;
}

export interface ParsedToken {
    type: TokenTypeName;
    /** Character offset from the start of the content string passed to `parseDocLine`. */
    start: number;
    length: number;
}

/**
 * Parse XML tags and `@`-style tags from one stripped line of doc-comment content.
 * Positions are relative to the start of `content`.
 *
 * Handles:
 *  - `<tagName attr="value">`, `</tagName>`, `<tagName/>`, `<!-- comment -->`
 *  - `@param`, `@returns`, `{@link}`, etc.
 *  - Plain text runs between tags are emitted as `xmlDocText` tokens.
 */
export function parseDocLine(content: string, options: ParseDocLineOptions = {}): ParsedToken[] {
    const tokens: ParsedToken[] = [];
    const includeText = options.includeText !== false;
    let i = 0;
    const n = content.length;
    let textStart = 0; // tracks the start of the current plain-text run

    function flushText(end: number): void {
        if (includeText && end > textStart) {
            tokens.push({ type: TOKEN_TYPES.xmlDocText, start: textStart, length: end - textStart });
        }
    }

    while (i < n) {
        if (content.startsWith('<![CDATA[', i)) {
            flushText(i);
            const afterCData = parseCData(content, i, n, tokens);
            if (afterCData > i) {
                i = afterCData;
                textStart = i;
                continue;
            }
        }

        if (content[i] === '&' && looksLikeEntity(content, i)) {
            flushText(i);
            const entity = parseEntity(content, i);
            if (entity) {
                tokens.push(entity);
                i += entity.length;
                textStart = i;
                continue;
            }
        }

        if (content[i] === '<' && looksLikeXmlTagStart(content, i)) {
            flushText(i);
            const before = i;
            i = parseXmlTag(content, i, n, tokens);
            textStart = i;
            if (i === before) { i++; textStart = before; }
            continue;
        }

        if (content[i] === '{' && content.startsWith('{@', i) && i + 2 < n) {
            flushText(i);
            const afterInline = parseInlineDocTag(content, i, n, tokens);
            if (afterInline > i) {
                i = afterInline;
                textStart = i;
                continue;
            }
        }

        if (content[i] === '@' && i + 1 < n && /\w/.test(content[i + 1])) {
            flushText(i);
            const start = i++;
            while (i < n && /\w/.test(content[i])) { i++; }
            tokens.push({ type: TOKEN_TYPES.xmlDocAtTag, start, length: i - start });
            textStart = i;
            continue;
        }

        i++;
    }

    flushText(n);

    return tokens;
}

function looksLikeEntity(content: string, index: number): boolean {
    return /&(?:#x?[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]+);/.test(content.slice(index));
}

function parseEntity(content: string, index: number): ParsedToken | undefined {
    const match = content.slice(index).match(/^&(?:#x?[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]+);/);
    if (!match) {
        return undefined;
    }

    return { type: TOKEN_TYPES.xmlDocEntity, start: index, length: match[0].length };
}

function parseCData(content: string, index: number, n: number, tokens: ParsedToken[]): number {
    const start = index;
    const cdataStart = '<![CDATA[';
    tokens.push({ type: TOKEN_TYPES.xmlDocCDataDelimiter, start, length: cdataStart.length });
    index += cdataStart.length;

    const end = content.indexOf(']]>', index);
    if (end === -1) {
        tokens.push({ type: TOKEN_TYPES.xmlDocCDataText, start: index, length: n - index });
        return n;
    }

    tokens.push({ type: TOKEN_TYPES.xmlDocCDataText, start: index, length: end - index });
    tokens.push({ type: TOKEN_TYPES.xmlDocCDataDelimiter, start: end, length: 3 });
    return end + 3;
}

function parseInlineDocTag(content: string, index: number, n: number, tokens: ParsedToken[]): number {
    const tagStart = index;
    tokens.push({ type: TOKEN_TYPES.xmlDocInlineDelimiter, start: tagStart, length: 1 });
    index += 1;

    if (index >= n || content[index] !== '@') {
        return index;
    }

    const atStart = index;
    index += 1;
    while (index < n && /[\w:-]/.test(content[index])) { index++; }
    const tagName = content.slice(atStart + 1, index);
    tokens.push({ type: TOKEN_TYPES.xmlDocAtTag, start: atStart, length: index - atStart });

    while (index < n && /\s/.test(content[index])) { index++; }
    const targetStart = index;
    while (index < n && content[index] !== '}') { index++; }
    if (index < n) {
        if (['link', 'see', 'linkplain', 'value'].includes(tagName.toLowerCase()) && targetStart < index) {
            tokens.push({ type: TOKEN_TYPES.xmlDocReferenceValue, start: targetStart, length: index - targetStart });
        }

        tokens.push({ type: TOKEN_TYPES.xmlDocInlineDelimiter, start: index, length: 1 });
        index += 1;
    }

    return index;
}

function looksLikeXmlTagStart(content: string, index: number): boolean {
    const next = content[index + 1];
    if (!next) {
        return false;
    }

    if (next === '/' || next === '!') {
        return true;
    }

    if (/[A-Za-z]/.test(next)) {
        const previous = index > 0 ? content[index - 1] : '';

        // Avoid treating inline generics like List<T> as XML tags while still allowing
        // cases such as @param <T> or standalone XML content.
        if (/[A-Za-z0-9_$]/.test(previous)) {
            return false;
        }

        return true;
    }

    return false;
}

/** Advances past one XML tag starting at `i` (the `<` character), emitting tokens. */
function parseXmlTag(content: string, i: number, n: number, tokens: ParsedToken[]): number {
    // <!-- comment -->
    if (content.startsWith('<!--', i)) {
        tokens.push({ type: TOKEN_TYPES.xmlDocTagDelimiter, start: i, length: 4 });
        i += 4;
        const end = content.indexOf('-->', i);
        if (end === -1) { return n; }
        tokens.push({ type: TOKEN_TYPES.xmlDocTagDelimiter, start: end, length: 3 });
        return end + 3;
    }

    // </tagName>
    if (i + 1 < n && content[i + 1] === '/') {
        const closingTokens: ParsedToken[] = [
            { type: TOKEN_TYPES.xmlDocTagDelimiter, start: i, length: 2 },
        ];
        i += 2;
        const nameStart = i;
        while (i < n && /[\w:.-]/.test(content[i])) { i++; }
        const tagName = content.slice(nameStart, i);
        if (i > nameStart && isLikelyXmlTagName(tagName, content, i, n)) {
            closingTokens.push({ type: TOKEN_TYPES.xmlDocTagName, start: nameStart, length: i - nameStart });
            while (i < n && /[ \t]/.test(content[i])) { i++; }
            if (i < n && content[i] === '>') {
                closingTokens.push({ type: TOKEN_TYPES.xmlDocTagDelimiter, start: i, length: 1 });
                i++;
            }
            tokens.push(...closingTokens);
            return i;
        }
        return nameStart - 1;
    }

    // <tagName ...> or <tagName .../>
    const tagTokens: ParsedToken[] = [
        { type: TOKEN_TYPES.xmlDocTagDelimiter, start: i, length: 1 },
    ];
    i++;

    const nameStart = i;
    while (i < n && /[\w:.-]/.test(content[i])) { i++; }
    const tagName = content.slice(nameStart, i);
    if (i > nameStart) {
        tagTokens.push({ type: TOKEN_TYPES.xmlDocTagName, start: nameStart, length: i - nameStart });
    } else {
        return nameStart - 1;
    }

    if (!isLikelyXmlTagName(tagName, content, i, n)) {
        return nameStart - 1;
    }

    // Attributes
    while (i < n) {
        // Skip whitespace
        while (i < n && /[ \t]/.test(content[i])) { i++; }

        if (i >= n || content[i] === '>') { break; }
        if (content[i] === '/' && i + 1 < n && content[i + 1] === '>') { break; }

        // Attribute name
        const attrStart = i;
        while (i < n && /[\w:.-]/.test(content[i])) { i++; }
        if (i > attrStart) {
            tagTokens.push({ type: TOKEN_TYPES.xmlDocAttribute, start: attrStart, length: i - attrStart });
        } else {
            i++; // skip unexpected character, avoid infinite loop
            continue;
        }

        // Optional = "value"
        while (i < n && /[ \t]/.test(content[i])) { i++; }
        if (i < n && content[i] === '=') {
            i++;
            while (i < n && /[ \t]/.test(content[i])) { i++; }
            if (i < n && (content[i] === '"' || content[i] === "'")) {
                const q = content[i];
                const attrName = content.slice(attrStart, i).trim();
                const valStart = i;
                i++;
                while (i < n && content[i] !== q) { i++; }
                if (i < n) { i++; } // consume closing quote
                const valueType = isReferenceAttribute(attrName)
                    ? TOKEN_TYPES.xmlDocReferenceValue
                    : TOKEN_TYPES.xmlDocAttributeValue;
                tagTokens.push({ type: valueType, start: valStart, length: i - valStart });
            }
        }
    }

    // End delimiter: /> or >
    if (i < n && content[i] === '/' && i + 1 < n && content[i + 1] === '>') {
        tagTokens.push({ type: TOKEN_TYPES.xmlDocTagDelimiter, start: i, length: 2 });
        i += 2;
    } else if (i < n && content[i] === '>') {
        tagTokens.push({ type: TOKEN_TYPES.xmlDocTagDelimiter, start: i, length: 1 });
        i++;
    }

    tokens.push(...tagTokens);
    return i;
}

function isReferenceAttribute(name: string): boolean {
    return /^(?:cref|name|href|langword|path|file)$/i.test(name);
}

function isLikelyXmlTagName(tagName: string, content: string, i: number, n: number): boolean {
    if (!tagName) {
        return false;
    }

    if (/^[a-z]/.test(tagName) || tagName.includes(':') || tagName.includes('-')) {
        return true;
    }

    if (tagName.length === 1 && /[A-Z]/.test(tagName)) {
        const next = content[i];
        return next === '>' || next === '/' || next === ' ';
    }

    // Allow doc constructs such as <TResult> in @param or prose when isolated.
    return /^[A-Z][A-Za-z0-9]+$/.test(tagName) && (i >= n || /[ />\t]/.test(content[i]));
}
