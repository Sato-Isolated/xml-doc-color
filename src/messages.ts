import {
    DocColors,
    SUPPORTED_LANGUAGES,
    TOKEN_KEYS,
    TokenDefinition,
    TokenKey,
} from './model';
import type { ColorSource } from './colorConfig';
import type { SidebarPreviewData } from './languages';

export type PresetMode = 'custom' | 'dark' | 'light' | 'inherited';

/** Messages accepted from the untrusted webview boundary. */
export type WebviewMessage =
    | { type: 'ready' }
    | { type: 'changeLanguage'; language: string }
    | { type: 'apply'; colors: DocColors; mode: PresetMode }
    | { type: 'reset' }
    | { type: 'copyJson'; colors: DocColors; language: string };

/** Complete immutable snapshot sent by the extension whenever settings change. */
export interface InitWebviewMessage {
    type: 'init';
    language: string;
    colors: DocColors;
    overrides: Record<TokenKey, boolean>;
    sources: Record<TokenKey, ColorSource>;
    supportedEditorActive: boolean;
    activeEditorLanguage?: string;
    workspaceTargetAvailable: boolean;
    configurationTarget: 'global' | 'workspace';
    availablePresets: {
        dark: DocColors;
        light: DocColors;
        inherited: DocColors;
    };
    tokens: readonly TokenDefinition[];
    previewData: SidebarPreviewData;
}

export type ExtensionMessage = InitWebviewMessage;

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSupportedLanguageScope(value: unknown): value is string {
    return value === '*' || (typeof value === 'string' && SUPPORTED_LANGUAGES.includes(value));
}

function isPresetMode(value: unknown): value is PresetMode {
    return value === 'custom'
        || value === 'dark'
        || value === 'light'
        || value === 'inherited';
}

function normalizeColors(value: unknown): DocColors | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const colors = {} as DocColors;
    for (const key of TOKEN_KEYS) {
        const color = value[key];
        if (typeof color !== 'string' || !HEX_COLOR_RE.test(color)) {
            return undefined;
        }
        colors[key] = color.toUpperCase();
    }
    return colors;
}

/**
 * Validates and normalizes a value received through `onDidReceiveMessage`.
 * Returning `undefined` ensures malformed or partial payloads never reach the
 * configuration-writing code.
 */
export function normalizeWebviewMessage(value: unknown): WebviewMessage | undefined {
    if (!isRecord(value) || typeof value.type !== 'string') {
        return undefined;
    }

    switch (value.type) {
        case 'ready':
            return { type: 'ready' };
        case 'changeLanguage':
            return isSupportedLanguageScope(value.language)
                ? { type: 'changeLanguage', language: value.language }
                : undefined;
        case 'apply': {
            const colors = normalizeColors(value.colors);
            return colors && isPresetMode(value.mode)
                ? { type: 'apply', colors, mode: value.mode }
                : undefined;
        }
        case 'reset':
            return { type: 'reset' };
        case 'copyJson': {
            const colors = normalizeColors(value.colors);
            return colors && isSupportedLanguageScope(value.language)
                ? { type: 'copyJson', colors, language: value.language }
                : undefined;
        }
        default:
            return undefined;
    }
}
