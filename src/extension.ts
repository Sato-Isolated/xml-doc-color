import * as vscode from 'vscode';
import {
    getThemeCustomizationSnippet,
    readColors,
    getConfigurationTarget,
} from './colorConfig';
import { ColorPickerViewProvider } from './colorPickerView';
import { getEnabledLanguages, SUPPORTED_LANGUAGES } from './languages';
import { XmlDocSemanticTokensProvider, LEGEND } from './provider';

const WALKTHROUGH_KEY = 'xmlDocColor.didShowSidebarHint';

export function activate(context: vscode.ExtensionContext): void {
    const provider = new XmlDocSemanticTokensProvider();
    const combined: vscode.DocumentSelector = SUPPORTED_LANGUAGES.map((language) => ({ language }));
    const colorPickerViewProvider = new ColorPickerViewProvider(context.extensionUri);

    let statusItem: vscode.LanguageStatusItem | undefined;

    function activeDocument(): vscode.TextDocument | undefined {
        return vscode.window.activeTextEditor?.document;
    }

    function isSupportedDocument(document: vscode.TextDocument | undefined): boolean {
        return !!document && SUPPORTED_LANGUAGES.includes(document.languageId);
    }

    function enabledLanguages(): readonly string[] {
        return getEnabledLanguages();
    }

    function isStatusItemEnabled(): boolean {
        return vscode.workspace.getConfiguration('xmlDocColor', activeDocument()).get<boolean>('showStatusItem', true);
    }

    function ensureStatusItem(): vscode.LanguageStatusItem | undefined {
        if (!isStatusItemEnabled()) {
            statusItem?.dispose();
            statusItem = undefined;
            return undefined;
        }

        if (!statusItem) {
            statusItem = vscode.languages.createLanguageStatusItem('xmlDocColor.status', combined);
            statusItem.name = 'XML Doc Color';
            statusItem.text = '$(symbol-color) XML Doc Color';
            statusItem.command = {
                title: 'Open Color Picker',
                command: 'xmlDocColor.openColorPicker',
            };
            context.subscriptions.push(statusItem);
        }

        return statusItem;
    }

    function updateContextKeys(): void {
        const document = activeDocument();
        const supported = isSupportedDocument(document);
        const activeLanguage = document?.languageId;
        const enabledForLanguage = !!activeLanguage && enabledLanguages().includes(activeLanguage);

        void vscode.commands.executeCommand('setContext', 'xmlDocColor.hasSupportedEditor', supported);
        void vscode.commands.executeCommand('setContext', 'xmlDocColor.isEnabledForActiveLanguage', enabledForLanguage);
    }

    function updateStatusItem(): void {
        const item = ensureStatusItem();
        if (!item) {
            updateContextKeys();
            return;
        }

        const document = activeDocument();
        const config = vscode.workspace.getConfiguration('xmlDocColor', document);
        const enabled = config.get<boolean>('enabled', true);
        const activeLanguage = document?.languageId;
        const languageEnabled = !!activeLanguage && enabledLanguages().includes(activeLanguage);

        item.severity = enabled && languageEnabled
            ? vscode.LanguageStatusSeverity.Information
            : vscode.LanguageStatusSeverity.Warning;

        if (!document || !SUPPORTED_LANGUAGES.includes(document.languageId)) {
            item.detail = 'Open a supported file to preview XML doc semantic colors.';
        } else if (!enabled) {
            item.detail = 'Disabled';
        } else if (!languageEnabled) {
            item.detail = `Disabled for ${document.languageId}`;
        } else {
            item.detail = 'Active';
        }

        updateContextKeys();
    }

    async function maybeShowSidebarHint(): Promise<void> {
        const hasShownHint = context.globalState.get<boolean>(WALKTHROUGH_KEY, false);
        if (hasShownHint) {
            return;
        }

        if (!isSupportedDocument(activeDocument())) {
            await vscode.window.showInformationMessage(
                'XML Doc Color: open a supported editor to preview live semantic colors in the sidebar.',
            );
        }

        await context.globalState.update(WALKTHROUGH_KEY, true);
    }

    context.subscriptions.push(
        vscode.languages.registerDocumentSemanticTokensProvider(combined, provider, LEGEND),
        vscode.languages.registerDocumentRangeSemanticTokensProvider(combined, provider, LEGEND),
        vscode.window.registerWebviewViewProvider(
            ColorPickerViewProvider.viewType,
            colorPickerViewProvider,
        ),
        vscode.commands.registerCommand('xmlDocColor.openColorPicker', async () => {
            await maybeShowSidebarHint();
            await vscode.commands.executeCommand('xmlDocColor.colorPicker.focus');
        }),
        vscode.commands.registerCommand('xmlDocColor.toggleEnabled', async () => {
            const document = activeDocument();
            const config = vscode.workspace.getConfiguration('xmlDocColor', document);
            const current = config.get<boolean>('enabled', true);
            await config.update('enabled', !current, getConfigurationTarget());
            provider.refresh();
            updateStatusItem();
        }),
        vscode.commands.registerCommand('xmlDocColor.copyThemeRules', async () => {
            const document = activeDocument();
            const language = document && isSupportedDocument(document) ? document.languageId : '*';
            const json = getThemeCustomizationSnippet(readColors(language), language);
            await vscode.env.clipboard.writeText(json);
            await vscode.window.showInformationMessage('XML Doc Color: customization JSON copied to clipboard.');
        }),
        vscode.commands.registerCommand('xmlDocColor.openThemeSnippet', async () => {
            const document = activeDocument();
            const language = document && isSupportedDocument(document) ? document.languageId : '*';
            const snippet = getThemeCustomizationSnippet(readColors(language), language);
            const untitled = await vscode.workspace.openTextDocument({
                language: 'jsonc',
                content: `${snippet}\n`,
            });
            await vscode.window.showTextDocument(untitled, { preview: false });
        }),
        vscode.window.onDidChangeActiveTextEditor(() => {
            updateStatusItem();
            colorPickerViewProvider.refresh();
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (
                event.affectsConfiguration('xmlDocColor') ||
                event.affectsConfiguration('editor.semanticTokenColorCustomizations')
            ) {
                provider.refresh();
                updateStatusItem();
                colorPickerViewProvider.refresh();
            }
        }),
    );

    updateStatusItem();
}

export function deactivate(): void {
    // Nothing to clean up explicitly.
}
