const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './test',
    timeout: 30_000,
    fullyParallel: false,
    use: {
        headless: true,
    },
});
