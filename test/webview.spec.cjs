const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { DARK_PRESET_COLORS, LIGHT_PRESET_COLORS, TOKEN_DEFINITIONS } = require('../out/model.js');
const { getSidebarPreviewData } = require('../out/languages.js');

function initMessage(language = '*') {
    const overrides = {};
    const sources = {};
    for (const { key } of TOKEN_DEFINITIONS) {
        overrides[key] = false;
        sources[key] = 'theme';
    }
    return {
        type: 'init',
        language,
        colors: { ...DARK_PRESET_COLORS },
        overrides,
        sources,
        supportedEditorActive: true,
        activeEditorLanguage: 'typescript',
        workspaceTargetAvailable: true,
        configurationTarget: 'global',
        availablePresets: {
            dark: DARK_PRESET_COLORS,
            light: LIGHT_PRESET_COLORS,
            inherited: DARK_PRESET_COLORS,
        },
        tokens: TOKEN_DEFINITIONS,
        previewData: getSidebarPreviewData(),
    };
}

async function loadWebview(page, persistedState) {
    const template = fs.readFileSync(path.join(root, 'media', 'settingsPanel.html'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'media', 'settingsPanel.css'), 'utf8');
    const html = template
        .replace(/<meta http-equiv="Content-Security-Policy"[\s\S]*?>/, '')
        .replace(/<link rel="stylesheet" href="\{\{styleUri\}\}">/, `<style>${css}</style>`)
        .replace(/ nonce="\{\{nonce\}\}"/g, '')
        .replace(/<script src="\{\{scriptUri\}\}"><\/script>/, '');
    await page.setContent(html);
    await page.evaluate((initialState) => {
        window.__xmlDocMessages = [];
        window.__xmlDocState = initialState;
        window.acquireVsCodeApi = () => ({
            getState: () => window.__xmlDocState,
            setState: (value) => { window.__xmlDocState = value; },
            postMessage: (value) => { window.__xmlDocMessages.push(value); },
        });
    }, persistedState);
    await page.addScriptTag({ path: path.join(root, 'dist', 'webview.js') });
    await expect.poll(() => page.evaluate(() => window.__xmlDocMessages.length)).toBeGreaterThan(0);
    await page.evaluate((message) => {
        window.dispatchEvent(new MessageEvent('message', { data: message }));
    }, initMessage());
}

test('renders thirteen controls and sends a complete Apply payload', async ({ page }) => {
    await loadWebview(page);
    await expect(page.locator('.color-row')).toHaveCount(13);
    await expect(page.locator('#action-status')).toHaveAttribute('role', 'status');

    const firstHex = page.locator('.hex-input').first();
    await firstHex.fill('#123456');
    await expect(firstHex).toHaveAttribute('aria-invalid', 'false');
    await page.locator('#apply-button').click();

    const apply = await page.evaluate(() => [...window.__xmlDocMessages].reverse().find((message) => message.type === 'apply'));
    expect(apply.mode).toBe('custom');
    expect(Object.keys(apply.colors)).toHaveLength(13);
    expect(apply.colors.xmlDocTagName).toBe('#123456');
});

test('keeps drafts per language and exposes validation state', async ({ page }) => {
    await loadWebview(page);
    const firstHex = page.locator('.hex-input').first();
    await firstHex.fill('#654321');

    await page.locator('#language-select').selectOption('typescript');
    await page.evaluate((message) => {
        window.dispatchEvent(new MessageEvent('message', { data: message }));
    }, initMessage('typescript'));
    await page.locator('.hex-input').first().fill('invalid');
    await expect(page.locator('.hex-input').first()).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#apply-button')).toBeDisabled();

    await page.locator('#language-select').selectOption('*');
    await page.evaluate((message) => {
        window.dispatchEvent(new MessageEvent('message', { data: message }));
    }, initMessage('*'));
    await expect(page.locator('.hex-input').first()).toHaveValue('#654321');
});

test('supports presets, keyboard navigation, Copy JSON, Reset, and inherited mode', async ({ page }) => {
    await loadWebview(page);
    await expect(page.locator('#preset-select')).toHaveValue('inherited');

    await page.locator('#language-select').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#preset-select')).toBeFocused();

    await page.locator('#preset-select').selectOption('light');
    await expect(page.locator('.hex-input').first()).toHaveValue(LIGHT_PRESET_COLORS.xmlDocTagName);

    await page.locator('#copy-button').click();
    const copied = await page.evaluate(() => [...window.__xmlDocMessages].reverse().find((message) => message.type === 'copyJson'));
    expect(copied.language).toBe('*');
    expect(Object.keys(copied.colors)).toHaveLength(13);

    await page.locator('#reset-button').click();
    const reset = await page.evaluate(() => [...window.__xmlDocMessages].reverse().find((message) => message.type === 'reset'));
    expect(reset).toEqual({ type: 'reset' });

    await page.locator('#preset-select').selectOption('inherited');
    await page.locator('#apply-button').click();
    const inherited = await page.evaluate(() => [...window.__xmlDocMessages].reverse().find((message) => message.type === 'apply'));
    expect(inherited.mode).toBe('inherited');
});

test('upgrades twelve-color drafts and disables block delimiters where unsupported', async ({ page }) => {
    const legacyColors = { ...DARK_PRESET_COLORS };
    delete legacyColors.xmlDocBlockDelimiter;
    await loadWebview(page, {
        language: '*',
        drafts: {
            '*': { colors: legacyColors, mode: 'custom', dirty: true },
        },
    });

    const blockDelimiter = page.locator('#hex-xmlDocBlockDelimiter');
    await expect(blockDelimiter).toHaveValue(DARK_PRESET_COLORS.xmlDocBlockDelimiter);
    const persistedKeys = await page.evaluate(() => (
        Object.keys(window.__xmlDocState.drafts['*'].colors)
    ));
    expect(persistedKeys).toHaveLength(13);

    await page.locator('#language-select').selectOption('csharp');
    await page.evaluate((message) => {
        window.dispatchEvent(new MessageEvent('message', { data: message }));
    }, initMessage('csharp'));
    await expect(blockDelimiter).toBeDisabled();
    await expect(blockDelimiter.locator('xpath=ancestor::div[contains(@class, "color-row")]'))
        .toHaveAttribute('aria-disabled', 'true');
});
