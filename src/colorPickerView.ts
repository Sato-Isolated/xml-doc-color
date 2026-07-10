import * as vscode from 'vscode';
import {
    DARK_PRESET_COLORS,
    getThemeCustomizationSnippet,
    LIGHT_PRESET_COLORS,
    getConfigurationTarget,
    readResolvedColors,
    resetColors,
    writeColors,
} from './colorConfig';
import { getSidebarPreviewData } from './languages';
import {
    ExtensionMessage,
    normalizeWebviewMessage,
    PresetMode,
} from './messages';
import {
    DocColors,
    SUPPORTED_LANGUAGES,
    TOKEN_DEFINITIONS,
} from './model';

export { normalizeWebviewMessage } from './messages';
export type { PresetMode, WebviewMessage } from './messages';

function getNonce(): string {
    const bytes = new Uint8Array(24);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getPresetColors(mode: PresetMode): DocColors | undefined {
    switch (mode) {
        case 'dark':
            return DARK_PRESET_COLORS;
        case 'light':
            return LIGHT_PRESET_COLORS;
        case 'custom':
        case 'inherited':
            return undefined;
    }
}

function hasWorkspace(): boolean {
    return !!vscode.workspace.workspaceFile || !!vscode.workspace.workspaceFolders?.length;
}

/**
 * Bridges the extension host and the isolated sidebar webview.
 *
 * It owns all VS Code API access and settings writes; the webview receives only
 * serializable snapshots and sends messages that are validated at the boundary.
 */
export class ColorPickerViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'xmlDocColor.colorPicker';

    private view?: vscode.WebviewView;
    private language = '*';

    constructor(private readonly extensionUri: vscode.Uri) {}

    /** Pushes a fresh settings snapshot when editors, themes, or config change. */
    refresh(): void {
        void this.sendColors();
    }

    /** Configures the CSP-restricted view and attaches its validated message router. */
    async resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            enableForms: false,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, 'media'),
                vscode.Uri.joinPath(this.extensionUri, 'dist'),
            ],
        };
        webviewView.webview.html = await this.buildHtml(webviewView.webview);

        webviewView.onDidDispose(() => {
            if (this.view === webviewView) {
                this.view = undefined;
            }
        });

        webviewView.webview.onDidReceiveMessage(async (rawMessage: unknown) => {
            const message = normalizeWebviewMessage(rawMessage);
            if (!message) {
                return;
            }

            try {
                switch (message.type) {
                    case 'ready':
                        await this.sendColors();
                        break;
                    case 'changeLanguage':
                        this.language = message.language;
                        await this.sendColors();
                        break;
                    case 'apply':
                        await this.applyColors(message.colors, message.mode);
                        break;
                    case 'reset':
                        await resetColors(this.language);
                        await this.sendColors();
                        await vscode.window.showInformationMessage(
                            `XML Doc Color: inherited theme colors restored (${this.scopeLabel()}).`,
                        );
                        break;
                    case 'copyJson':
                        await vscode.env.clipboard.writeText(
                            getThemeCustomizationSnippet(message.colors, message.language),
                        );
                        await vscode.window.showInformationMessage('XML Doc Color: TextMate customization JSON copied.');
                        break;
                }
            } catch (error) {
                await vscode.window.showErrorMessage(`XML Doc Color: ${formatError(error)}`);
                await this.sendColors();
            }
        });
    }

    /** Sends one complete state snapshot so the webview never merges partial settings. */
    private async sendColors(): Promise<void> {
        const resolved = readResolvedColors(this.language);
        const activeEditorLanguage = vscode.window.activeTextEditor?.document.languageId;
        const supportedEditorActive = !!activeEditorLanguage && SUPPORTED_LANGUAGES.includes(activeEditorLanguage);
        const message: ExtensionMessage = {
            type: 'init',
            language: this.language,
            colors: resolved.colors,
            overrides: resolved.overrides,
            sources: resolved.sources,
            supportedEditorActive,
            activeEditorLanguage: supportedEditorActive ? activeEditorLanguage : undefined,
            workspaceTargetAvailable: hasWorkspace(),
            configurationTarget: getConfigurationTarget() === vscode.ConfigurationTarget.Workspace
                ? 'workspace'
                : 'global',
            availablePresets: {
                dark: DARK_PRESET_COLORS,
                light: LIGHT_PRESET_COLORS,
                inherited: resolved.colors,
            },
            tokens: TOKEN_DEFINITIONS,
            previewData: getSidebarPreviewData(),
        };
        await this.view?.webview.postMessage(message);
    }

    /** Applies explicit palettes or removes rules for inherited-theme mode. */
    private async applyColors(colors: DocColors, mode: PresetMode): Promise<void> {
        if (mode === 'inherited') {
            await resetColors(this.language);
            await vscode.window.showInformationMessage(
                `XML Doc Color: inherited theme colors restored (${this.scopeLabel()}).`,
            );
        } else {
            await writeColors(getPresetColors(mode) ?? colors, this.language);
            await vscode.window.showInformationMessage(
                `XML Doc Color: TextMate colors applied (${this.scopeLabel()}).`,
            );
        }
        await this.sendColors();
    }

    private scopeLabel(): string {
        return this.language === '*' ? 'all languages' : this.language;
    }

    /** Loads local assets through `workspace.fs`, keeping this path WebWorker-safe. */
    private async buildHtml(webview: vscode.Webview): Promise<string> {
        const htmlUri = vscode.Uri.joinPath(this.extensionUri, 'media', 'settingsPanel.html');
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'settingsPanel.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'));
        const nonce = getNonce();
        const bytes = await vscode.workspace.fs.readFile(htmlUri);
        const template = new TextDecoder().decode(bytes);

        return template
            .replace(/{{nonce}}/g, nonce)
            .replace(/{{cspSource}}/g, webview.cspSource)
            .replace(/{{styleUri}}/g, styleUri.toString())
            .replace(/{{scriptUri}}/g, scriptUri.toString());
    }
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
