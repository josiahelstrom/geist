import {describe, expect, it} from "vitest";
import type {PostRevision} from "./api";
import {
	buildRestorePatch,
	extractLexicalPlainText,
	formatRevisionReason,
	sortRevisionsNewestFirst,
} from "./revisions";

function revision(overrides: Partial<PostRevision> = {}): PostRevision {
	return {
		id: "rev-1",
		title: "Draft title",
		lexical: JSON.stringify({
			root: {
				type: "root",
				children: [
					{
						type: "paragraph",
						children: [{type: "text", text: "Hello world"}],
					},
				],
			},
		}),
		created_at: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

function paragraph(...texts: string[]) {
	return {
		type: "paragraph",
		children: texts.map(text => ({type: "text", text})),
	};
}

function lexical(...children: unknown[]): string {
	return JSON.stringify({root: {type: "root", children}});
}

describe("formatRevisionReason", () => {
	it("maps every known Ghost revision reason to a label", () => {
		expect(formatRevisionReason("initial_revision")).toBe("Initial version");
		expect(formatRevisionReason("explicit_save")).toBe(
			"Saved revision (Cmd+S)",
		);
		expect(formatRevisionReason("background_save")).toBe("Autosave");
		expect(formatRevisionReason("published")).toBe("Published");
		expect(formatRevisionReason("unpublished")).toBe("Unpublished");
	});

	it("falls back to a generic label for unknown or missing reasons", () => {
		expect(formatRevisionReason("mystery_reason")).toBe("Revision");
		expect(formatRevisionReason("")).toBe("Revision");
		expect(formatRevisionReason(undefined)).toBe("Revision");
	});
});

describe("extractLexicalPlainText", () => {
	it("extracts text from a simple Lexical document", () => {
		expect(extractLexicalPlainText(lexical(paragraph("Hello world")))).toBe(
			"Hello world",
		);
	});

	it("joins multiple paragraphs with newlines", () => {
		expect(
			extractLexicalPlainText(
				lexical(paragraph("First line"), paragraph("Second line")),
			),
		).toBe("First line\nSecond line");
	});

	it("recursively collects text from nested nodes", () => {
		const nested = lexical({
			type: "paragraph",
			children: [
				{type: "text", text: "A "},
				{
					type: "link",
					children: [
						{type: "text", text: "linked "},
						{
							type: "format",
							children: [{type: "text", text: "words"}],
						},
					],
				},
				{type: "text", text: " here"},
			],
		});
		expect(extractLexicalPlainText(nested)).toBe("A linked words here");
	});

	it("extracts text from nested list items and headings", () => {
		const doc = lexical(
			{
				type: "heading",
				children: [{type: "text", text: "Heading"}],
			},
			{
				type: "list",
				children: [
					{
						type: "listitem",
						children: [{type: "text", text: "One"}],
					},
					{
						type: "listitem",
						children: [{type: "text", text: "Two"}],
					},
				],
			},
		);
		expect(extractLexicalPlainText(doc)).toBe("Heading\nOne\nTwo");
	});

	it("returns an empty string for malformed JSON", () => {
		expect(extractLexicalPlainText("{not valid json")).toBe("");
		expect(extractLexicalPlainText("")).toBe("");
	});

	it("returns an empty string when there is no Lexical root", () => {
		expect(extractLexicalPlainText(JSON.stringify({}))).toBe("");
		expect(extractLexicalPlainText(JSON.stringify(null))).toBe("");
		expect(extractLexicalPlainText(JSON.stringify("plain string"))).toBe("");
	});

	it("ignores null and primitive child entries", () => {
		expect(
			extractLexicalPlainText(
				JSON.stringify({
					root: {
						children: [
							null,
							42,
							{
								type: "paragraph",
								children: [null, {text: "ok"}],
							},
						],
					},
				}),
			),
		).toBe("ok");
	});

	it("ignores nodes without string text", () => {
		const doc = lexical({
			type: "paragraph",
			children: [
				{type: "text", text: 42},
				{type: "text", text: "kept"},
			],
		});
		expect(extractLexicalPlainText(doc)).toBe("kept");
	});
});

describe("sortRevisionsNewestFirst", () => {
	it("sorts by created_at_ts descending", () => {
		const oldest = revision({id: "old", created_at_ts: 1000});
		const newest = revision({id: "new", created_at_ts: 3000});
		const middle = revision({id: "mid", created_at_ts: 2000});

		expect(
			sortRevisionsNewestFirst([oldest, newest, middle]).map(r => r.id),
		).toEqual(["new", "mid", "old"]);
	});

	it("falls back to parsing created_at when no timestamp is present", () => {
		const older = revision({
			id: "older",
			created_at: "2025-01-01T00:00:00.000Z",
		});
		const newer = revision({
			id: "newer",
			created_at: "2026-06-01T00:00:00.000Z",
		});

		expect(sortRevisionsNewestFirst([older, newer]).map(r => r.id)).toEqual([
			"newer",
			"older",
		]);
	});

	it("prefers created_at_ts over created_at", () => {
		const byDate = revision({
			id: "by-date",
			created_at: "2026-06-01T00:00:00.000Z",
			created_at_ts: 1000,
		});
		const byTimestamp = revision({
			id: "by-timestamp",
			created_at: "2020-01-01T00:00:00.000Z",
			created_at_ts: 2000,
		});

		expect(
			sortRevisionsNewestFirst([byDate, byTimestamp]).map(r => r.id),
		).toEqual(["by-timestamp", "by-date"]);
	});

	it("sorts unparseable dates last and does not mutate the input", () => {
		const invalid = revision({id: "invalid", created_at: "not a date"});
		const valid = revision({
			id: "valid",
			created_at: "2026-01-01T00:00:00.000Z",
		});
		const input = [invalid, valid];

		const sorted = sortRevisionsNewestFirst(input);

		expect(sorted.map(r => r.id)).toEqual(["valid", "invalid"]);
		expect(input.map(r => r.id)).toEqual(["invalid", "valid"]);
		expect(sorted).not.toBe(input);
	});
});

describe("buildRestorePatch", () => {
	it("extracts every restorable field from a revision", () => {
		const r = revision({
			title: "Restored title",
			lexical: lexical(paragraph("Restored body")),
			custom_excerpt: "Restored excerpt",
			feature_image: "https://example.com/image.png",
			feature_image_alt: "An image",
			feature_image_caption: "A caption",
		});

		expect(buildRestorePatch(r)).toEqual({
			title: "Restored title",
			lexical: r.lexical,
			custom_excerpt: "Restored excerpt",
			feature_image: "https://example.com/image.png",
			feature_image_alt: "An image",
			feature_image_caption: "A caption",
		});
	});

	it("normalizes missing optional fields to null", () => {
		const r = revision();
		delete r.custom_excerpt;
		delete r.feature_image;

		expect(buildRestorePatch(r)).toEqual({
			title: "Draft title",
			lexical: r.lexical,
			custom_excerpt: null,
			feature_image: null,
			feature_image_alt: null,
			feature_image_caption: null,
		});
	});

	it("preserves explicit null optional fields", () => {
		const r = revision({
			custom_excerpt: null,
			feature_image: null,
			feature_image_alt: null,
			feature_image_caption: null,
		});

		expect(buildRestorePatch(r)).toMatchObject({
			custom_excerpt: null,
			feature_image: null,
			feature_image_alt: null,
			feature_image_caption: null,
		});
	});
});
