import * as vscode from 'vscode';
import {
    DARK_PRESET_COLORS,
    DocColors,
    getTokenKeysForLanguage,
    getTokenDefinition,
    getTokenScope,
    LANGUAGE_DEFINITIONS,
    LIGHT_PRESET_COLORS,
    SUPPORTED_LANGUAGES,
    TOKEN_KEYS,
    TokenKey,
    tokenSupportsLanguage,
} from './model';

/*
 * Owns the settings contract for XML Doc Color.
 *
 * Reads use VS Code's effective configuration, while writes always start from
 * `inspect()` at the selected target. This prevents a workspace edit from
 * accidentally copying merged global values, or the inverse.
 */

export {
    DARK_PRESET_COLORS,
    DocColors,
    LIGHT_PRESET_COLORS,
    TOKEN_KEYS as DOC_COLOR_KEYS,
};

export type ConfigurationTargetSetting = 'global' | 'workspace';

/** Describes which precedence layer supplied a color shown in the sidebar. */
export type ColorSource = 'language' | 'all' | 'theme';

/** Effective colors plus enough provenance for the webview's source badges. */
export interface ResolvedColors {
    colors: DocColors;
    overrides: Record<TokenKey, boolean>;
    sources: Record<TokenKey, ColorSource>;
}

export interface TextMateRuleSettings {
    foreground?: string;
    fontStyle?: string;
}

export interface TextMateRule {
    name?: string;
    scope?: string | string[];
    settings?: TextMateRuleSettings;
}

export interface TokenColorCustomizations {
    textMateRules?: TextMateRule[];
    [key: string]: unknown;
}

type SemanticRuleValue = string | {
    foreground?: unknown;
    bold?: unknown;
    italic?: unknown;
    underline?: unknown;
    strikethrough?: unknown;
    fontStyle?: unknown;
};

export const TEXT_MATE_RULE_PREFIX = 'XML Doc Color / ';
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneRecord<T extends Record<string, unknown>>(value: T | undefined): T {
    return { ...(value ?? {}) } as T;
}

function fallbackColors(): DocColors {
    return vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light
        || vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrastLight
        ? LIGHT_PRESET_COLORS
        : DARK_PRESET_COLORS;
}

function ruleName(key: TokenKey, language: string): string {
    return `${TEXT_MATE_RULE_PREFIX}${key} / ${language === '*' ? 'all' : language}`;
}

function parseRuleName(name: unknown): { key: TokenKey; language: string } | undefined {
    if (typeof name !== 'string' || !name.startsWith(TEXT_MATE_RULE_PREFIX)) {
        return undefined;
    }

    const match = name.slice(TEXT_MATE_RULE_PREFIX.length).match(/^([^/]+)\s+\/\s+(.+)$/);
    if (!match) {
        return undefined;
    }

    const key = match[1].trim() as TokenKey;
    const language = match[2].trim() === 'all' ? '*' : match[2].trim();
    if (!TOKEN_KEYS.includes(key) || (language !== '*' && !SUPPORTED_LANGUAGES.includes(language))) {
        return undefined;
    }

    return { key, language };
}

function scopesFor(key: TokenKey, language: string): string[] {
    if (language === '*') {
        return LANGUAGE_DEFINITIONS
            .filter(({ id }) => tokenSupportsLanguage(key, id))
            .map(({ id }) => getTokenScope(key, id));
    }
    return tokenSupportsLanguage(key, language) ? [getTokenScope(key, language)] : [];
}

function createRule(key: TokenKey, foreground: string, language: string, fontStyle?: string): TextMateRule {
    const defaultFontStyle = getTokenDefinition(key).boldByDefault ? 'bold' : undefined;
    const scopes = scopesFor(key, language);
    if (scopes.length === 0) {
        throw new Error(`XML Doc Color token ${key} is not supported in ${language}.`);
    }
    return {
        name: ruleName(key, language),
        scope: language === '*' ? scopes : scopes[0],
        settings: {
            foreground,
            ...(fontStyle || defaultFontStyle ? { fontStyle: fontStyle || defaultFontStyle } : {}),
        },
    };
}

function normalizeColors(colors: DocColors): DocColors {
    const result = {} as DocColors;
    for (const key of TOKEN_KEYS) {
        const color = colors[key];
        if (!HEX_COLOR_RE.test(color)) {
            throw new Error(`Invalid XML doc color for ${key}: ${color}`);
        }
        result[key] = color.toUpperCase();
    }
    return result;
}

function targetValue(
    config: vscode.WorkspaceConfiguration,
    section: string,
    target: vscode.ConfigurationTarget,
): TokenColorCustomizations | undefined {
    const inspected = config.inspect<TokenColorCustomizations>(section);
    return target === vscode.ConfigurationTarget.Workspace
        ? inspected?.workspaceValue
        : inspected?.globalValue;
}

function ensureWorkspaceTargetAvailable(target: vscode.ConfigurationTarget): void {
    if (
        target === vscode.ConfigurationTarget.Workspace
        && !vscode.workspace.workspaceFile
        && !vscode.workspace.workspaceFolders?.length
    ) {
        throw new Error('Open a workspace before writing workspace color settings.');
    }
}

function orderRules(rules: readonly TextMateRule[]): TextMateRule[] {
    const external: TextMateRule[] = [];
    const owned = new Map<string, TextMateRule>();

    for (const rule of rules) {
        const parsed = parseRuleName(rule.name);
        if (!parsed) {
            external.push(rule);
            continue;
        }
        owned.set(ruleName(parsed.key, parsed.language), rule);
    }

    // TextMate applies later matching rules last. Global XML Doc Color rules
    // must therefore precede every language-specific override.
    const orderedOwned: TextMateRule[] = [];
    for (const language of ['*', ...SUPPORTED_LANGUAGES]) {
        for (const key of TOKEN_KEYS) {
            const rule = owned.get(ruleName(key, language));
            if (rule) {
                orderedOwned.push(rule);
            }
        }
    }

    return [...external, ...orderedOwned];
}

function replaceOwnedRules(
    existingRules: readonly TextMateRule[],
    language: string,
    replacements: readonly TextMateRule[],
): TextMateRule[] {
    const retained = existingRules.filter((rule) => parseRuleName(rule.name)?.language !== language);
    return orderRules([...retained, ...replacements]);
}

/**
 * Makes an All Languages application authoritative by removing every
 * language-specific XML Doc Color rule that would otherwise win by TextMate
 * precedence. Unrecognized and third-party rules are deliberately retained.
 */
function replaceAllLanguageRules(
    existingRules: readonly TextMateRule[],
    replacements: readonly TextMateRule[],
): TextMateRule[] {
    const retained = existingRules.filter((rule) => !parseRuleName(rule.name));
    return orderRules([...retained, ...replacements]);
}

function findOwnedRule(rules: readonly TextMateRule[], key: TokenKey, language: string): TextMateRule | undefined {
    const expected = ruleName(key, language);
    return [...rules].reverse().find((rule) => rule.name === expected);
}

function foregroundFromRule(rule: TextMateRule | undefined): string | undefined {
    const foreground = rule?.settings?.foreground;
    return typeof foreground === 'string' && HEX_COLOR_RE.test(foreground)
        ? foreground.toUpperCase()
        : undefined;
}

export function readColors(language = '*'): DocColors {
    return readResolvedColors(language).colors;
}

/**
 * Resolves sidebar colors in language -> all languages -> theme order.
 * Theme colors are preview fallbacks only; no TextMate rule is written until
 * the user explicitly applies a preset or custom palette.
 */
export function readResolvedColors(language = '*'): ResolvedColors {
    const customization = vscode.workspace
        .getConfiguration('editor')
        .get<TokenColorCustomizations>('tokenColorCustomizations') ?? {};
    const rules = Array.isArray(customization.textMateRules) ? customization.textMateRules : [];
    const fallback = fallbackColors();
    const colors = {} as DocColors;
    const overrides = {} as Record<TokenKey, boolean>;
    const sources = {} as Record<TokenKey, ColorSource>;

    for (const key of TOKEN_KEYS) {
        if (!tokenSupportsLanguage(key, language)) {
            colors[key] = fallback[key];
            overrides[key] = false;
            sources[key] = 'theme';
            continue;
        }
        const languageRule = language === '*' ? undefined : findOwnedRule(rules, key, language);
        const allRule = findOwnedRule(rules, key, '*');
        const languageColor = foregroundFromRule(languageRule);
        const allColor = foregroundFromRule(allRule);

        if (languageColor) {
            colors[key] = languageColor;
            overrides[key] = true;
            sources[key] = 'language';
        } else if (allColor) {
            colors[key] = allColor;
            overrides[key] = true;
            sources[key] = 'all';
        } else {
            colors[key] = fallback[key];
            overrides[key] = false;
            sources[key] = 'theme';
        }
    }

    return { colors, overrides, sources };
}

export function getConfigurationTarget(): vscode.ConfigurationTarget {
    const target = vscode.workspace.getConfiguration('xmlDocColor').get<ConfigurationTargetSetting>(
        'configurationTarget',
        'global',
    );
    return target === 'workspace'
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
}

/**
 * Replaces the named XML Doc Color rules in the selected configuration layer.
 * Applying `*` is authoritative and removes language overrides so the palette
 * is visibly applied everywhere. Third-party rules remain untouched.
 */
export async function writeColors(colors: DocColors, language = '*'): Promise<void> {
    if (language !== '*' && !SUPPORTED_LANGUAGES.includes(language)) {
        throw new Error(`Unsupported XML Doc Color language: ${language}`);
    }

    const normalized = normalizeColors(colors);
    const target = getConfigurationTarget();
    ensureWorkspaceTargetAvailable(target);
    const config = vscode.workspace.getConfiguration('editor');
    const existing = cloneRecord(targetValue(config, 'tokenColorCustomizations', target));
    const existingRules = Array.isArray(existing.textMateRules) ? existing.textMateRules : [];
    const replacements = getTokenKeysForLanguage(language)
        .map((key) => createRule(key, normalized[key], language));
    const merged: TokenColorCustomizations = {
        ...existing,
        textMateRules: language === '*'
            ? replaceAllLanguageRules(existingRules, replacements)
            : replaceOwnedRules(existingRules, language, replacements),
    };

    await config.update('tokenColorCustomizations', merged, target);
}

/**
 * Removes only one XML Doc Color override layer. Resetting `*` keeps language
 * overrides; resetting a language falls back to `*`, then to the active theme.
 */
export async function resetColors(language = '*'): Promise<void> {
    if (language !== '*' && !SUPPORTED_LANGUAGES.includes(language)) {
        throw new Error(`Unsupported XML Doc Color language: ${language}`);
    }

    const target = getConfigurationTarget();
    ensureWorkspaceTargetAvailable(target);
    const config = vscode.workspace.getConfiguration('editor');
    const existing = cloneRecord(targetValue(config, 'tokenColorCustomizations', target));
    const existingRules = Array.isArray(existing.textMateRules) ? existing.textMateRules : [];
    const nextRules = replaceOwnedRules(existingRules, language, []);
    const merged: TokenColorCustomizations = { ...existing, textMateRules: nextRules };

    await config.update('tokenColorCustomizations', merged, target);
}

/** Produces a paste-ready `editor.tokenColorCustomizations` JSON fragment. */
export function getThemeCustomizationSnippet(colors: DocColors, language = '*'): string {
    const normalized = normalizeColors(colors);
    return JSON.stringify({
        'editor.tokenColorCustomizations': {
            textMateRules: getTokenKeysForLanguage(language)
                .map((key) => createRule(key, normalized[key], language)),
        },
    }, null, 2);
}

function legacyRuleKey(key: string): { token: TokenKey; language: string } | undefined {
    const match = key.match(/^([^:]+)(?::(.+))?$/);
    if (!match) {
        return undefined;
    }
    const token = match[1] as TokenKey;
    const language = match[2] ?? '*';
    if (
        !TOKEN_KEYS.includes(token)
        || (language !== '*' && !SUPPORTED_LANGUAGES.includes(language))
        || !tokenSupportsLanguage(token, language)
    ) {
        return undefined;
    }
    return { token, language };
}

function convertLegacyStyle(value: unknown): { foreground: string; fontStyle?: string } | undefined {
    if (typeof value === 'string') {
        return HEX_COLOR_RE.test(value) ? { foreground: value.toUpperCase() } : undefined;
    }
    if (!isRecord(value) || typeof value.foreground !== 'string' || !HEX_COLOR_RE.test(value.foreground)) {
        return undefined;
    }

    const semantic = value as SemanticRuleValue & Record<string, unknown>;
    const styles = typeof semantic.fontStyle === 'string'
        ? semantic.fontStyle.split(/\s+/).filter(Boolean)
        : [];
    for (const style of ['italic', 'bold', 'underline', 'strikethrough'] as const) {
        if (semantic[style] === true && !styles.includes(style)) {
            styles.push(style);
        }
    }

    return {
        foreground: value.foreground.toUpperCase(),
        ...(styles.length > 0 ? { fontStyle: styles.join(' ') } : {}),
    };
}

export interface MigrationResult {
    semantic: Record<string, unknown> | undefined;
    textMate: TokenColorCustomizations;
    convertedRuleNames: string[];
}

export interface MigrationPersistence {
    writeTextMate(value: TokenColorCustomizations): Promise<void>;
    readTextMate(): TokenColorCustomizations | undefined;
    writeSemantic(value: Record<string, unknown> | undefined): Promise<void>;
}

function migrateRuleContainer(
    semanticContainer: Record<string, unknown>,
    textMateContainer: Record<string, unknown>,
): string[] {
    const rules = isRecord(semanticContainer.rules) ? cloneRecord(semanticContainer.rules) : undefined;
    if (!rules) {
        return [];
    }

    const existingTextMateRules = Array.isArray(textMateContainer.textMateRules)
        ? [...textMateContainer.textMateRules as TextMateRule[]]
        : [];
    const converted: TextMateRule[] = [];
    const convertedNames: string[] = [];

    for (const [legacyKey, value] of Object.entries(rules)) {
        const parsed = legacyRuleKey(legacyKey);
        const style = convertLegacyStyle(value);
        if (!parsed || !style) {
            continue;
        }

        const name = ruleName(parsed.token, parsed.language);
        if (!existingTextMateRules.some((rule) => rule.name === name)) {
            converted.push(createRule(parsed.token, style.foreground, parsed.language, style.fontStyle));
        }
        convertedNames.push(name);
        delete rules[legacyKey];
    }

    if (convertedNames.length === 0) {
        return [];
    }

    if (Object.keys(rules).length > 0) {
        semanticContainer.rules = rules;
    } else {
        delete semanticContainer.rules;
    }
    textMateContainer.textMateRules = orderRules([...existingTextMateRules, ...converted]);
    return convertedNames;
}

/**
 * Purely converts legacy semantic-token containers, including theme blocks.
 * Inputs are cloned, which keeps the source data intact until persistence has
 * been verified by {@link persistMigration}.
 */
export function migrateCustomizationValues(
    semanticValue: Record<string, unknown> | undefined,
    textMateValue: TokenColorCustomizations | undefined,
): MigrationResult {
    const semantic = cloneRecord(semanticValue);
    const textMate = cloneRecord(textMateValue);
    const convertedRuleNames = migrateRuleContainer(semantic, textMate);

    for (const [key, value] of Object.entries(semantic)) {
        if (!/^\[.+\]$/.test(key) || !isRecord(value)) {
            continue;
        }
        const semanticTheme = cloneRecord(value);
        const textMateTheme = isRecord(textMate[key]) ? cloneRecord(textMate[key] as Record<string, unknown>) : {};
        const themeNames = migrateRuleContainer(semanticTheme, textMateTheme);
        if (themeNames.length === 0) {
            continue;
        }
        convertedRuleNames.push(...themeNames);
        if (Object.keys(semanticTheme).length > 0) {
            semantic[key] = semanticTheme;
        } else {
            delete semantic[key];
        }
        textMate[key] = textMateTheme;
    }

    return {
        semantic: Object.keys(semantic).length > 0 ? semantic : undefined,
        textMate,
        convertedRuleNames,
    };
}

function valueForTarget<T>(
    inspected: ReturnType<vscode.WorkspaceConfiguration['inspect']> & {
        globalValue?: T;
        workspaceValue?: T;
    } | undefined,
    target: vscode.ConfigurationTarget,
): T | undefined {
    return target === vscode.ConfigurationTarget.Workspace
        ? inspected?.workspaceValue
        : inspected?.globalValue;
}

function migratedRulesPresent(value: TokenColorCustomizations | undefined, names: readonly string[]): boolean {
    const present = new Set<string>();
    const collect = (container: unknown): void => {
        if (!isRecord(container)) {
            return;
        }
        if (Array.isArray(container.textMateRules)) {
            for (const rule of container.textMateRules as TextMateRule[]) {
                if (typeof rule.name === 'string') {
                    present.add(rule.name);
                }
            }
        }
        for (const [key, nested] of Object.entries(container)) {
            if (/^\[.+\]$/.test(key)) {
                collect(nested);
            }
        }
    };
    collect(value);
    return names.every((name) => present.has(name));
}

/**
 * Commits one migration transaction in a fail-safe order:
 * write TextMate rules, read and verify them, then remove converted legacy keys.
 * Any write or verification failure leaves semantic-token data untouched.
 */
export async function persistMigration(
    migration: MigrationResult,
    persistence: MigrationPersistence,
    label: string,
): Promise<void> {
    await persistence.writeTextMate(migration.textMate);
    if (!migratedRulesPresent(persistence.readTextMate(), migration.convertedRuleNames)) {
        throw new Error(`Unable to verify migrated ${label} TextMate rules.`);
    }
    await persistence.writeSemantic(migration.semantic);
}

/**
 * Migrates owned rules independently at global and workspace scope.
 * The operation is idempotent: existing named TextMate rules remain the source
 * of truth and already-converted semantic rules are ignored on later starts.
 */
export async function migrateLegacyColorRules(): Promise<number> {
    const config = vscode.workspace.getConfiguration('editor');
    let total = 0;

    for (const target of [vscode.ConfigurationTarget.Global, vscode.ConfigurationTarget.Workspace]) {
        const semanticInspected = config.inspect<Record<string, unknown>>('semanticTokenColorCustomizations');
        const textMateInspected = config.inspect<TokenColorCustomizations>('tokenColorCustomizations');
        const semanticValue = valueForTarget<Record<string, unknown>>(semanticInspected, target);
        if (!semanticValue) {
            continue;
        }

        const textMateValue = valueForTarget<TokenColorCustomizations>(textMateInspected, target);
        const migration = migrateCustomizationValues(semanticValue, textMateValue);
        if (migration.convertedRuleNames.length === 0) {
            continue;
        }

        await persistMigration(migration, {
            writeTextMate: async (value) => config.update('tokenColorCustomizations', value, target),
            readTextMate: () => valueForTarget<TokenColorCustomizations>(
                config.inspect<TokenColorCustomizations>('tokenColorCustomizations'),
                target,
            ),
            writeSemantic: async (value) => config.update('semanticTokenColorCustomizations', value, target),
        }, target === vscode.ConfigurationTarget.Global ? 'global' : 'workspace');
        total += migration.convertedRuleNames.length;
    }

    return total;
}
