import * as assert from 'assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { createOnigScanner, createOnigString, loadWASM } from 'vscode-oniguruma';
import { IGrammar, INITIAL, IRawGrammar, Registry, StateStack } from 'vscode-textmate';
import {
    getThemeCustomizationSnippet,
    migrateCustomizationValues,
    persistMigration,
    readResolvedColors,
    resetColors,
    TextMateRule,
    TokenColorCustomizations,
    writeColors,
} from '../colorConfig';
import { normalizeWebviewMessage } from '../messages';
import { createGrammar, createRegularBlockGrammar } from '../generateGrammars';
import { getSidebarPreviewData } from '../languages';
import {
    DARK_PRESET_COLORS,
    DocColors,
    getTokenKeysForLanguage,
    getTokenScope,
    LANGUAGE_DEFINITIONS,
    LIGHT_PRESET_COLORS,
    REGULAR_BLOCK_LANGUAGE_IDS,
    SUPPORTED_LANGUAGES,
    TOKEN_DEFINITIONS,
    TOKEN_KEYS,
    TokenKey,
} from '../model';

function testColors(seed = 1): DocColors {
    const colors = {} as DocColors;
    TOKEN_KEYS.forEach((key, index) => {
        const value = (seed + index) % 256;
        colors[key] = `#${value.toString(16).padStart(2, '0').repeat(3)}`.toUpperCase();
    });
    return colors;
}

function allScopes(tokens: ReturnType<IGrammar['tokenizeLine']>['tokens']): string[] {
    return tokens.flatMap((token) => token.scopes);
}

function grammarFiles(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? grammarFiles(entryPath) : [entryPath];
    });
}

suite('Shared model and manifest', () => {
    test('defines exactly ten languages and thirteen unique token scopes', () => {
        assert.strictEqual(LANGUAGE_DEFINITIONS.length, 10);
        assert.strictEqual(TOKEN_DEFINITIONS.length, 13);
        assert.strictEqual(new Set(SUPPORTED_LANGUAGES).size, 10);
        assert.strictEqual(new Set(TOKEN_KEYS).size, 13);

        const blockDelimiter = TOKEN_DEFINITIONS.find(({ key }) => key === 'xmlDocBlockDelimiter');
        assert.deepStrictEqual(blockDelimiter?.languageIds, REGULAR_BLOCK_LANGUAGE_IDS);
        assert.strictEqual(getTokenKeysForLanguage('typescript').length, 13);
        assert.strictEqual(getTokenKeysForLanguage('csharp').length, 12);

        for (const language of LANGUAGE_DEFINITIONS) {
            const scopes = TOKEN_KEYS.map((key) => getTokenScope(key, language.id));
            assert.strictEqual(new Set(scopes).size, TOKEN_KEYS.length);
            assert.ok(scopes.every((scope) => scope.endsWith(`.${language.id}`)));
        }
    });

    test('contributes seventeen grammars and no semantic token provider declarations', () => {
        const extension = vscode.extensions.getExtension('MindLated.xml-doc-color');
        assert.ok(extension);
        const contributions = extension.packageJSON.contributes as Record<string, unknown>;
        assert.strictEqual((contributions.grammars as unknown[]).length, 17);
        assert.strictEqual(contributions.semanticTokenTypes, undefined);
        assert.strictEqual(contributions.semanticTokenScopes, undefined);
        assert.strictEqual(extension.packageJSON.browser, './dist/web/extension.js');
        assert.strictEqual(extension.packageJSON.version, '0.1.0');

        const regularBlockLanguages = LANGUAGE_DEFINITIONS.filter(({ regularBlockSelectors }) => regularBlockSelectors);
        assert.strictEqual(regularBlockLanguages.length, 7);
        assert.strictEqual(LANGUAGE_DEFINITIONS.find(({ id }) => id === 'csharp')?.regularBlockSelectors, undefined);
        assert.deepStrictEqual(LANGUAGE_DEFINITIONS.find(({ id }) => id === 'php')?.regularBlockSelectors, ['source.php']);
    });

    test('coexists with the native TypeScript semantic token provider', async () => {
        const typescriptExtension = vscode.extensions.getExtension('vscode.typescript-language-features');
        assert.ok(typescriptExtension);
        await typescriptExtension.activate();

        const document = await vscode.workspace.openTextDocument({
            language: 'typescript',
            content: [
                '/** <summary>Native semantic tokens stay available.</summary> */',
                'export class Example {',
                '    public value = 1;',
                '}',
            ].join('\n'),
        });
        const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>(
            '_provideDocumentSemanticTokensLegend',
            document.uri,
        );
        const tokens = await vscode.commands.executeCommand<Uint8Array>(
            '_provideDocumentSemanticTokens',
            document.uri,
        );

        assert.ok(legend.tokenTypes.length > 0);
        assert.ok(tokens.byteLength > 12);
    });

    test('builds preview data for every language with all token rows available', () => {
        const data = getSidebarPreviewData();
        assert.strictEqual(data.options.length, LANGUAGE_DEFINITIONS.length + 1);
        assert.strictEqual(Object.keys(data.previews).length, LANGUAGE_DEFINITIONS.length + 1);
        assert.deepStrictEqual(new Set(data.previews['*'].usedTokenKeys), new Set(TOKEN_KEYS));
    });
});

suite('Generated TextMate grammars', () => {
    let onigLib: Promise<{
        createOnigScanner: typeof createOnigScanner;
        createOnigString: typeof createOnigString;
    }>;

    suiteSetup(() => {
        const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
        const data = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength);
        onigLib = loadWASM(data).then(() => ({ createOnigScanner, createOnigString }));
    });

    async function loadGeneratedGrammar(languageId: string): Promise<IGrammar> {
        const language = LANGUAGE_DEFINITIONS.find(({ id }) => id === languageId);
        assert.ok(language);
        const raw = createGrammar(language) as unknown as IRawGrammar;
        const registry = new Registry({
            onigLib,
            loadGrammar: async (scopeName) => scopeName === raw.scopeName ? raw : null,
        });
        return registry.addGrammar(raw);
    }

    async function loadRegularBlockGrammar(languageId: string): Promise<IGrammar> {
        const language = LANGUAGE_DEFINITIONS.find(({ id }) => id === languageId);
        assert.ok(language);
        const generated = createRegularBlockGrammar(language);
        assert.ok(generated);
        const raw = generated as unknown as IRawGrammar;
        const registry = new Registry({
            onigLib,
            loadGrammar: async (scopeName) => scopeName === raw.scopeName ? raw : null,
        });
        return registry.addGrammar(raw);
    }

    async function loadWithBuiltInHost(languageId: string, requestedHostScope?: string): Promise<IGrammar> {
        const language = LANGUAGE_DEFINITIONS.find(({ id }) => id === languageId);
        assert.ok(language);
        const injection = createGrammar(language) as unknown as IRawGrammar;
        const regularBlock = createRegularBlockGrammar(language) as unknown as IRawGrammar | undefined;
        const rawByScope = new Map<string, IRawGrammar>();
        const builtInExtensions = path.join(vscode.env.appRoot, 'extensions');

        for (const grammarPath of grammarFiles(builtInExtensions).filter((file) => /tmLanguage\.json$/i.test(file))) {
            try {
                const raw = JSON.parse(fs.readFileSync(grammarPath, 'utf8')) as IRawGrammar;
                if (raw.scopeName) {
                    rawByScope.set(raw.scopeName, raw);
                }
            } catch {
                // Some built-in extensions contain generated assets that are not JSON grammars.
            }
        }
        rawByScope.set(injection.scopeName, injection);
        if (regularBlock) {
            rawByScope.set(regularBlock.scopeName, regularBlock);
        }
        const injectionScopes = [
            injection.scopeName,
            ...(regularBlock ? [regularBlock.scopeName] : []),
        ];

        const registry = new Registry({
            onigLib,
            loadGrammar: async (scopeName) => rawByScope.get(scopeName) ?? null,
            getInjections: (scopeName) => language.sourceScopes.includes(scopeName)
                ? injectionScopes
                : [],
        });
        const grammar = await registry.loadGrammar(requestedHostScope ?? language.sourceScopes[0]);
        assert.ok(grammar);
        return grammar;
    }

    function tokenizeLines(grammar: IGrammar, lines: readonly string[]): ReturnType<IGrammar['tokenizeLine']>['tokens'][] {
        let stack: StateStack = INITIAL;
        return lines.map((line) => {
            const result = grammar.tokenizeLine(line, stack);
            stack = result.ruleStack;
            return result.tokens;
        });
    }

    for (const definition of LANGUAGE_DEFINITIONS) {
        test(`emits XML documentation scopes for ${definition.id}`, async () => {
            const grammar = await loadGeneratedGrammar(definition.id);
            const prefix = definition.documentationStyle === 'line' ? `${definition.linePrefix} ` : ' * ';
            const lines = [
                `${prefix}<!-- note -->`,
                `${prefix}<![CDATA[value <not-a-tag>]]>`,
                `${prefix}<summary title="Docs" cref='Result'>Value &amp;</summary>`,
                `${prefix}{@link Result} @param source`,
            ];
            const scopes = tokenizeLines(grammar, lines).flatMap(allScopes);
            const extension = vscode.extensions.getExtension('MindLated.xml-doc-color');
            assert.ok(extension);
            const snapshot = JSON.parse(fs.readFileSync(
                path.join(extension.extensionPath, 'test', 'grammar-snapshots.json'),
                'utf8',
            )) as { expectedScopeBases: string[] };
            const expected = snapshot.expectedScopeBases.map((base) => `${base}.${definition.id}`).sort();
            const actual = [...new Set(scopes.filter((candidate) => (
                candidate.includes('.xml-doc-color.') && candidate.endsWith(`.${definition.id}`)
            )))].sort();

            assert.deepStrictEqual(actual, expected);
        });

        test(`rejects email and generic false positives for ${definition.id}`, async () => {
            const grammar = await loadGeneratedGrammar(definition.id);
            const prefix = definition.documentationStyle === 'line' ? `${definition.linePrefix} ` : ' * ';
            const scopes = tokenizeLines(
                grammar,
                [`${prefix}Contact user@example.com and use List<T> or Map<K, V>.`],
            ).flatMap(allScopes);

            assert.ok(!scopes.includes(getTokenScope('xmlDocAtTag', definition.id)));
            assert.ok(!scopes.includes(getTokenScope('xmlDocTagName', definition.id)));
        });
    }

    for (const definition of LANGUAGE_DEFINITIONS.filter(({ regularBlockSelectors }) => regularBlockSelectors)) {
        test(`emits all thirteen scopes for ordinary ${definition.id} block comments`, async () => {
            const grammar = await loadRegularBlockGrammar(definition.id);
            const tokenized = tokenizeLines(grammar, [
                '/*',
                ' * <!-- note -->',
                ' * <![CDATA[value <not-a-tag>]]>',
                ' * <summary title="Docs" cref=\'Result\'>Value &amp;</summary>',
                ' * {@link Result} @param source',
                ' */',
                'const value = 1;',
            ]);
            const commentScopes = tokenized.slice(0, -1).flatMap(allScopes);
            const codeScopes = allScopes(tokenized[tokenized.length - 1] ?? []);

            for (const key of TOKEN_KEYS) {
                assert.ok(
                    commentScopes.includes(getTokenScope(key, definition.id)),
                    `${definition.id}: missing ${key}`,
                );
            }
            assert.ok(
                !TOKEN_KEYS.some((key) => codeScopes.includes(getTokenScope(key, definition.id))),
                `${definition.id}: token scopes leaked past the closing delimiter`,
            );

            const oneLineGrammar = await loadRegularBlockGrammar(definition.id);
            const oneLineTokenized = tokenizeLines(oneLineGrammar, [
                '/* <summary title="Docs">Value &amp;</summary> @returns result */',
                'const nextValue = 2;',
            ]);
            const oneLineScopes = allScopes(oneLineTokenized[0] ?? []);
            const followingCodeScopes = allScopes(oneLineTokenized[1] ?? []);

            assert.ok(oneLineScopes.includes(getTokenScope('xmlDocBlockDelimiter', definition.id)));
            assert.ok(oneLineScopes.includes(getTokenScope('xmlDocTagName', definition.id)));
            assert.ok(oneLineScopes.includes(getTokenScope('xmlDocAtTag', definition.id)));
            assert.ok(
                !TOKEN_KEYS.some((key) => followingCodeScopes.includes(getTokenScope(key, definition.id))),
                `${definition.id}: one-line block did not close`,
            );

            const extraStarGrammar = await loadRegularBlockGrammar(definition.id);
            const extraStarTokenized = tokenizeLines(extraStarGrammar, [
                '/*** <summary>Three stars</summary> */',
                '/**** @returns four stars */',
                'const afterExtraStars = 3;',
            ]);
            for (const commentLine of extraStarTokenized.slice(0, 2)) {
                assert.ok(
                    allScopes(commentLine).includes(getTokenScope('xmlDocBlockDelimiter', definition.id)),
                    `${definition.id}: extra-star block delimiter was not captured`,
                );
            }
            assert.ok(allScopes(extraStarTokenized[0]).includes(getTokenScope('xmlDocTagName', definition.id)));
            assert.ok(allScopes(extraStarTokenized[1]).includes(getTokenScope('xmlDocAtTag', definition.id)));
            assert.ok(
                !TOKEN_KEYS.some((key) => allScopes(extraStarTokenized[2]).includes(getTokenScope(key, definition.id))),
                `${definition.id}: extra-star block did not close`,
            );

            for (const [line, expectedOpener] of [
                ['/* body */', '/*'],
                ['/*** body */', '/***'],
                ['/**** body */', '/****'],
                ['/***/', '/**'],
                ['/****/', '/***'],
            ] as const) {
                const delimiterGrammar = await loadRegularBlockGrammar(definition.id);
                const tokens = delimiterGrammar.tokenizeLine(line, INITIAL).tokens;
                const delimiterScope = getTokenScope('xmlDocBlockDelimiter', definition.id);
                const delimiterTokens = tokens.filter((token) => token.scopes.includes(delimiterScope));
                const closingDelimiter = delimiterTokens[delimiterTokens.length - 1];
                assert.strictEqual(line.slice(
                    delimiterTokens[0]?.startIndex,
                    delimiterTokens[0]?.endIndex,
                ), expectedOpener, `${definition.id}: incorrect opener range for ${line}`);
                assert.strictEqual(line.slice(
                    closingDelimiter?.startIndex,
                    closingDelimiter?.endIndex,
                ), '*/', `${definition.id}: incorrect closer range for ${line}`);
                assert.ok(delimiterTokens.every((token) => (
                    token.scopes.includes(`comment.block.xml-doc-color.${definition.id}`)
                )), `${definition.id}: missing theme-inheriting comment parent`);
                if (!line.includes('body')) {
                    assert.strictEqual(delimiterTokens[0]?.endIndex, closingDelimiter?.startIndex);
                }
            }

            const exactDocumentationGrammar = await loadRegularBlockGrammar(definition.id);
            const exactDocumentation = exactDocumentationGrammar.tokenizeLine('/** documentation */', INITIAL).tokens;
            assert.ok(!allScopes(exactDocumentation).includes(
                getTokenScope('xmlDocBlockDelimiter', definition.id),
            ));
        });
    }

    test('keeps multiline CDATA state across C# documentation lines', async () => {
        const grammar = await loadGeneratedGrammar('csharp');
        const tokenized = tokenizeLines(grammar, [
            '/// <![CDATA[',
            '/// value < fakeTag',
            '/// ]]>',
        ]);
        const middleScopes = allScopes(tokenized[1]);
        assert.ok(middleScopes.includes(getTokenScope('xmlDocCDataText', 'csharp')));
        assert.ok(!middleScopes.includes(getTokenScope('xmlDocTagName', 'csharp')));
    });

    test('confines block injections to native documentation scopes', () => {
        for (const definition of LANGUAGE_DEFINITIONS.filter(({ documentationStyle }) => documentationStyle === 'block')) {
            const grammar = createGrammar(definition);
            const selectors = grammar.injectionSelector.split(',').map((selector) => selector.trim());
            const expected = (definition.documentationScopes ?? []).map((scope) => `L:${scope}`);
            assert.deepStrictEqual(selectors, expected);
            assert.ok(selectors.every((selector) => selector !== 'L:comment.block'));
        }
    });

    test('integrates with native C# and TypeScript grammars without leaking into code', async () => {
        const fixtures = {
            csharp: [
                '/// <summary>',
                '/// Builds <see cref="Result"/> &amp; validates it.',
                '/// </summary>',
                'public sealed class Example {}',
            ],
            typescript: [
                '/**',
                ' * Builds <see cref="Result" title=\'Docs\'/> &amp; validates it.',
                ' * {@link Result} documentation.',
                ' */',
                'const value = "/** <notDocumentation> */";',
            ],
        } as const;

        for (const [languageId, lines] of Object.entries(fixtures)) {
            const grammar = await loadWithBuiltInHost(languageId);
            const tokenized = tokenizeLines(grammar, lines);
            const documentationScopes = tokenized.slice(0, -1).flatMap(allScopes);
            const codeScopes = allScopes(tokenized[tokenized.length - 1] ?? []);

            for (const key of [
                'xmlDocTagName',
                'xmlDocTagDelimiter',
                'xmlDocAttribute',
                'xmlDocReferenceValue',
                'xmlDocEntity',
                'xmlDocText',
            ] as const) {
                assert.ok(documentationScopes.includes(getTokenScope(key, languageId)), `${languageId}: missing ${key}`);
            }
            assert.ok(!codeScopes.some((scopeName) => scopeName.includes('xml-doc-color')));
        }
    });

    test('colors ordinary blocks but excludes strings, regexes, templates, and line comments', async () => {
        for (const languageId of [
            'java',
            'typescript',
            'typescriptreact',
            'javascript',
            'javascriptreact',
        ]) {
            const grammar = await loadWithBuiltInHost(languageId);
            const excludedLines = languageId === 'java'
                ? [
                    'String stringValue = "/* not a comment */";',
                    '// /* not a block */',
                ]
                : [
                    'const stringValue = "/* not a comment */";',
                    'const templateValue = `/* not a comment */`;',
                    'const regexValue = /\\/\\* not-a-comment/;',
                    '// /* not a block */',
                ];
            const tokenized = tokenizeLines(grammar, [
                '/* <summary title="Docs">Text &amp;</summary> */',
                ...excludedLines,
            ]);

            assert.ok(allScopes(tokenized[0]).includes(getTokenScope('xmlDocBlockDelimiter', languageId)));
            for (const excludedLine of tokenized.slice(1)) {
                assert.ok(!allScopes(excludedLine).some((scopeName) => scopeName.includes('xml-doc-color')));
            }
        }
    });

    test('colors three-or-more-star blocks in the six bundled native language hosts', async () => {
        for (const languageId of [
            'java',
            'typescript',
            'typescriptreact',
            'javascript',
            'javascriptreact',
            'php',
        ]) {
            const grammar = await loadWithBuiltInHost(languageId);
            const tokenized = tokenizeLines(grammar, [
                '/*** <summary>Three stars</summary> */',
                '/**** @returns four stars */',
                'const afterExtraStars = 3;',
            ]);

            assert.ok(allScopes(tokenized[0]).includes(getTokenScope('xmlDocBlockDelimiter', languageId)));
            assert.ok(allScopes(tokenized[0]).includes(getTokenScope('xmlDocTagName', languageId)));
            assert.ok(allScopes(tokenized[1]).includes(getTokenScope('xmlDocAtTag', languageId)));
            assert.ok(!allScopes(tokenized[2]).some((scopeName) => scopeName.includes('xml-doc-color')));
        }
    });

    test('keeps JSDoc native, leaves C# block comments untouched, and excludes CSS in PHP files', async () => {
        const typescript = await loadWithBuiltInHost('typescript');
        const jsdoc = tokenizeLines(typescript, ['/** documentation */'])[0];
        assert.ok(!allScopes(jsdoc).includes(getTokenScope('xmlDocLinePrefix', 'typescript')));
        assert.ok(!allScopes(jsdoc).includes(getTokenScope('xmlDocBlockDelimiter', 'typescript')));
        assert.ok(allScopes(jsdoc).includes(getTokenScope('xmlDocText', 'typescript')));

        const csharp = await loadWithBuiltInHost('csharp');
        const csharpBlock = tokenizeLines(csharp, ['/* ordinary C# comment */'])[0];
        assert.ok(!allScopes(csharpBlock).some((scopeName) => scopeName.includes('xml-doc-color')));

        const php = await loadWithBuiltInHost('php', 'text.html.php');
        const phpLines = tokenizeLines(php, [
            '<style>/* CSS remains native */</style>',
            '<?php',
            '/* PHP uses XML Doc Color */',
            '?>',
        ]);
        assert.ok(!allScopes(phpLines[0]).some((scopeName) => scopeName.includes('xml-doc-color')));
        assert.ok(allScopes(phpLines[2]).includes(getTokenScope('xmlDocBlockDelimiter', 'php')));
        assert.ok(!allScopes(phpLines[3]).some((scopeName) => scopeName.includes('xml-doc-color')));
    });

    test('writes all generated grammar assets during the build', () => {
        const extension = vscode.extensions.getExtension('MindLated.xml-doc-color');
        assert.ok(extension);
        for (const language of LANGUAGE_DEFINITIONS) {
            assert.ok(fs.existsSync(path.join(extension.extensionPath, 'dist', 'syntaxes', `${language.id}.tmLanguage.json`)));
            if (language.regularBlockSelectors) {
                assert.ok(fs.existsSync(path.join(
                    extension.extensionPath,
                    'dist',
                    'syntaxes',
                    `${language.id}.block.tmLanguage.json`,
                )));
            }
        }
    });
});

suite('TextMate color rules', () => {
    const editorConfig = vscode.workspace.getConfiguration('editor');
    const extensionConfig = vscode.workspace.getConfiguration('xmlDocColor');
    let originalColors: TokenColorCustomizations | undefined;
    let originalTarget: unknown;

    setup(() => {
        originalColors = editorConfig.inspect<TokenColorCustomizations>('tokenColorCustomizations')?.globalValue;
        originalTarget = extensionConfig.inspect('configurationTarget')?.globalValue;
    });

    teardown(async () => {
        await editorConfig.update('tokenColorCustomizations', originalColors, vscode.ConfigurationTarget.Global);
        await extensionConfig.update('configurationTarget', originalTarget, vscode.ConfigurationTarget.Global);
    });

    test('writes global rules before language overrides and preserves foreign rules', async () => {
        const foreign: TextMateRule = {
            name: 'Foreign rule',
            scope: 'entity.name.type',
            settings: { foreground: '#ABCDEF' },
        };
        await editorConfig.update(
            'tokenColorCustomizations',
            { textMateRules: [foreign] },
            vscode.ConfigurationTarget.Global,
        );
        await extensionConfig.update('configurationTarget', 'global', vscode.ConfigurationTarget.Global);

        await writeColors(testColors(1), '*');
        await writeColors(testColors(32), 'typescript');

        const rules = editorConfig.inspect<TokenColorCustomizations>('tokenColorCustomizations')
            ?.globalValue?.textMateRules ?? [];
        assert.deepStrictEqual(rules[0], foreign);
        const allIndex = rules.findIndex((rule) => rule.name === 'XML Doc Color / xmlDocTagName / all');
        const languageIndex = rules.findIndex((rule) => rule.name === 'XML Doc Color / xmlDocTagName / typescript');
        assert.ok(allIndex > 0);
        assert.ok(languageIndex > allIndex);

        await resetColors('typescript');
        const afterReset = editorConfig.inspect<TokenColorCustomizations>('tokenColorCustomizations')
            ?.globalValue?.textMateRules ?? [];
        assert.ok(afterReset.some((rule) => rule.name === 'XML Doc Color / xmlDocTagName / all'));
        assert.ok(!afterReset.some((rule) => rule.name === 'XML Doc Color / xmlDocTagName / typescript'));
        assert.ok(afterReset.some((rule) => rule.name === 'Foreign rule'));
    });

    test('reapplies a language palette by replacing thirteen rules without duplicates', async () => {
        await extensionConfig.update('configurationTarget', 'global', vscode.ConfigurationTarget.Global);
        await writeColors(testColors(1), 'typescript');
        const replacement = testColors(96);
        await writeColors(replacement, 'typescript');

        const rules = editorConfig.inspect<TokenColorCustomizations>('tokenColorCustomizations')
            ?.globalValue?.textMateRules ?? [];
        const typescriptRules = rules.filter((rule) => rule.name?.endsWith('/ typescript'));
        assert.strictEqual(typescriptRules.length, TOKEN_KEYS.length);
        assert.strictEqual(
            typescriptRules.find((rule) => rule.name?.includes('xmlDocTagName'))?.settings?.foreground,
            replacement.xmlDocTagName,
        );
    });

    test('keeps a stored twelve-color palette untouched until the next Apply', async () => {
        const oldTokenKeys = TOKEN_KEYS.filter((key) => key !== 'xmlDocBlockDelimiter');
        const oldRules: TextMateRule[] = oldTokenKeys.map((key, index) => ({
            name: `XML Doc Color / ${key} / typescript`,
            scope: getTokenScope(key, 'typescript'),
            settings: { foreground: `#${(index + 1).toString(16).padStart(2, '0').repeat(3)}` },
        }));
        await editorConfig.update(
            'tokenColorCustomizations',
            { textMateRules: oldRules },
            vscode.ConfigurationTarget.Global,
        );
        await extensionConfig.update('configurationTarget', 'global', vscode.ConfigurationTarget.Global);

        const beforeApply = editorConfig.inspect<TokenColorCustomizations>('tokenColorCustomizations')
            ?.globalValue?.textMateRules ?? [];
        assert.strictEqual(beforeApply.length, 12);
        assert.strictEqual(readResolvedColors('typescript').sources.xmlDocBlockDelimiter, 'theme');

        await writeColors(testColors(96), 'typescript');

        const afterApply = editorConfig.inspect<TokenColorCustomizations>('tokenColorCustomizations')
            ?.globalValue?.textMateRules ?? [];
        assert.strictEqual(afterApply.filter((rule) => rule.name?.endsWith('/ typescript')).length, 13);
        assert.ok(afterApply.some((rule) => rule.name === (
            'XML Doc Color / xmlDocBlockDelimiter / typescript'
        )));
    });

    test('applying an all-language palette removes overrides that would mask it', async () => {
        const foreign: TextMateRule = {
            name: 'Foreign rule',
            scope: 'entity.name.type',
            settings: { foreground: '#ABCDEF' },
        };
        await editorConfig.update(
            'tokenColorCustomizations',
            { textMateRules: [foreign] },
            vscode.ConfigurationTarget.Global,
        );
        await extensionConfig.update('configurationTarget', 'global', vscode.ConfigurationTarget.Global);

        await writeColors(testColors(1), 'typescript');
        const allLanguages = testColors(96);
        await writeColors(allLanguages, '*');

        const rules = editorConfig.inspect<TokenColorCustomizations>('tokenColorCustomizations')
            ?.globalValue?.textMateRules ?? [];
        assert.strictEqual(rules.filter((rule) => rule.name?.endsWith('/ all')).length, TOKEN_KEYS.length);
        assert.ok(!rules.some((rule) => rule.name?.endsWith('/ typescript')));
        assert.ok(rules.some((rule) => rule.name === 'Foreign rule'));
        const blockDelimiterRule = rules.find((rule) => (
            rule.name === 'XML Doc Color / xmlDocBlockDelimiter / all'
        ));
        assert.ok(Array.isArray(blockDelimiterRule?.scope));
        assert.deepStrictEqual(
            blockDelimiterRule.scope,
            REGULAR_BLOCK_LANGUAGE_IDS.map((languageId) => (
                getTokenScope('xmlDocBlockDelimiter', languageId)
            )),
        );

        const resolved = readResolvedColors('typescript');
        assert.strictEqual(resolved.sources.xmlDocTagName, 'all');
        assert.strictEqual(resolved.colors.xmlDocTagName, allLanguages.xmlDocTagName);
    });

    test('resetting all languages keeps explicit language overrides', async () => {
        await editorConfig.update(
            'tokenColorCustomizations',
            { textMateRules: [] },
            vscode.ConfigurationTarget.Global,
        );
        await extensionConfig.update('configurationTarget', 'global', vscode.ConfigurationTarget.Global);
        await writeColors(testColors(1), '*');
        const typescript = testColors(64);
        await writeColors(typescript, 'typescript');

        await resetColors('*');

        const rules = editorConfig.inspect<TokenColorCustomizations>('tokenColorCustomizations')
            ?.globalValue?.textMateRules ?? [];
        assert.ok(!rules.some((rule) => rule.name?.endsWith('/ all')));
        assert.strictEqual(rules.filter((rule) => rule.name?.endsWith('/ typescript')).length, TOKEN_KEYS.length);
        const resolved = readResolvedColors('typescript');
        assert.strictEqual(resolved.sources.xmlDocTagName, 'language');
        assert.strictEqual(resolved.colors.xmlDocTagName, typescript.xmlDocTagName);
    });

    test('rejects invalid colors and unavailable workspace writes', async () => {
        await extensionConfig.update('configurationTarget', 'global', vscode.ConfigurationTarget.Global);
        await assert.rejects(
            writeColors({ ...testColors(), xmlDocTagName: 'red' }, '*'),
            /Invalid XML doc color/,
        );

        if (!vscode.workspace.workspaceFile && !vscode.workspace.workspaceFolders?.length) {
            await extensionConfig.update('configurationTarget', 'workspace', vscode.ConfigurationTarget.Global);
            await assert.rejects(writeColors(testColors(), '*'), /Open a workspace/);
        }
    });

    test('reads language, all-language, and inherited sources', async () => {
        await extensionConfig.update('configurationTarget', 'global', vscode.ConfigurationTarget.Global);
        await writeColors(testColors(1), '*');
        let resolved = readResolvedColors('typescript');
        assert.strictEqual(resolved.sources.xmlDocTagName, 'all');

        await writeColors(testColors(64), 'typescript');
        resolved = readResolvedColors('typescript');
        assert.strictEqual(resolved.sources.xmlDocTagName, 'language');

        await resetColors('typescript');
        await resetColors('*');
        resolved = readResolvedColors('typescript');
        assert.strictEqual(resolved.sources.xmlDocTagName, 'theme');
    });

    test('exports only token types applicable to the selected language', () => {
        const snippet = getThemeCustomizationSnippet(DARK_PRESET_COLORS, 'typescript');
        const parsed = JSON.parse(snippet) as {
            'editor.tokenColorCustomizations': { textMateRules: TextMateRule[] };
        };
        const rules = parsed['editor.tokenColorCustomizations'].textMateRules;
        assert.strictEqual(rules.length, 13);
        assert.ok(rules.every((rule) => !Array.isArray(rule.scope) && String(rule.scope).endsWith('.typescript')));

        const csharpSnippet = JSON.parse(getThemeCustomizationSnippet(DARK_PRESET_COLORS, 'csharp')) as {
            'editor.tokenColorCustomizations': { textMateRules: TextMateRule[] };
        };
        assert.strictEqual(csharpSnippet['editor.tokenColorCustomizations'].textMateRules.length, 12);
        assert.ok(!csharpSnippet['editor.tokenColorCustomizations'].textMateRules.some((rule) => (
            rule.name?.includes('xmlDocBlockDelimiter')
        )));
    });
});

suite('Legacy semantic color migration', () => {
    test('moves global, language, and theme rules while preserving unrelated settings', () => {
        const migration = migrateCustomizationValues({
            enabled: true,
            rules: {
                xmlDocTagName: { foreground: '#112233', bold: true, italic: true },
                'xmlDocText:typescript': '#445566',
                variable: '#FFFFFF',
            },
            '[Dark+]': {
                rules: {
                    xmlDocAtTag: { foreground: '#778899', underline: true },
                    function: '#ABCDEF',
                },
            },
        }, {
            textMateRules: [{ name: 'Foreign', scope: 'entity.name.type', settings: { foreground: '#FFFFFF' } }],
        });

        assert.strictEqual(migration.convertedRuleNames.length, 3);
        assert.deepStrictEqual((migration.semantic?.rules as Record<string, unknown>), { variable: '#FFFFFF' });
        assert.deepStrictEqual(
            ((migration.semantic?.['[Dark+]'] as Record<string, unknown>).rules as Record<string, unknown>),
            { function: '#ABCDEF' },
        );
        const rules = migration.textMate.textMateRules ?? [];
        assert.ok(rules.some((rule) => rule.name === 'Foreign'));
        const migrated = rules.find((rule) => rule.name === 'XML Doc Color / xmlDocTagName / all');
        assert.strictEqual(migrated?.settings?.foreground, '#112233');
        assert.strictEqual(migrated?.settings?.fontStyle, 'italic bold');
        const theme = migration.textMate['[Dark+]'] as TokenColorCustomizations;
        assert.ok(theme.textMateRules?.some((rule) => rule.name === 'XML Doc Color / xmlDocAtTag / all'));
    });

    test('is idempotent and keeps an existing TextMate rule as the source of truth', () => {
        const existing: TextMateRule = {
            name: 'XML Doc Color / xmlDocTagName / all',
            scope: LANGUAGE_DEFINITIONS.map(({ id }) => getTokenScope('xmlDocTagName', id)),
            settings: { foreground: '#AABBCC' },
        };
        const migration = migrateCustomizationValues(
            { rules: { xmlDocTagName: '#112233' } },
            { textMateRules: [existing] },
        );
        assert.strictEqual(migration.textMate.textMateRules?.length, 1);
        assert.strictEqual(migration.textMate.textMateRules?.[0].settings?.foreground, '#AABBCC');

        const second = migrateCustomizationValues(migration.semantic, migration.textMate);
        assert.strictEqual(second.convertedRuleNames.length, 0);
    });

    test('keeps legacy data when writing the replacement rules fails', async () => {
        const legacy = { rules: { xmlDocTagName: '#112233' } };
        const migration = migrateCustomizationValues(legacy, undefined);
        let semanticWriteCount = 0;

        await assert.rejects(
            persistMigration(migration, {
                writeTextMate: async () => {
                    throw new Error('simulated write failure');
                },
                readTextMate: () => migration.textMate,
                writeSemantic: async () => {
                    semanticWriteCount += 1;
                },
            }, 'test'),
            /simulated write failure/,
        );

        assert.strictEqual(semanticWriteCount, 0);
        assert.deepStrictEqual(legacy, { rules: { xmlDocTagName: '#112233' } });
    });
});

suite('Webview contract and extension commands', () => {
    test('accepts a complete thirteen-color payload and rejects incomplete payloads', () => {
        const valid = normalizeWebviewMessage({
            type: 'apply',
            mode: 'custom',
            colors: testColors(),
        });
        assert.ok(valid);
        assert.strictEqual(Object.keys(valid.type === 'apply' ? valid.colors : {}).length, 13);
        assert.strictEqual(normalizeWebviewMessage({
            type: 'apply',
            mode: 'custom',
            colors: { xmlDocTagName: '#112233' },
        }), undefined);
    });

    test('uses external webview assets and a nonce-based CSP', () => {
        const extension = vscode.extensions.getExtension('MindLated.xml-doc-color');
        assert.ok(extension);
        const html = fs.readFileSync(path.join(extension.extensionPath, 'media', 'settingsPanel.html'), 'utf8');
        assert.ok(html.includes("script-src 'nonce-{{nonce}}'"));
        assert.ok(html.includes('{{styleUri}}'));
        assert.ok(html.includes('{{scriptUri}}'));
        assert.ok(html.includes('role="status"'));
        assert.ok(!html.includes('style="'));
    });

    test('registers the retained commands and removes the runtime toggle', async function () {
        this.timeout(10_000);
        await vscode.extensions.getExtension('MindLated.xml-doc-color')?.activate();
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('xmlDocColor.openColorPicker'));
        assert.ok(commands.includes('xmlDocColor.copyThemeRules'));
        assert.ok(commands.includes('xmlDocColor.openThemeSnippet'));
        assert.ok(!commands.includes('xmlDocColor.toggleEnabled'));
    });

    test('keeps both palettes complete and distinct', () => {
        assert.deepStrictEqual(Object.keys(DARK_PRESET_COLORS), [...TOKEN_KEYS]);
        assert.deepStrictEqual(Object.keys(LIGHT_PRESET_COLORS), [...TOKEN_KEYS]);
        assert.notDeepStrictEqual(DARK_PRESET_COLORS, LIGHT_PRESET_COLORS);
    });
});
