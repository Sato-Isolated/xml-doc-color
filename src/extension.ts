import * as vscode from 'vscode';
import {
    getThemeCustomizationSnippet,
    migrateLegacyColorRules,
    readColors,
} from './colorConfig';
import { ColorPickerViewProvider } from './colorPickerView';
import { SUPPORTED_LANGUAGES } from './model';

const SIDEBAR_HINT_KEY = 'xmlDocColor.didShowSidebarHint';

/**
 * Activates only imperative UI/settings behavior.
 *
 * Syntax highlighting is contributed declaratively by package.json and does
 * not depend on this function or register any semantic-token provider.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const selector: vscode.DocumentSelector = SUPPORTED_LANGUAGES.map((language) => ({ language }));
    const colorPickerViewProvider = new ColorPickerViewProvider(context.extensionUri);
    let statusItem: vscode.LanguageStatusItem | undefined;

    function activeDocument(): vscode.TextDocument | undefined {
        return vscode.window.activeTextEditor?.document;
    }

    function isSupportedDocument(document: vscode.TextDocument | undefined): boolean {
        return !!document && SUPPORTED_LANGUAGES.includes(document.languageId);
    }

    function isStatusItemEnabled(): boolean {
        return vscode.workspace.getConfiguration('xmlDocColor').get<boolean>('showStatusItem', true);
    }

    function updateStatusItem(): void {
        if (!isStatusItemEnabled()) {
            statusItem?.dispose();
            statusItem = undefined;
            return;
        }

        if (!statusItem) {
            statusItem = vscode.languages.createLanguageStatusItem('xmlDocColor.status', selector);
            statusItem.name = 'XML Doc Color';
            statusItem.text = '$(symbol-color) XML Doc Color';
            statusItem.command = {
                title: 'Open Color Picker',
                command: 'xmlDocColor.openColorPicker',
            };
            context.subscriptions.push(statusItem);
        }

        statusItem.severity = vscode.LanguageStatusSeverity.Information;
        statusItem.detail = isSupportedDocument(activeDocument())
            ? 'TextMate documentation and block-comment scopes active'
            : 'Open a supported document';
    }

    async function maybeShowSidebarHint(): Promise<void> {
        const hasShownHint = context.globalState.get<boolean>(SIDEBAR_HINT_KEY, false);
        if (!hasShownHint && !isSupportedDocument(activeDocument())) {
            await vscode.window.showInformationMessage(
                'XML Doc Color: open a supported editor to compare the preview with TextMate highlighting.',
            );
        }
        if (!hasShownHint) {
            await context.globalState.update(SIDEBAR_HINT_KEY, true);
        }
    }

    try {
        // Migration is safe to retry on every activation. The success/error
        // notification is intentionally non-blocking in headless/Web hosts.
        const migrated = await migrateLegacyColorRules();
        if (migrated > 0) {
            void vscode.window.showInformationMessage(
                `XML Doc Color migrated ${migrated} semantic color rule${migrated === 1 ? '' : 's'} to TextMate.`,
            );
        }
    } catch (error) {
        void vscode.window.showErrorMessage(
            `XML Doc Color could not migrate legacy color rules. Existing rules were kept. ${formatError(error)}`,
        );
    }

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ColorPickerViewProvider.viewType,
            colorPickerViewProvider,
        ),
        vscode.commands.registerCommand('xmlDocColor.openColorPicker', async () => {
            await maybeShowSidebarHint();
            await vscode.commands.executeCommand('xmlDocColor.colorPicker.focus');
        }),
        vscode.commands.registerCommand('xmlDocColor.copyThemeRules', async () => {
            const document = activeDocument();
            const language = document && isSupportedDocument(document) ? document.languageId : '*';
            await vscode.env.clipboard.writeText(
                getThemeCustomizationSnippet(readColors(language), language),
            );
            await vscode.window.showInformationMessage('XML Doc Color: TextMate customization JSON copied.');
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
        vscode.window.onDidChangeActiveColorTheme(() => {
            colorPickerViewProvider.refresh();
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (
                event.affectsConfiguration('xmlDocColor')
                || event.affectsConfiguration('editor.tokenColorCustomizations')
            ) {
                updateStatusItem();
                colorPickerViewProvider.refresh();
            }
        }),
    );

    updateStatusItem();
}

/** No runtime resources exist outside the disposables owned by the context. */
export function deactivate(): void {}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
