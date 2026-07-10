import * as vscode from 'vscode';

export async function run(): Promise<void> {
    const editorConfig = vscode.workspace.getConfiguration('editor');
    await editorConfig.update('semanticTokenColorCustomizations', {
        enabled: true,
        rules: {
            xmlDocTagName: { foreground: '#123456', bold: true },
        },
    }, vscode.ConfigurationTarget.Global);

    const extension = vscode.extensions.getExtension('MindLated.xml-doc-color');
    if (!extension) {
        throw new Error('XML Doc Color web extension is not available.');
    }
    if (extension.packageJSON.browser !== './dist/web/extension.js') {
        throw new Error('XML Doc Color browser entry point is missing.');
    }

    await extension.activate();

    const tokenRules = editorConfig.inspect<Record<string, unknown>>('tokenColorCustomizations')?.globalValue;
    const textMateRules = tokenRules?.textMateRules;
    if (!Array.isArray(textMateRules) || !textMateRules.some((rule) => (
        typeof rule === 'object'
        && rule !== null
        && (rule as { name?: unknown }).name === 'XML Doc Color / xmlDocTagName / all'
    ))) {
        throw new Error('Legacy semantic-token colors were not migrated in the web extension host.');
    }

    const semanticRules = editorConfig
        .inspect<Record<string, unknown>>('semanticTokenColorCustomizations')
        ?.globalValue
        ?.rules;
    if (typeof semanticRules === 'object' && semanticRules !== null && 'xmlDocTagName' in semanticRules) {
        throw new Error('Converted semantic-token colors were not removed after migration.');
    }

    const commands = await vscode.commands.getCommands(true);
    for (const command of [
        'xmlDocColor.openColorPicker',
        'xmlDocColor.copyThemeRules',
        'xmlDocColor.openThemeSnippet',
    ]) {
        if (!commands.includes(command)) {
            throw new Error(`Missing web extension command: ${command}`);
        }
    }

    const openSidebar = vscode.commands.executeCommand('xmlDocColor.openColorPicker').then(() => undefined);
    await Promise.race([
        openSidebar,
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
}
