import type { InitWebviewMessage, PresetMode, WebviewMessage } from './messages';
import type { DocColors, TokenDefinition, TokenKey } from './model';

/*
 * Browser-only sidebar controller. It deliberately has no VS Code imports:
 * communication is limited to the typed postMessage contract and persisted
 * draft state exposed by acquireVsCodeApi().
 */

interface VsCodeApi<State> {
    getState(): State | undefined;
    setState(state: State): void;
    postMessage(message: WebviewMessage): void;
}

interface DraftState {
    /** Partial keeps persisted twelve-color drafts compatible with 0.1.0. */
    colors: Partial<DocColors>;
    mode: PresetMode;
    dirty: boolean;
}

interface PersistedState {
    language: string;
    drafts: Record<string, DraftState>;
}

declare function acquireVsCodeApi<State = unknown>(): VsCodeApi<State>;

const vscode = acquireVsCodeApi<PersistedState>();
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const persisted = vscode.getState() ?? { language: '*', drafts: {} };

let state: InitWebviewMessage | undefined;
let language = persisted.language;
let colors = {} as DocColors;
let appliedColors = {} as DocColors;
let presetMode: PresetMode = 'custom';
let invalidKeys = new Set<TokenKey>();
let dirty = false;
let pendingWrite = false;
let externalChange = false;

const languageSelect = requiredElement<HTMLSelectElement>('language-select');
const presetSelect = requiredElement<HTMLSelectElement>('preset-select');
const scopeBadge = requiredElement<HTMLElement>('scope-badge');
const previewBadge = requiredElement<HTMLElement>('preview-badge');
const preview = requiredElement<HTMLElement>('preview-code');
const tokenList = requiredElement<HTMLElement>('token-list');
const status = requiredElement<HTMLElement>('action-status');
const applyButton = requiredElement<HTMLButtonElement>('apply-button');
const copyButton = requiredElement<HTMLButtonElement>('copy-button');
const resetButton = requiredElement<HTMLButtonElement>('reset-button');
const previewStyle = requiredElement<HTMLStyleElement>('preview-colors');
const onboarding = requiredElement<HTMLElement>('onboarding');

function requiredElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing webview element: ${id}`);
    }
    return element as T;
}

function cloneColors(value: DocColors): DocColors {
    return { ...value };
}

function colorsEqual(left: DocColors, right: DocColors): boolean {
    return state?.tokens.every(({ key }) => left[key] === right[key]) ?? false;
}

function modeFromSources(message: InitWebviewMessage): PresetMode {
    return message.tokens.every(({ key }) => message.sources[key] === 'theme')
        ? 'inherited'
        : 'custom';
}

function saveDraft(): void {
    if (!state) {
        return;
    }
    persisted.language = language;
    persisted.drafts[language] = {
        colors: cloneColors(colors),
        mode: presetMode,
        dirty,
    };
    vscode.setState(persisted);
}

function clearDraft(scope: string): void {
    delete persisted.drafts[scope];
    vscode.setState(persisted);
}

function applyPreviewColors(): void {
    if (!state) {
        return;
    }
    // CSP forbids inline style attributes. A nonce-bearing stylesheet in the
    // static HTML is the only dynamic styling surface used by the preview.
    previewStyle.textContent = state.tokens
        .map(({ key }) => `.token-${key} { color: ${colors[key]}; }`)
        .join('\n');
}

function renderLanguageOptions(): void {
    if (!state) {
        return;
    }
    languageSelect.replaceChildren(...state.previewData.options.map((option) => {
        const element = document.createElement('option');
        element.value = option.id;
        element.textContent = option.label;
        element.selected = option.id === language;
        return element;
    }));
}

function renderPreview(): void {
    if (!state) {
        return;
    }
    const selected = state.previewData.previews[language] ?? state.previewData.previews['*'];
    const fragment = document.createDocumentFragment();
    selected.lines.forEach((previewLine, index) => {
        for (const previewSegment of previewLine.segments) {
            const span = document.createElement('span');
            span.textContent = previewSegment.text;
            if (previewSegment.token) {
                span.className = `token-${previewSegment.token}`;
            }
            fragment.appendChild(span);
        }
        if (index < selected.lines.length - 1) {
            fragment.appendChild(document.createTextNode('\n'));
        }
    });
    preview.replaceChildren(fragment);
    preview.setAttribute('aria-label', `${selected.label} documentation preview`);
    previewBadge.textContent = state.activeEditorLanguage ?? 'Static';
}

function sourceLabel(key: TokenKey): string {
    if (!state) {
        return 'Theme';
    }
    switch (state.sources[key]) {
        case 'language':
            return 'Language';
        case 'all':
            return 'All';
        case 'theme':
            return 'Theme';
    }
}

function tokenAvailable(definition: TokenDefinition): boolean {
    return language === '*'
        || !definition.languageIds
        || definition.languageIds.includes(language);
}

function updateTokenControl(key: TokenKey, value: string, valid: boolean): void {
    colors[key] = value;
    if (valid) {
        invalidKeys.delete(key);
    } else {
        invalidKeys.add(key);
    }
    dirty = !colorsEqual(colors, appliedColors) || presetMode === 'inherited';
    presetMode = 'custom';
    presetSelect.value = 'custom';
    applyPreviewColors();
    saveDraft();
    renderActionState();
}

function createTokenRow(definition: TokenDefinition, used: ReadonlySet<TokenKey>): HTMLElement {
    const available = tokenAvailable(definition);
    const row = document.createElement('div');
    row.className = [
        'color-row',
        ...(used.has(definition.key) ? [] : ['unused']),
        ...(available ? [] : ['unavailable']),
    ].join(' ');
    row.setAttribute('aria-disabled', String(!available));
    const label = document.createElement('label');
    label.className = 'color-label';
    label.htmlFor = `hex-${definition.key}`;
    label.textContent = definition.label;

    const badge = document.createElement('span');
    badge.className = 'source-badge';
    badge.textContent = available ? sourceLabel(definition.key) : 'N/A';

    const nativeInput = document.createElement('input');
    nativeInput.type = 'color';
    nativeInput.className = 'color-native';
    nativeInput.value = colors[definition.key];
    nativeInput.disabled = !available;
    nativeInput.setAttribute('aria-label', `${definition.label} color picker`);

    const hexInput = document.createElement('input');
    hexInput.id = `hex-${definition.key}`;
    hexInput.className = 'hex-input';
    hexInput.type = 'text';
    hexInput.maxLength = 7;
    hexInput.spellcheck = false;
    hexInput.value = colors[definition.key];
    hexInput.disabled = !available;
    hexInput.setAttribute('aria-label', `${definition.label} hexadecimal color`);

    nativeInput.addEventListener('input', () => {
        const value = nativeInput.value.toUpperCase();
        hexInput.value = value;
        hexInput.setAttribute('aria-invalid', 'false');
        updateTokenControl(definition.key, value, true);
    });
    hexInput.addEventListener('input', () => {
        const value = hexInput.value.trim().toUpperCase();
        const valid = HEX_RE.test(value);
        hexInput.setAttribute('aria-invalid', String(!valid));
        hexInput.classList.toggle('invalid', !valid);
        if (valid) {
            nativeInput.value = value;
        }
        updateTokenControl(definition.key, value, valid);
    });
    hexInput.addEventListener('blur', () => {
        if (!HEX_RE.test(hexInput.value.trim())) {
            const value = nativeInput.value.toUpperCase();
            hexInput.value = value;
            hexInput.classList.remove('invalid');
            hexInput.setAttribute('aria-invalid', 'false');
            updateTokenControl(definition.key, value, true);
        }
    });

    row.append(label, badge, nativeInput, hexInput);
    return row;
}

function renderTokenRows(): void {
    if (!state) {
        return;
    }
    const selected = state.previewData.previews[language] ?? state.previewData.previews['*'];
    const used = new Set(selected.usedTokenKeys);
    tokenList.replaceChildren(...state.tokens.map((definition) => createTokenRow(definition, used)));
}

function currentScopeLabel(): string {
    if (!state) {
        return 'All';
    }
    const option = state.previewData.options.find(({ id }) => id === language);
    return option?.label.replace(/\s*\(.*\)$/, '') ?? language;
}

function renderActionState(): void {
    if (!state) {
        status.textContent = 'Loading current colors…';
        applyButton.disabled = true;
        copyButton.disabled = true;
        resetButton.disabled = true;
        return;
    }

    const workspaceBlocked = state.configurationTarget === 'workspace' && !state.workspaceTargetAvailable;
    applyButton.disabled = invalidKeys.size > 0 || !dirty || workspaceBlocked;
    copyButton.disabled = invalidKeys.size > 0;
    resetButton.disabled = workspaceBlocked;
    status.className = 'status-note';

    if (workspaceBlocked) {
        status.textContent = 'Open a workspace or switch the configuration target to Global.';
        status.classList.add('is-invalid');
    } else if (invalidKeys.size > 0) {
        status.textContent = 'Enter valid 6-digit hexadecimal colors.';
        status.classList.add('is-invalid');
    } else if (externalChange && dirty) {
        status.textContent = 'Settings changed externally; your local draft was kept.';
        status.classList.add('is-dirty');
    } else if (dirty) {
        status.textContent = presetMode === 'inherited'
            ? 'Apply will restore inherited theme colors.'
            : 'Unapplied changes for this scope.';
        status.classList.add('is-dirty');
    } else {
        status.textContent = 'Colors are synchronized with VS Code settings.';
        status.classList.add('is-applied');
    }
}

function renderAll(): void {
    if (!state) {
        renderActionState();
        return;
    }
    renderLanguageOptions();
    scopeBadge.textContent = currentScopeLabel();
    onboarding.hidden = state.supportedEditorActive;
    renderPreview();
    renderTokenRows();
    applyPreviewColors();
    renderActionState();
}

function handleInit(message: InitWebviewMessage): void {
    const sameScope = state?.language === message.language;
    const incoming = cloneColors(message.colors);
    state = message;
    language = message.language;
    appliedColors = cloneColors(incoming);

    const draft = persisted.drafts[language];
    if (pendingWrite) {
        pendingWrite = false;
        dirty = false;
        externalChange = false;
        presetMode = modeFromSources(message);
        colors = cloneColors(incoming);
        clearDraft(language);
    } else if (draft?.dirty) {
        // External settings refreshes update the applied baseline but must not
        // destroy an unsaved per-language draft. Merging from the incoming
        // baseline upgrades persisted twelve-color drafts without a settings write.
        colors = { ...incoming, ...(draft.colors ?? {}) };
        dirty = true;
        presetMode = draft.mode;
        externalChange = sameScope;
        saveDraft();
    } else {
        colors = cloneColors(incoming);
        dirty = false;
        presetMode = modeFromSources(message);
        externalChange = false;
    }

    invalidKeys = new Set(
        message.tokens
            .filter((definition) => tokenAvailable(definition))
            .map(({ key }) => key)
            .filter((key) => !HEX_RE.test(colors[key])),
    );
    presetSelect.value = presetMode;
    renderAll();
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'init') {
        handleInit(message as InitWebviewMessage);
    }
});

languageSelect.addEventListener('change', () => {
    saveDraft();
    language = languageSelect.value;
    persisted.language = language;
    vscode.setState(persisted);
    status.textContent = 'Loading selected scope…';
    vscode.postMessage({ type: 'changeLanguage', language });
});

presetSelect.addEventListener('change', () => {
    if (!state) {
        return;
    }
    presetMode = presetSelect.value as PresetMode;
    if (presetMode !== 'custom') {
        colors = cloneColors(state.availablePresets[presetMode]);
        invalidKeys.clear();
        dirty = true;
        externalChange = false;
        saveDraft();
        renderTokenRows();
        applyPreviewColors();
        renderActionState();
    }
});

applyButton.addEventListener('click', () => {
    if (!state || applyButton.disabled) {
        return;
    }
    pendingWrite = true;
    vscode.postMessage({ type: 'apply', colors: cloneColors(colors), mode: presetMode });
});

copyButton.addEventListener('click', () => {
    if (!state || copyButton.disabled) {
        return;
    }
    vscode.postMessage({ type: 'copyJson', colors: cloneColors(colors), language });
});

resetButton.addEventListener('click', () => {
    if (!state || resetButton.disabled) {
        return;
    }
    pendingWrite = true;
    vscode.postMessage({ type: 'reset' });
});

renderActionState();
vscode.postMessage({ type: 'ready' });
