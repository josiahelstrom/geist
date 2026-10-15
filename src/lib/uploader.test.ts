import {describe, expect, it} from "vitest";
import {
	FILE_TYPES,
	endpointFor,
	urlFromUploadResponse,
} from "./uploader";

describe("uploader endpoints and file types", () => {
	it("advertises image, audio, video and file mime types for card file pickers", () => {
		expect(FILE_TYPES.image.mimeTypes).toContain("image/*");
		expect(FILE_TYPES.audio.mimeTypes).toContain("audio/*");
		expect(FILE_TYPES.video.mimeTypes).toContain("video/*");
		expect(FILE_TYPES.file.mimeTypes).toBeDefined();
	});

	it("routes mediaThumbnail to images upload", () => {
		expect(endpointFor("mediaThumbnail")).toBe("/images/upload/");
	});

	it("routes image to images upload", () => {
		expect(endpointFor("image")).toBe("/images/upload/");
	});

	it("routes file to files upload", () => {
		expect(endpointFor("file")).toBe("/files/upload/");
	});

	it("routes audio and video to media upload", () => {
		expect(endpointFor("audio")).toBe("/media/upload/");
		expect(endpointFor("video")).toBe("/media/upload/");
	});

	it("extracts url from images response", () => {
		expect(
			urlFromUploadResponse({images: [{url: "http://example.com/i.png"}]}),
		).toBe("http://example.com/i.png");
	});

	it("extracts url from files response", () => {
		expect(
			urlFromUploadResponse({files: [{url: "http://example.com/doc.pdf"}]}),
		).toBe("http://example.com/doc.pdf");
	});

	it("extracts url from media response", () => {
		expect(
			urlFromUploadResponse({media: [{url: "http://example.com/vid.mp4"}]}),
		).toBe("http://example.com/vid.mp4");
	});

	it("returns undefined on empty collections", () => {
		expect(urlFromUploadResponse({})).toBeUndefined();
	});
});
