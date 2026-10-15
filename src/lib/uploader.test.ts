import {describe, expect, it} from "vitest";
import {endpointFor, urlFromUploadResponse, FILE_TYPES} from "./uploader";

describe("fileTypes", () => {
	it("is always defined, with an image entry", () => {
		// Regression guard for plan §15.1: Koenig reads
		// `fileUploader.fileTypes.image.mimeTypes` without optional chaining,
		// so omitting fileTypes unmounts the whole editor on card insert.
		expect(FILE_TYPES).toBeDefined();
		expect(FILE_TYPES.image).toBeDefined();
		expect(FILE_TYPES.image.mimeTypes).toContain("image/*");
	});

	it("uses real mime type strings, since they become the input accept attr", () => {
		for (const key of ["image", "audio", "video"] as const) {
			for (const mime of FILE_TYPES[key].mimeTypes) {
				expect(mime).toMatch(/^[a-z]+\/[a-z0-9*]+$/);
			}
		}
	});
});

describe("endpointFor", () => {
	it("maps images to the images endpoint", () => {
		expect(endpointFor("image")).toBe("/images/upload/");
	});

	it("sends the video thumbnail blob to the images endpoint", () => {
		// Plan §15.2: the video card generates a still frame client-side and
		// uploads it as "mediaThumbnail". A catch-all mapping would have sent
		// that image blob to /media/upload/.
		expect(endpointFor("mediaThumbnail")).toBe("/images/upload/");
	});

	it("maps files and media to their own endpoints", () => {
		expect(endpointFor("file")).toBe("/files/upload/");
		expect(endpointFor("audio")).toBe("/media/upload/");
		expect(endpointFor("video")).toBe("/media/upload/");
	});

	it("falls back to media for an unknown type", () => {
		expect(endpointFor("something-new")).toBe("/media/upload/");
	});
});

describe("urlFromUploadResponse", () => {
	it("reads images, files and media collections", () => {
		expect(urlFromUploadResponse({images: [{url: "a"}]})).toBe("a");
		expect(urlFromUploadResponse({files: [{url: "b"}]})).toBe("b");
		expect(urlFromUploadResponse({media: [{url: "c"}]})).toBe("c");
	});

	it("prefers the first populated collection", () => {
		expect(urlFromUploadResponse({images: [{url: "a"}], media: [{url: "c"}]})).toBe(
			"a",
		);
	});

	it("returns undefined when the response has no url", () => {
		expect(urlFromUploadResponse({})).toBeUndefined();
		expect(urlFromUploadResponse({images: []})).toBeUndefined();
	});
});