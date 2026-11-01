import {defineConfig} from "vitest/config";

export default defineConfig({
	test: {
		// Default to node environment for fast src/lib/** unit tests.
		// For component tests (e.g. src/components/**), add the docblock
		// `// @vitest-environment jsdom` at the top of the test file so jsdom
		// and DOM globals are initialized.
		environment: "node",
		setupFiles: ["src/test/setup.ts"],
		include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
	},
});
