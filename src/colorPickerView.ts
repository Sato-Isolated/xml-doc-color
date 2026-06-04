import * as vscode from 'vscode';
import { TextDecoder } from 'util';
import {
    DARK_PRESET_COLORS,
    DOC_COLOR_KEYS,
    DocColors,
    getThemeCustomizationSnippet,
    LIGHT_PRESET_COLORS,
    readResolvedColors,
    resetColors,
    writeColors,
} from './colorConfig';
import { getSidebarPreviewData, SUPPORTED_LANGUAGES } from './languages';

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function serializeForWebview(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c');
}

export type PresetMode = 'custom' | 'default' | 'dark' | 'light' | 'inherited';

export type WebviewMessage =
    | { type: 'ready' }
    | { type: 'changeLanguage'; language: string }
    | { type: 'apply'; colors: DocColors; mode: PresetMode }
    | { type: 'reset' }
    | { type: 'copyJson'; colors: DocColors; language: string };

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isSupportedLanguageScope(value: unknown): value is string {
    return value === '*' || (typeof value === 'string' && SUPPORTED_LANGUAGES.includes(value));
}

function isPresetMode(value: unknown): value is PresetMode {
    return value === 'custom'
        || value === 'default'
        || value === 'dark'
        || value === 'light'
        || value === 'inherited';
}

function normalizeColors(value: unknown): DocColors | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const colors: Partial<DocColors> = {};
    for (const key of DOC_COLOR_KEYS) {
        const color = value[key];
        if (typeof color !== 'string' || !HEX_COLOR_RE.test(color)) {
            return undefined;
        }
        colors[key] = color.toUpperCase();
    }

    return colors as DocColors;
}

function getPresetColors(mode: PresetMode): DocColors | undefined {
    switch (mode) {
        case 'custom':
            return undefined;
        case 'default':
        case 'dark':
            return DARK_PRESET_COLORS;
        case 'light':
            return LIGHT_PRESET_COLORS;
        case 'inherited':
            return undefined;
    }
}

export function normalizeWebviewMessage(value: unknown): WebviewMessage | undefined {
    if (!isRecord(value) || typeof value.type !== 'string') {
        return undefined;
    }

    switch (value.type) {
        case 'ready':
            return { type: 'ready' };

        case 'changeLanguage':
            if (!isSupportedLanguageScope(value.language)) {
                return undefined;
            }
            return { type: 'changeLanguage', language: value.language };

        case 'apply': {
            const colors = normalizeColors(value.colors);
            if (!colors || !isPresetMode(value.mode)) {
                return undefined;
            }
            return { type: 'apply', colors, mode: value.mode };
        }

        case 'reset':
            return { type: 'reset' };

        case 'copyJson': {
            const colors = normalizeColors(value.colors);
            if (!colors || !isSupportedLanguageScope(value.language)) {
                return undefined;
            }
            return { type: 'copyJson', colors, language: value.language };
        }

        default:
            return undefined;
    }
}

export class ColorPickerViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'xmlDocColor.colorPicker';

    private _view?: vscode.WebviewView;
    private _language = '*';

    constructor(private readonly _extensionUri: vscode.Uri) {}

    refresh(): void {
        this._sendColors();
    }

    async resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')],
        };

        webviewView.webview.html = await this._buildHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (rawMessage: unknown) => {
            const msg = normalizeWebviewMessage(rawMessage);
            if (!msg) {
                return;
            }

            switch (msg.type) {
                case 'ready':
                    this._sendColors();
                    break;

                case 'changeLanguage':
                    this._language = msg.language;
                    this._sendColors();
                    break;

                case 'apply':
                    await this._applyColors(msg.colors, msg.mode);
                    break;

                case 'reset':
                    await this._resetColors();
                    break;

                case 'copyJson':
                    await vscode.env.clipboard.writeText(
                        getThemeCustomizationSnippet(msg.colors, msg.language),
                    );
                    await vscode.window.showInformationMessage('XML Doc Color: customization JSON copied.');
                    break;
            }
        });
    }

    private _sendColors(): void {
        const resolved = readResolvedColors(this._language);
        const activeEditorLanguage = vscode.window.activeTextEditor?.document.languageId;
        const hasSupportedActiveEditor = !!activeEditorLanguage && SUPPORTED_LANGUAGES.includes(activeEditorLanguage);

        this._view?.webview.postMessage({
            type: 'init',
            language: this._language,
            colors: resolved.colors,
            overrides: resolved.overrides,
            supportedEditorActive: hasSupportedActiveEditor,
            activeEditorLanguage: hasSupportedActiveEditor ? activeEditorLanguage : undefined,
            availablePresets: {
                default: DARK_PRESET_COLORS,
                dark: DARK_PRESET_COLORS,
                light: LIGHT_PRESET_COLORS,
                inherited: resolved.colors,
            },
        });
    }

    private async _applyColors(colors: DocColors, mode: PresetMode): Promise<void> {
        try {
            if (mode === 'inherited') {
                await resetColors(this._language);
                await vscode.window.showInformationMessage(
                    `XML Doc Color: inherited theme colors restored (${this._scopeLabel()}).`,
                );
            } else {
                const presetColors = getPresetColors(mode);
                await writeColors(presetColors ?? colors, this._language);
                await vscode.window.showInformationMessage(
                    `XML Doc Color: colors applied (${this._scopeLabel()}).`,
                );
            }

            this._sendColors();
        } catch (error) {
            vscode.window.showErrorMessage(`XML Doc Color: failed to apply colors. ${formatError(error)}`);
        }
    }

    private async _resetColors(): Promise<void> {
        try {
            await resetColors(this._language);
            this._sendColors();
        } catch (error) {
            vscode.window.showErrorMessage(`XML Doc Color: failed to reset colors. ${formatError(error)}`);
        }
    }

    private _scopeLabel(): string {
        return this._language === '*' ? 'all languages' : this._language;
    }

    private async _buildHtml(webview: vscode.Webview): Promise<string> {
        const htmlUri = vscode.Uri.joinPath(this._extensionUri, 'media', 'settingsPanel.html');
        const nonce = getNonce();
        const bytes = await vscode.workspace.fs.readFile(htmlUri);
        const template = new TextDecoder('utf-8').decode(bytes);
        const previewData = serializeForWebview(getSidebarPreviewData());

        return template
            .replace(/{{nonce}}/g, nonce)
            .replace(/{{cspSource}}/g, webview.cspSource)
            .replace(/{{sidebarPreviewData}}/g, previewData);
    }
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
