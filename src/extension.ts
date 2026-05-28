import * as vscode from 'vscode';
import { XmlDocSemanticTokensProvider, LEGEND } from './provider';
import { SUPPORTED_LANGUAGES } from './languages';
import { ColorPickerViewProvider } from './colorPickerView';

export function activate(context: vscode.ExtensionContext): void {
    const provider = new XmlDocSemanticTokensProvider();

    const selector: vscode.DocumentSelector = SUPPORTED_LANGUAGES.map(language => ({
        language,
        scheme: 'file',
    }));

    // Also match untitled documents (e.g. unsaved scratch files)
    const selectorUntitled: vscode.DocumentSelector = SUPPORTED_LANGUAGES.map(language => ({
        language,
        scheme: 'untitled',
    }));

    const combined: vscode.DocumentSelector = [...(selector as vscode.DocumentFilter[]), ...(selectorUntitled as vscode.DocumentFilter[])];

    context.subscriptions.push(
        vscode.languages.registerDocumentSemanticTokensProvider(combined, provider, LEGEND),
        vscode.languages.registerDocumentRangeSemanticTokensProvider(combined, provider, LEGEND),
        vscode.window.registerWebviewViewProvider(
            ColorPickerViewProvider.viewType,
            new ColorPickerViewProvider(context.extensionUri),
            { webviewOptions: { retainContextWhenHidden: true } },
        ),
        vscode.commands.registerCommand('xmlDocColor.openColorPicker', async () => {
            await vscode.commands.executeCommand('xmlDocColor.colorPicker.focus');
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (
                event.affectsConfiguration('xmlDocColor') ||
                event.affectsConfiguration('editor.semanticTokenColorCustomizations')
            ) {
                provider.refresh();
            }
        }),
    );
}

export function deactivate(): void { /* nothing to clean up */ }
