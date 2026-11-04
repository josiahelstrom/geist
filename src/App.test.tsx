// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
	fetchPost,
	listPosts,
	type Post,
	type PostDetail,
	type Site,
} from "./lib/api";
import {saveSites, setActiveBase} from "./lib/sites";
import {getUiPrefs, setUiPrefs} from "./lib/uiPrefs";
import App from "./App";

vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn().mockRejectedValue(new Error("no tauri")),
}));

vi.mock("@tauri-apps/plugin-store", () => {
	class MockStore {
		get() {
			return Promise.resolve(null);
		}
		set() {
			return Promise.resolve();
		}
		delete() {
			return Promise.resolve();
		}
		save() {
			return Promise.resolve();
		}
	}
	return {
		Store: MockStore,
		LazyStore: MockStore,
	};
});

vi.mock("./lib/api", async importOriginal => {
	const actual = await importOriginal<typeof import("./lib/api")>();
	return {
		...actual,
		listPosts: vi.fn().mockResolvedValue([]),
		listSiteTags: vi.fn().mockResolvedValue([]),
		fetchPost: vi.fn(),
		listActiveNewsletters: vi.fn().mockResolvedValue([]),
	};
});

vi.mock("./lib/cardConfig", async importOriginal => {
	const actual = await importOriginal<typeof import("./lib/cardConfig")>();
	return {
		...actual,
		loadSiteSettings: vi.fn().mockResolvedValue(actual.DEFAULT_SETTINGS),
	};
});

afterEach(() => {
	cleanup();
	localStorage.clear();
});

describe("App keyboard shortcuts", () => {
	beforeEach(() => {
		setUiPrefs({editorEngine: "lexical-lab"});
	});

	it("toggles editorEngine between lexical-lab and koenig on Cmd+Option+E / Ctrl+Alt+E", () => {
		render(<App />);

		expect(getUiPrefs().editorEngine).toBe("lexical-lab");

		// Cmd+Option+E
		fireEvent.keyDown(window, {
			key: "e",
			code: "KeyE",
			metaKey: true,
			altKey: true,
		});

		expect(getUiPrefs().editorEngine).toBe("koenig");

		// Press again to toggle back to lexical-lab
		fireEvent.keyDown(window, {
			key: "e",
			code: "KeyE",
			metaKey: true,
			altKey: true,
		});

		expect(getUiPrefs().editorEngine).toBe("lexical-lab");

		// Ctrl+Alt+E works too (e.g. on Windows/Linux)
		fireEvent.keyDown(window, {
			key: "e",
			code: "KeyE",
			ctrlKey: true,
			altKey: true,
		});

		expect(getUiPrefs().editorEngine).toBe("koenig");
	});

	it("handles dead key / acute character when altKey is pressed on macOS (key: '´', code: 'KeyE')", () => {
		render(<App />);

		expect(getUiPrefs().editorEngine).toBe("lexical-lab");

		fireEvent.keyDown(window, {
			key: "´",
			code: "KeyE",
			metaKey: true,
			altKey: true,
		});

		expect(getUiPrefs().editorEngine).toBe("koenig");
	});
});

const SITE: Site = {
	base: "https://example.ghost.io",
	siteUrl: "https://example.ghost.io/",
	title: "Example Publication",
	version: "5.80",
	keyKind: "staff",
	clockOffset: 0,
};

const DRAFT_SUMMARY: Post = {
	id: "post-1",
	uuid: "uuid-1",
	title: "Draft Post",
	slug: "draft-post",
	status: "draft",
	updated_at: "2026-10-30T12:00:00.000Z",
};

const DRAFT_DETAIL: PostDetail = {
	...DRAFT_SUMMARY,
	lexical: JSON.stringify({
		root: {
			children: [
				{
					children: [],
					direction: null,
					format: "",
					indent: 0,
					type: "paragraph",
					version: 1,
				},
			],
			direction: null,
			format: "",
			indent: 0,
			type: "root",
			version: 1,
		},
	}),
};

describe("App TitleBar layout", () => {
	beforeEach(() => {
		setUiPrefs({editorEngine: "lexical-lab"});
		saveSites([SITE]);
		setActiveBase(SITE.base);
		vi.mocked(listPosts).mockResolvedValue([DRAFT_SUMMARY]);
		vi.mocked(fetchPost).mockResolvedValue(DRAFT_DETAIL);
	});

	it("renders sidebar toggle on the left in list view and switches to inspector/revisions toggles in the editor", async () => {
		const {container} = render(<App />);

		const shell = container.querySelector(".app-shell");
		expect(shell).toHaveAttribute("data-sidebar", "open");

		// In list view, titlebar-sidebar-toggle is rendered on the left side
		const sidebarToggle = screen.getByTestId("titlebar-sidebar-toggle");
		expect(sidebarToggle.closest(".titlebar-left-actions")).not.toBeNull();
		expect(sidebarToggle.closest(".titlebar-actions")).toBeNull();

		// Inspector and revisions toggles are NOT rendered in the list view
		expect(screen.queryByTestId("titlebar-inspector-toggle")).toBeNull();
		expect(screen.queryByTestId("titlebar-revisions")).toBeNull();

		// Clicking titlebar-sidebar-toggle toggles data-sidebar
		fireEvent.click(sidebarToggle);
		expect(shell).toHaveAttribute("data-sidebar", "collapsed");

		// Open the post in the editor
		const postRow = await screen.findByText("Draft Post");
		fireEvent.click(postRow);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Draft Post")).toBeInTheDocument();
		});

		// In the editor, titlebar-sidebar-toggle is hidden
		expect(screen.queryByTestId("titlebar-sidebar-toggle")).toBeNull();

		// Inspector and revisions buttons ARE rendered in the editor
		const inspectorToggle = screen.getByTestId("titlebar-inspector-toggle");
		const revisionsToggle = screen.getByTestId("titlebar-revisions");
		expect(inspectorToggle).toBeInTheDocument();
		expect(revisionsToggle).toBeInTheDocument();

		// Toggle the editor's inspector drawer via titlebar-inspector-toggle
		expect(screen.queryByLabelText("Post settings")).toBeNull();
		fireEvent.click(inspectorToggle);
		expect(screen.getByLabelText("Post settings")).toBeInTheDocument();
		fireEvent.click(inspectorToggle);
		expect(screen.queryByLabelText("Post settings")).toBeNull();

		// Toggle the editor's revisions drawer via titlebar-revisions
		expect(screen.queryByTestId("revisions-drawer")).toBeNull();
		fireEvent.click(revisionsToggle);
		await waitFor(() => {
			expect(screen.getByTestId("revisions-drawer")).toBeInTheDocument();
		});
		fireEvent.click(revisionsToggle);
		await waitFor(() => {
			expect(screen.queryByTestId("revisions-drawer")).toBeNull();
		});
	});
});
