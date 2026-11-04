import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext";
import {
	$createParagraphNode,
	$getNodeByKey,
	$getRoot,
	$getSelection,
	$isElementNode,
	$isParagraphNode,
	$isRangeSelection,
	COMMAND_PRIORITY_HIGH,
	DROP_COMMAND,
	PASTE_COMMAND,
} from "lexical";
import {useCallback, useContext, useEffect} from "react";
import {api, type Site} from "../../lib/api";
import {DEFAULT_CARD_PAYLOADS} from "../../lib/lab/ghostCardCatalog";
import {$createGhostCardNode, $isGhostCardNode} from "../../lib/lab/GhostCardNode";
import {LabSiteContext} from "../../lib/lab/labContext";
import {endpointFor, urlFromUploadResponse} from "../../lib/uploader";

export type MediaDropPastePluginProps = {
	site?: Site;
};

function extractImageFiles(event: unknown): File[] {
	if (!event || typeof event !== "object") {
		return [];
	}
	const ev = event as {
		clipboardData?: DataTransfer | null;
		dataTransfer?: DataTransfer | null;
	};
	const fileList = ev.clipboardData?.files ?? ev.dataTransfer?.files;
	if (!fileList || fileList.length === 0) {
		return [];
	}
	return Array.from(fileList).filter(
		file => typeof file.type === "string" && file.type.startsWith("image/"),
	);
}

export function MediaDropPastePlugin({site}: MediaDropPastePluginProps) {
	const [editor] = useLexicalComposerContext();
	const labSiteContext = useContext(LabSiteContext);
	const effectiveSite = site ?? labSiteContext?.site ?? undefined;

	const handleImageFiles = useCallback(
		(imageFiles: File[]) => {
			for (const file of imageFiles) {
				editor.update(() => {
					const payload = {
						...DEFAULT_CARD_PAYLOADS.image,
						src: "",
						alt: file.name.replace(/\.[^.]+$/, ""),
						fileName: file.name,
					};
					const cardNode = $createGhostCardNode("image", payload);
					const selection = $getSelection();

					if ($isRangeSelection(selection)) {
						const topLevel = selection.anchor.getNode().getTopLevelElement();
						if (
							$isParagraphNode(topLevel) &&
							topLevel.getTextContent().trim() === ""
						) {
							topLevel.replace(cardNode);
						} else if (topLevel) {
							topLevel.insertAfter(cardNode);
						} else {
							$getRoot().append(cardNode);
						}
					} else {
						const root = $getRoot();
						const lastChild = root.getLastChild();
						if (
							$isParagraphNode(lastChild) &&
							lastChild.getTextContent().trim() === "" &&
							root.getChildrenSize() === 1
						) {
							lastChild.replace(cardNode);
						} else {
							root.append(cardNode);
						}
					}

					const next = cardNode.getNextSibling();
					if (next === null) {
						const trailing = $createParagraphNode();
						cardNode.insertAfter(trailing);
						trailing.selectStart();
					} else if ($isElementNode(next)) {
						next.selectStart();
					}

					const insertedKey = cardNode.getKey();
					const uploadAndPatch = async () => {
						let uploadedUrl: string | undefined;
						if (effectiveSite) {
							try {
								const endpoint = endpointFor("image");
								const form = new FormData();
								form.append("file", file, file.name);
								const json = await api<{
									images?: {url: string}[];
									files?: {url: string}[];
									media?: {url: string}[];
								}>(effectiveSite, endpoint, {method: "POST", body: form});
								uploadedUrl = urlFromUploadResponse(json);
							} catch (err) {
								console.error("Image drop/paste upload failed:", err);
							}
						}

						if (uploadedUrl) {
							editor.update(() => {
								const node = $getNodeByKey(insertedKey);
								if ($isGhostCardNode(node)) {
									node.updateData({src: uploadedUrl, fileName: file.name});
								}
							});
						}
					};

					void uploadAndPatch();
				});
			}
		},
		[editor, effectiveSite],
	);

	useEffect(() => {
		const unregisterPaste = editor.registerCommand(
			PASTE_COMMAND,
			event => {
				const images = extractImageFiles(event);
				if (images.length === 0) {
					return false;
				}
				event.preventDefault();
				handleImageFiles(images);
				return true;
			},
			COMMAND_PRIORITY_HIGH,
		);

		const unregisterDrop = editor.registerCommand(
			DROP_COMMAND,
			event => {
				if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
					event.preventDefault();
				}
				const images = extractImageFiles(event);
				if (images.length === 0) {
					return Boolean(
						event.dataTransfer?.files && event.dataTransfer.files.length > 0,
					);
				}
				event.preventDefault();
				handleImageFiles(images);
				return true;
			},
			COMMAND_PRIORITY_HIGH,
		);

		return () => {
			unregisterPaste();
			unregisterDrop();
		};
	}, [editor, handleImageFiles]);

	return null;
}
