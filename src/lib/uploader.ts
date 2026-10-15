import {useState} from "react";
import type {Site} from "./api";
import {api} from "./api";

/** mime types the editor's file inputs advertise. Mandatory — see plan §15.1. */
export const FILE_TYPES = {
	image: {mimeTypes: ["image/*"]},
	audio: {mimeTypes: ["audio/*"]},
	video: {mimeTypes: ["video/*"]},
};

/**
 * `mediaThumbnail` is a client-generated image blob (the video card makes a
 * still frame), so it goes to the images endpoint even though its type name
 * isn't "image". The plan's catch-all would have posted it to /media/upload/.
 */
export const ENDPOINTS: Record<string, string> = {
	image: "/images/upload/",
	mediaThumbnail: "/images/upload/",
	file: "/files/upload/",
	audio: "/media/upload/",
	video: "/media/upload/",
};

export function endpointFor(type: string): string {
	return ENDPOINTS[type] ?? "/media/upload/";
}

/** Each upload endpoint returns its results under a different collection key. */
export function urlFromUploadResponse(json: {
	images?: {url: string}[];
	files?: {url: string}[];
	media?: {url: string}[];
}): string | undefined {
	return (
		json.images?.[0]?.url ?? json.files?.[0]?.url ?? json.media?.[0]?.url
	);
}

export type UploadError = {fileName?: string; message: string};
export type UploadResult = {url: string; fileName?: string};

export type FileUploadType =
	| "image"
	| "audio"
	| "video"
	| "file"
	| "mediaThumbnail";

export function makeFileUploader(site: Site) {
	function useFileUpload(type: FileUploadType) {
		const [progress, setProgress] = useState(0);
		const [isLoading, setLoading] = useState(false);
		const [errors, setErrors] = useState<UploadError[]>([]);
		const [filesNumber, setFilesNumber] = useState(0);

		async function upload(files: FileList | File[]) {
			const list = Array.from(files);
			const endpoint = endpointFor(type);
			setFilesNumber(list.length);
			setLoading(true);
			setErrors([]);
			setProgress(0);

			const results: UploadResult[] = [];
			for (const [i, file] of list.entries()) {
				const form = new FormData();
				form.append("file", file, file.name);
				try {
					const json = await api<{
						images?: {url: string}[];
						files?: {url: string}[];
						media?: {url: string}[];
					}>(site, endpoint, {method: "POST", body: form});
					const url = urlFromUploadResponse(json);
					if (url) {
						results.push({url, fileName: file.name});
					}
				} catch (err) {
					setErrors(prev => [
						...prev,
						{
							fileName: file.name,
							message: err instanceof Error ? err.message : String(err),
						},
					]);
				}
				setProgress(Math.round(((i + 1) / list.length) * 100));
			}
			setLoading(false);
			return results;
		}

		return {upload, progress, isLoading, errors, filesNumber};
	}

	return {useFileUpload, fileTypes: FILE_TYPES};
}