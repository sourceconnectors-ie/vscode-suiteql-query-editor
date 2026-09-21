import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/src/test/**/*.test.js',
	// macOS Unix socket paths are capped at ~103 chars; this repo's own path is long
	// enough that the default .vscode-test/user-data dir overflows that limit.
	launchArgs: ['--user-data-dir=/tmp/suiteql-query-editor-vscode-test'],
});
