const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const shared = {
    bundle: true,
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    logLevel: 'warning',
};

const builds = [
    {
        ...shared,
        entryPoints: ['src/extension.ts'],
        outfile: 'dist/node/extension.js',
        platform: 'node',
        format: 'cjs',
        target: 'node16',
        external: ['vscode'],
    },
    {
        ...shared,
        entryPoints: ['src/extension.ts'],
        outfile: 'dist/web/extension.js',
        platform: 'browser',
        format: 'cjs',
        target: 'es2020',
        external: ['vscode'],
        define: { global: 'globalThis' },
    },
    {
        ...shared,
        entryPoints: ['src/webview.ts'],
        outfile: 'dist/webview.js',
        platform: 'browser',
        format: 'iife',
        target: 'es2020',
    },
    {
        ...shared,
        entryPoints: ['src/test/web/smoke.ts'],
        outfile: 'dist/web/test/smoke.js',
        platform: 'browser',
        format: 'cjs',
        target: 'es2020',
        external: ['vscode'],
        define: { global: 'globalThis' },
    },
];

async function main() {
    const contexts = await Promise.all(builds.map((options) => esbuild.context(options)));
    if (watch) {
        await Promise.all(contexts.map((context) => context.watch()));
        return;
    }

    await Promise.all(contexts.map((context) => context.rebuild()));
    await Promise.all(contexts.map((context) => context.dispose()));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
