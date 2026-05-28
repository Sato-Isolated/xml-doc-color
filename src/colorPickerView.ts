import * as fs from 'fs';
import * as vscode from 'vscode';
import { DocColors, readColors, resetColors, writeColors } from './colorConfig';
import { getSidebarPreviewData, SUPPORTED_LANGUAGES } from './languages';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result  = '';
    for (let i = 0; i < 32; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function serializeForWebview(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c');
}

export type WebviewMessage =
    | { type: 'ready' }
    | { type: 'changeLanguage'; language: string }
    | { type: 'apply'; colors: DocColors }
    | { type: 'reset' };

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const COLOR_KEYS: ReadonlyArray<keyof DocColors> = [
    'xmlDocTagName', 'xmlDocTagDelimiter', 'xmlDocAttribute',
    'xmlDocAttributeValue', 'xmlDocAtTag', 'xmlDocLinePrefix', 'xmlDocText',
];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isSupportedLanguageScope(value: unknown): value is string {
    return value === '*' || (typeof value === 'string' && SUPPORTED_LANGUAGES.includes(value));
}

function normalizeColors(value: unknown): DocColors | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const colors: Partial<DocColors> = {};
    for (const key of COLOR_KEYS) {
        const color = value[key];
        if (typeof color !== 'string' || !HEX_COLOR_RE.test(color)) {
            return undefined;
        }
        colors[key] = color.toUpperCase();
    }

    return colors as DocColors;
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
            return colors ? { type: 'apply', colors } : undefined;
        }

        case 'reset':
            return { type: 'reset' };

        default:
            return undefined;
    }
}

// ── Provider ─────────────────────────────────────────────────────────────────

export class ColorPickerViewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'xmlDocColor.colorPicker';

    private _view?: vscode.WebviewView;
    private _language = '*';

    constructor(private readonly _extensionUri: vscode.Uri) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')],
        };

        webviewView.webview.html = this._buildHtml(webviewView.webview);

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
                    if (typeof msg.language === 'string') {
                        this._language = msg.language;
                        this._sendColors();
                    }
                    break;

                case 'apply':
                    await this._applyColors(msg.colors);
                    break;

                case 'reset':
                    await this._resetColors();
                    break;
            }
        });
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private _sendColors(): void {
        this._view?.webview.postMessage({
            type: 'init',
            language: this._language,
            colors: readColors(this._language),
        });
    }

    private async _applyColors(colors: DocColors): Promise<void> {
        try {
            await writeColors(colors, this._language);
            this._sendColors();
            const scope = this._language === '*' ? 'all languages' : this._language;
            vscode.window.showInformationMessage(`XML Doc Color: colors applied (${scope}).`);
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

    private _buildHtml(webview: vscode.Webview): string {
        const htmlUri  = vscode.Uri.joinPath(this._extensionUri, 'media', 'settingsPanel.html');
        const nonce    = getNonce();
        const template = fs.readFileSync(htmlUri.fsPath, 'utf-8');
        const previewData = serializeForWebview(getSidebarPreviewData());

        return template
            .replace(/{{nonce}}/g,      nonce)
            .replace(/{{cspSource}}/g,  webview.cspSource)
            .replace(/{{sidebarPreviewData}}/g, previewData);
    }
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
