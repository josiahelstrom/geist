/**
 * Type declarations for @tryghost/koenig-lexical, which ships no types of its
 * own. Shapes here were derived from the dist bundle and re-checked against
 * 1.13.1's exports, props, and style.css export, not guessed.
 */

declare module "@tryghost/koenig-lexical" {
	import type {ComponentType, ReactNode} from "react";

	export const version: string;

	export type LexicalEditorState = {
		root: {
			type: "root";
			version: number;
			children: unknown[];
		};
	};

	export type UploadError = {fileName?: string; message: string};
	export type UploadResult = {url: string; fileName?: string};

	export type FileUploadType =
		| "image"
		| "audio"
		| "video"
		| "file"
		| "mediaThumbnail";

	export type FileTypeSpec = {mimeTypes: string[]};

	export type FileUploaderState = {
		upload: (files: FileList | File[]) => Promise<UploadResult[] | null>;
		progress: number;
		isLoading: boolean;
		errors: UploadError[];
		filesNumber: number;
	};

	export type FileUploader = {
		useFileUpload: (type: FileUploadType) => FileUploaderState;
		fileTypes: {
			image?: FileTypeSpec;
			audio?: FileTypeSpec;
			video?: FileTypeSpec;
			file?: FileTypeSpec;
		};
	};

	export type CardConfig = {
		siteUrl?: string;
		siteTitle?: string;
		fetchEmbed?: (
			url: string,
			options: {type: string},
		) => Promise<unknown>;
		[key: string]: unknown;
	};

	export type KoenigComposerProps = {
		initialEditorState?: string | object;
		nodes?: unknown[];
		onError?: (error: unknown) => void;
		fileUploader?: Partial<FileUploader>;
		cardConfig?: CardConfig;
		darkMode?: boolean;
		enableMultiplayer?: boolean;
		children?: ReactNode;
	};

	export type KoenigEditorProps = {
		/** Receives the editor state as plain JSON, not a Lexical EditorState. */
		onChange?: (state: LexicalEditorState) => void;
		placeholderText?: string;
		readOnly?: boolean;
		children?: ReactNode;
	};

	export const KoenigComposer: ComponentType<KoenigComposerProps>;
	export const KoenigEditor: ComponentType<KoenigEditorProps>;
	export const KoenigComposableEditor: ComponentType<
		Record<string, unknown> & {children?: ReactNode}
	>;
}

declare module "@tryghost/koenig-lexical/style.css";