import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { readColors, resetColors, writeColors } from '../colorConfig';
import { normalizeWebviewMessage } from '../colorPickerView';
import { getSidebarPreviewData, SUPPORTED_LANGUAGES } from '../languages';
import { parseDocLine, TOKEN_TYPES } from '../parser';
import { XmlDocSemanticTokensProvider } from '../provider';

suite('Sidebar Preview Data', () => {
	test('provides one option and one preview per supported language', () => {
		const previewData = getSidebarPreviewData();
		const optionIds = new Set(previewData.options.map((option) => option.id));

		assert.ok(optionIds.has('*'));
		assert.ok(previewData.previews['*']);

		for (const languageId of SUPPORTED_LANGUAGES) {
			assert.ok(optionIds.has(languageId), `missing selector option for ${languageId}`);
			assert.ok(previewData.previews[languageId], `missing preview for ${languageId}`);
		}

		assert.strictEqual(previewData.options.length, SUPPORTED_LANGUAGES.length + 1);

		const previewIds = new Set(Object.keys(previewData.previews));
		assert.strictEqual(previewIds.size, SUPPORTED_LANGUAGES.length + 1);
	});

	test('shows @-tags only for block-doc languages', () => {
		const previewData = getSidebarPreviewData();

		for (const languageId of ['csharp', 'vb', 'fsharp']) {
			assert.strictEqual(previewData.previews[languageId].usesAtTags, false, `${languageId} should hide @-tags`);
		}

		for (const languageId of ['*', 'java', 'typescript', 'javascript', 'php', 'kotlin']) {
			assert.strictEqual(previewData.previews[languageId].usesAtTags, true, `${languageId} should show @-tags`);
		}
	});

	test('tracks which token rows are shown by each preview', () => {
		const previewData = getSidebarPreviewData();
		const xmlDocTokens = ['xmlDocTagName', 'xmlDocTagDelimiter', 'xmlDocAttribute', 'xmlDocAttributeValue', 'xmlDocLinePrefix', 'xmlDocText'];
		const blockDocTokens = [...xmlDocTokens.slice(0, 4), 'xmlDocAtTag', 'xmlDocLinePrefix', 'xmlDocText'];

		for (const languageId of ['csharp', 'vb', 'fsharp']) {
			assert.deepStrictEqual(
				previewData.previews[languageId].usedTokenKeys,
				xmlDocTokens,
				`${languageId} should preview every XML-doc token color`,
			);
		}

		for (const languageId of ['*', 'java', 'typescript', 'javascript', 'php', 'kotlin']) {
			assert.deepStrictEqual(
				previewData.previews[languageId].usedTokenKeys,
				blockDocTokens,
				`${languageId} should preview every block-doc token color`,
			);
		}
	});

	test('uses the correct block comment prefixes for block-doc languages', () => {
		const previewData = getSidebarPreviewData();

		for (const languageId of ['java', 'typescript', 'javascript', 'php', 'kotlin']) {
			const lines = previewData.previews[languageId].lines;
			assert.strictEqual(lines[0].prefix, '/**', `${languageId} should start with /**`);
			assert.ok(lines.some((line) => line.prefix === ' * '), `${languageId} should have continuation lines`);
			assert.strictEqual(lines[lines.length - 1].prefix, ' */', `${languageId} should close with */`);
		}
	});

	test('keeps distinct preview content per language family', () => {
		const previewData = getSidebarPreviewData();

		assert.ok(previewData.previews.csharp.lines.some((line) => line.text.includes('<typeparam name="T">')));
		assert.ok(previewData.previews.vb.lines.every((line) => line.prefix.startsWith("'''") || line.prefix === ''));
		assert.ok(previewData.previews.fsharp.lines.some((line) => line.text.includes('<typeparam name="\'T">')));
		assert.ok(previewData.previews.java.lines.some((line) => line.text.includes('@param <T> element type')));
		assert.ok(previewData.previews.typescript.lines.some((line) => line.text.includes('@typeParam T - Element type')));
		assert.ok(previewData.previews.javascript.lines.some((line) => line.text.includes('@param {number} count Maximum items to read')));
		assert.ok(previewData.previews.php.lines.some((line) => line.text.includes('@param list<T> $source Input sequence')));
		assert.ok(previewData.previews.kotlin.lines.some((line) => line.text.includes('@see Options')));
	});
});

suite('parseDocLine', () => {
	test('parses XML tags with attributes and closing tags', () => {
		const tokens = parseDocLine('<param name="source">Input</param>');

		assert.deepStrictEqual(tokens, [
			{ type: TOKEN_TYPES.xmlDocTagDelimiter, start: 0, length: 1 },
			{ type: TOKEN_TYPES.xmlDocTagName, start: 1, length: 5 },
			{ type: TOKEN_TYPES.xmlDocAttribute, start: 7, length: 4 },
			{ type: TOKEN_TYPES.xmlDocAttributeValue, start: 12, length: 8 },
			{ type: TOKEN_TYPES.xmlDocTagDelimiter, start: 20, length: 1 },
			{ type: TOKEN_TYPES.xmlDocText, start: 21, length: 5 },
			{ type: TOKEN_TYPES.xmlDocTagDelimiter, start: 26, length: 2 },
			{ type: TOKEN_TYPES.xmlDocTagName, start: 28, length: 5 },
			{ type: TOKEN_TYPES.xmlDocTagDelimiter, start: 33, length: 1 },
		]);
	});

	test('parses inline and standalone @-tags', () => {
		const tokens = parseDocLine('{@link Result} and @param source');

		assert.deepStrictEqual(tokens, [
			{ type: TOKEN_TYPES.xmlDocText, start: 0, length: 1 },
			{ type: TOKEN_TYPES.xmlDocAtTag, start: 1, length: 5 },
			{ type: TOKEN_TYPES.xmlDocText, start: 6, length: 13 },
			{ type: TOKEN_TYPES.xmlDocAtTag, start: 19, length: 6 },
			{ type: TOKEN_TYPES.xmlDocText, start: 25, length: 7 },
		]);
	});

	test('emits delimiter tokens for unterminated XML comments without hanging', () => {
		const tokens = parseDocLine('<!-- comment');

		assert.deepStrictEqual(tokens, [
			{ type: TOKEN_TYPES.xmlDocTagDelimiter, start: 0, length: 4 },
		]);
	});
});

suite('colorConfig', () => {
	test('writeColors rejects invalid hex color values', async () => {
		const editorConfig = vscode.workspace.getConfiguration('editor');
		const originalCustomizations = editorConfig.inspect<Record<string, unknown>>('semanticTokenColorCustomizations')?.globalValue;

		try {
			await assert.rejects(
				writeColors({
					xmlDocTagName: 'not-a-color',
					xmlDocTagDelimiter: '#222222',
					xmlDocAttribute: '#333333',
					xmlDocAttributeValue: '#444444',
					xmlDocAtTag: '#555555',
					xmlDocLinePrefix: '#666666',
					xmlDocText: '#777777',
				}, '*'),
				/Invalid XML doc color/,
			);
		} finally {
			await editorConfig.update(
				'semanticTokenColorCustomizations',
				originalCustomizations,
				vscode.ConfigurationTarget.Global,
			);
		}
	});

	test('resetColors removes language overrides and falls back to global colors', async () => {
		const editorConfig = vscode.workspace.getConfiguration('editor');
		const originalCustomizations = editorConfig.inspect<Record<string, unknown>>('semanticTokenColorCustomizations')?.globalValue;

		try {
			await writeColors({
				xmlDocTagName: '#111111',
				xmlDocTagDelimiter: '#222222',
				xmlDocAttribute: '#333333',
				xmlDocAttributeValue: '#444444',
				xmlDocAtTag: '#555555',
				xmlDocLinePrefix: '#666666',
				xmlDocText: '#777777',
			}, '*');

			await writeColors({
				xmlDocTagName: '#AAAAAA',
				xmlDocTagDelimiter: '#BBBBBB',
				xmlDocAttribute: '#CCCCCC',
				xmlDocAttributeValue: '#DDDDDD',
				xmlDocAtTag: '#EEEEEE',
				xmlDocLinePrefix: '#FFFFFF',
				xmlDocText: '#0A0A0A',
			}, 'csharp');

			assert.strictEqual(readColors('csharp').xmlDocTagName, '#AAAAAA');

			await resetColors('csharp');

			const csharpColors = readColors('csharp');
			assert.strictEqual(csharpColors.xmlDocTagName, '#111111');
			assert.strictEqual(csharpColors.xmlDocAtTag, '#555555');
			assert.strictEqual(csharpColors.xmlDocLinePrefix, '#666666');
			assert.strictEqual(csharpColors.xmlDocText, '#777777');
		} finally {
			await editorConfig.update(
				'semanticTokenColorCustomizations',
				originalCustomizations,
				vscode.ConfigurationTarget.Global,
			);
		}
	});

	test('writeColors overrides XML doc token rules with full foreground settings', async () => {
		const editorConfig = vscode.workspace.getConfiguration('editor');
		const originalCustomizations = editorConfig.inspect<Record<string, unknown>>('semanticTokenColorCustomizations')?.globalValue;

		try {
			await writeColors({
				xmlDocTagName: '#111111',
				xmlDocTagDelimiter: '#222222',
				xmlDocAttribute: '#333333',
				xmlDocAttributeValue: '#444444',
				xmlDocAtTag: '#555555',
				xmlDocLinePrefix: '#666666',
				xmlDocText: '#777777',
			}, '*');

			const customizations = vscode.workspace
				.getConfiguration('editor')
				.get<Record<string, unknown>>('semanticTokenColorCustomizations') ?? {};
			const rules = customizations.rules as Record<string, unknown>;

			assert.deepStrictEqual(rules.xmlDocTagName, { foreground: '#111111', bold: true });
			assert.deepStrictEqual(rules.xmlDocTagDelimiter, { foreground: '#222222' });
			assert.deepStrictEqual(rules.xmlDocAttribute, { foreground: '#333333' });
			assert.deepStrictEqual(rules.xmlDocAttributeValue, { foreground: '#444444' });
			assert.deepStrictEqual(rules.xmlDocAtTag, { foreground: '#555555', bold: true });
			assert.deepStrictEqual(rules.xmlDocLinePrefix, { foreground: '#666666' });
			assert.deepStrictEqual(rules.xmlDocText, { foreground: '#777777' });
		} finally {
			await editorConfig.update(
				'semanticTokenColorCustomizations',
				originalCustomizations,
				vscode.ConfigurationTarget.Global,
			);
		}
	});
});

suite('ColorPickerViewProvider messages', () => {
	test('accepts valid apply messages', () => {
		const message = normalizeWebviewMessage({
			type: 'apply',
			colors: {
				xmlDocTagName: '#111111',
				xmlDocTagDelimiter: '#222222',
				xmlDocAttribute: '#333333',
				xmlDocAttributeValue: '#444444',
				xmlDocAtTag: '#555555',
				xmlDocLinePrefix: '#666666',
				xmlDocText: '#777777',
			},
		});

		assert.deepStrictEqual(message, {
			type: 'apply',
			colors: {
				xmlDocTagName: '#111111',
				xmlDocTagDelimiter: '#222222',
				xmlDocAttribute: '#333333',
				xmlDocAttributeValue: '#444444',
				xmlDocAtTag: '#555555',
				xmlDocLinePrefix: '#666666',
				xmlDocText: '#777777',
			},
		});
	});

	test('rejects invalid color and language messages', () => {
		assert.strictEqual(normalizeWebviewMessage({
			type: 'apply',
			colors: {
				xmlDocTagName: 'red',
				xmlDocTagDelimiter: '#222222',
				xmlDocAttribute: '#333333',
				xmlDocAttributeValue: '#444444',
				xmlDocAtTag: '#555555',
				xmlDocLinePrefix: '#666666',
				xmlDocText: '#777777',
			},
		}), undefined);

		assert.strictEqual(normalizeWebviewMessage({
			type: 'changeLanguage',
			language: 'not-supported',
		}), undefined);
	});
});

suite('Color Picker Webview HTML', () => {
	test('uses a Web Components shell with required CSP placeholders', async () => {
		const extension = vscode.extensions.getExtension('xml-doc-color.xml-doc-color');
		assert.ok(extension, 'expected development extension to be available');

		const htmlPath = path.join(extension.extensionPath, 'media', 'settingsPanel.html');
		const html = fs.readFileSync(htmlPath, 'utf-8');

		assert.ok(html.includes("style-src 'nonce-{{nonce}}'"), 'missing style nonce placeholder');
		assert.ok(html.includes("script-src 'nonce-{{nonce}}'"), 'missing script nonce placeholder');
		assert.ok(html.includes('{{cspSource}}'), 'missing CSP source placeholder');
		assert.ok(html.includes('const SIDEBAR_PREVIEW_DATA = {{sidebarPreviewData}};'), 'missing preview data placeholder');
		assert.ok(html.includes('<xml-doc-color-app></xml-doc-color-app>'), 'missing root Web Component');

		for (const componentName of [
			'xml-doc-color-app',
			'language-selector',
			'preview-panel',
			'token-color-row',
			'action-bar',
		]) {
			assert.ok(
				html.includes(`customElements.define('${componentName}'`),
				`missing ${componentName} definition`,
			);
		}
	});
});

suite('Extension contributions', () => {
	test('contributes a command to open the color picker', async () => {
		await vscode.extensions.getExtension('xml-doc-color.xml-doc-color')?.activate();
		const commands = await vscode.commands.getCommands(true);
		assert.ok(
			commands.includes('xmlDocColor.openColorPicker'),
			'expected xmlDocColor.openColorPicker to be available',
		);
	});
});

suite('XmlDocSemanticTokensProvider', () => {
	test('respects xmlDocColor.enabled', async () => {
		const config = vscode.workspace.getConfiguration('xmlDocColor');
		const originalEnabled = config.inspect<boolean>('enabled')?.globalValue;
		const provider = new XmlDocSemanticTokensProvider();
		const tokenSource = new vscode.CancellationTokenSource();
		const document = await vscode.workspace.openTextDocument({
			language: 'csharp',
			content: '/// <summary name="value">Hello</summary>',
		});

		try {
			await config.update('enabled', true, vscode.ConfigurationTarget.Global);
			const enabledTokens = await Promise.resolve(
				provider.provideDocumentSemanticTokens(document, tokenSource.token),
			);
			assert.ok(enabledTokens);
			assert.ok(enabledTokens.data.length > 0, 'expected semantic tokens when enabled');

			await config.update('enabled', false, vscode.ConfigurationTarget.Global);
			const disabledTokens = await Promise.resolve(
				provider.provideDocumentSemanticTokens(document, tokenSource.token),
			);
			assert.ok(disabledTokens);
			assert.strictEqual(disabledTokens.data.length, 0, 'expected no semantic tokens when disabled');
		} finally {
			tokenSource.dispose();
			await config.update('enabled', originalEnabled, vscode.ConfigurationTarget.Global);
		}
	});

	test('uses configured block doc parsing for block-doc languages', async () => {
		const config = vscode.workspace.getConfiguration('xmlDocColor');
		const originalEnabled = config.inspect<boolean>('enabled')?.globalValue;
		const provider = new XmlDocSemanticTokensProvider();
		const tokenSource = new vscode.CancellationTokenSource();
		const document = await vscode.workspace.openTextDocument({
			language: 'typescript',
			content: '/** <param name="source">Input</param> */',
		});

		try {
			await config.update('enabled', true, vscode.ConfigurationTarget.Global);
			const tokens = await Promise.resolve(
				provider.provideDocumentSemanticTokens(document, tokenSource.token),
			);
			assert.ok(tokens);
			assert.ok(tokens.data.length > 0, 'expected semantic tokens for configured block-doc comments');
		} finally {
			tokenSource.dispose();
			await config.update('enabled', originalEnabled, vscode.ConfigurationTarget.Global);
		}
	});

	test('parses XML tokens on a multi-line block opening line', async () => {
		const config = vscode.workspace.getConfiguration('xmlDocColor');
		const originalEnabled = config.inspect<boolean>('enabled')?.globalValue;
		const provider = new XmlDocSemanticTokensProvider();
		const tokenSource = new vscode.CancellationTokenSource();
		const document = await vscode.workspace.openTextDocument({
			language: 'typescript',
			content: [
				'/** <summary>',
				' * Documentation text.',
				' */',
			].join('\n'),
		});

		try {
			await config.update('enabled', true, vscode.ConfigurationTarget.Global);
			const tokens = await Promise.resolve(
				provider.provideDocumentSemanticTokens(document, tokenSource.token),
			);
			assert.ok(tokens);
			assert.ok(tokens.data.length > 0, 'expected semantic tokens from the block opening line');
		} finally {
			tokenSource.dispose();
			await config.update('enabled', originalEnabled, vscode.ConfigurationTarget.Global);
		}
	});

	test('returns no tokens when cancellation is already requested', async () => {
		const config = vscode.workspace.getConfiguration('xmlDocColor');
		const originalEnabled = config.inspect<boolean>('enabled')?.globalValue;
		const provider = new XmlDocSemanticTokensProvider();
		const tokenSource = new vscode.CancellationTokenSource();
		const document = await vscode.workspace.openTextDocument({
			language: 'csharp',
			content: '/// <summary>Cancelled</summary>',
		});

		try {
			await config.update('enabled', true, vscode.ConfigurationTarget.Global);
			tokenSource.cancel();
			const tokens = await Promise.resolve(
				provider.provideDocumentSemanticTokens(document, tokenSource.token),
			);
			assert.ok(tokens);
			assert.strictEqual(tokens.data.length, 0, 'expected no semantic tokens after cancellation');
		} finally {
			tokenSource.dispose();
			await config.update('enabled', originalEnabled, vscode.ConfigurationTarget.Global);
		}
	});
});
