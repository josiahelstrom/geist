import type {
	DOMExportOutput,
	EditorConfig,
	LexicalEditor,
	LexicalNode,
	NodeKey,
	SerializedLexicalNode,
	Spread,
} from "lexical";
import {$getNodeByKey, DecoratorNode} from "lexical";
import type {JSX} from "react";
import React, {useCallback, useContext, useEffect, useMemo, useRef, useState} from "react";

import {
	compileFootnotesCard,
	convertFootnoteHtmlCardToLexicalNodes,
	convertFootnotedParagraphsToHtmlCards,
	extractFootnoteDefinitionsFromHtml,
	findFootnoteReferenceLabels,
	getHtmlFromCard,
	isFootnoteReferenceHtmlCard,
	isFootnotesHtmlCard,
	type FootnoteItem,
} from "./footnoteSerializer";
import {LabSiteContext} from "./labContext";
import {endpointFor, urlFromUploadResponse, type FileUploadType} from "../uploader";
import {api} from "../api";
import {fetchEmbed} from "../posts";

export type SerializedGhostCardNode = Spread<
	{
		cardType: string;
		data: Record<string, unknown>;
	},
	SerializedLexicalNode
>;

const HTML_CARD_TYPE = "html";

/**
 * Tags that are explicitly removed from HTML card previews. Ghost HTML cards
 * can contain arbitrary markup, so the editor preview is best-effort
 * sanitized before it is injected into the DOM.
 *
 * DOMPurify is not currently a direct dependency, so this uses a conservative
 * regex-based sanitizer that strips scripts, embeds, event handlers and
 * javascript: URLs. It is intended to make previews safe, not to be a
 * general-purpose HTML sanitizer.
 */
const DANGEROUS_TAGS = new Set([
	"script",
	"iframe",
	"object",
	"embed",
	"form",
	"input",
	"button",
	"textarea",
	"select",
	"style",
	"link",
	"meta",
	"base",
	"svg",
	"math",
	"xmp",
	"plaintext",
	"noembed",
	"noscript",
]);

const FOOTNOTE_ID_TAGS = new Set(["li", "a", "sup"]);
const FOOTNOTE_ID_REGEX = /^fn(ref)?[a-zA-Z0-9_-]+$/;

const URL_ATTRIBUTES = new Set([
	"href",
	"src",
	"srcset",
	"xlink:href",
	"action",
	"formaction",
	"poster",
	"srcdoc",
]);

function hasDangerousUrlScheme(rawValue: string): boolean {
	const val = rawValue.replace(/[\u0000-\u0020]+/g, "").toLowerCase();
	return (
		val.startsWith("javascript:") ||
		val.startsWith("vbscript:") ||
		val.startsWith("data:text/html")
	);
}

export function sanitizeGhostCardHtml(html: string): string {
	if (!html) {
		return "";
	}

	if (typeof DOMParser === "undefined") {
		return html.replace(/<[^>]*>/g, "").trim();
	}

	const doc = new DOMParser().parseFromString(html, "text/html");

	const elements = Array.from(doc.body.querySelectorAll("*"));
	for (const el of elements) {
		if (!el.isConnected) {
			continue;
		}

		const tagName = el.tagName.toLowerCase();
		if (
			DANGEROUS_TAGS.has(tagName) ||
			DANGEROUS_TAGS.has(el.localName.toLowerCase())
		) {
			el.remove();
			continue;
		}

		for (const attr of Array.from(el.attributes)) {
			const attrName = attr.name.toLowerCase();
			if (
				attrName.startsWith("on") ||
				attrName === "style" ||
				attrName === "name"
			) {
				el.removeAttribute(attr.name);
				continue;
			}

			if (attrName === "id") {
				const isFootnoteAnchor =
					FOOTNOTE_ID_TAGS.has(tagName) &&
					FOOTNOTE_ID_REGEX.test(attr.value) &&
					!attr.value.startsWith("fn-");
				if (!isFootnoteAnchor) {
					el.removeAttribute(attr.name);
				}
				continue;
			}

			if (URL_ATTRIBUTES.has(attrName)) {
				const isDangerous =
					hasDangerousUrlScheme(attr.value) ||
					(attrName === "srcset" &&
						(attr.value
							.split(",")
							.some(entry => hasDangerousUrlScheme(entry)) ||
							/(?:javascript:|vbscript:|data:text\/html)/i.test(
								attr.value.replace(/[\u0000-\u0020]+/g, ""),
							)));
				if (isDangerous) {
					el.removeAttribute(attr.name);
				}
			}
		}

		if (tagName === "a" && el.hasAttribute("href")) {
			el.setAttribute("rel", "noopener noreferrer");
		}
	}

	return doc.body.innerHTML.trim();
}

function isHtmlCardType(cardType: unknown): boolean {
	return (
		typeof cardType === "string" &&
		cardType.trim().toLowerCase() === HTML_CARD_TYPE
	);
}

function readHtmlFromData(
	data: Record<string, unknown> | null | undefined,
): string | null {
	if (!data || typeof data !== "object") {
		return null;
	}

	// Some paths (for example re-importing an exported node, or wrapping an
	// already-wrapped card) nest the original payload under `data`. Check the
	// direct field first, then the common nested shapes.
	const candidates: unknown[] = [
		data.html,
		(data.data as Record<string, unknown> | undefined)?.html,
		(data.payload as Record<string, unknown> | undefined)?.html,
	];

	for (const candidate of candidates) {
		if (typeof candidate === "string") {
			return candidate;
		}
	}

	return null;
}

/**
 * Returns the HTML for an HTML card, or `null` when the node is not an HTML
 * card at all. An HTML card with missing/empty/whitespace-only content
 * deliberately returns an empty string so the card header and source toggle
 * are still rendered instead of falling through to the generic placeholder.
 */
function getHtmlCardContent(
	cardType: string,
	data: Record<string, unknown>,
): string | null {
	if (!isHtmlCardType(cardType)) {
		return null;
	}

	return readHtmlFromData(data) ?? "";
}

export class GhostCardNode extends DecoratorNode<JSX.Element> {
	__cardType: string;
	__data: Record<string, unknown>;

	static override getType(): string {
		return "ghost-card";
	}

	static override clone(node: GhostCardNode): GhostCardNode {
		return new GhostCardNode(node.__cardType, node.__data, node.__key);
	}

	constructor(
		cardType: string,
		data?: Record<string, unknown>,
		key?: NodeKey,
	) {
		super(key);
		this.__cardType = cardType;
		this.__data = data ? {...data} : {};
	}

	getCardType(): string {
		return this.__cardType;
	}

	setCardType(cardType: string): void {
		const writable = this.getWritable();
		writable.__cardType = cardType;
	}

	getData(): Record<string, unknown> {
		return this.__data;
	}

	setData(data: Record<string, unknown>): void {
		const writable = this.getWritable();
		writable.__data = {...data};
	}

	updateData(patch: Record<string, unknown>): void {
		const writable = this.getWritable();
		writable.__data = {...writable.__data, ...patch};
	}

	override createDOM(_config: EditorConfig): HTMLElement {
		const element = document.createElement("div");
		element.className = "ghost-card-wrapper";
		element.setAttribute("data-ghost-card-type", this.__cardType);
		return element;
	}

	override updateDOM(): boolean {
		return false;
	}

	static override importJSON(
		serializedNode: Record<string, unknown>,
	): GhostCardNode {
		const cardType =
			typeof serializedNode.cardType === "string"
				? serializedNode.cardType
				: typeof serializedNode.type === "string" &&
					  serializedNode.type !== "ghost-card"
					? serializedNode.type
					: "unknown";

		const data =
			typeof serializedNode.data === "object" &&
			serializedNode.data !== null &&
			!Array.isArray(serializedNode.data)
				? (serializedNode.data as Record<string, unknown>)
				: {...serializedNode};

		return $createGhostCardNode(cardType, data);
	}

	override exportJSON(): SerializedGhostCardNode {
		return {
			type: "ghost-card",
			cardType: this.__cardType,
			data: this.__data,
			version: 1,
		};
	}

	override exportDOM(): DOMExportOutput {
		const element = document.createElement("div");
		element.className = "kg-card";
		element.setAttribute("data-kg-card", this.__cardType);
		return {element};
	}

	override getTextContent(): string {
		return `\n[Ghost Card: ${this.__cardType}]\n`;
	}

	override isInline(): boolean {
		return false;
	}

	override isKeyboardSelectable(): boolean {
		return true;
	}

	override decorate(editor: LexicalEditor, _config: EditorConfig): JSX.Element {
		return React.createElement(GhostCardComponent, {
			cardType: this.__cardType,
			data: this.__data,
			nodeKey: this.__key,
			editor,
		});
	}
}

function GhostCardHeader({
	cardType,
	showToggle,
	toggleLabel,
	toggleTitle,
	onToggle,
	onDelete,
}: {
	cardType: string;
	showToggle: boolean;
	toggleLabel?: string;
	toggleTitle?: string;
	onToggle?: () => void;
	onDelete: () => void;
}) {
	return (
		<div className="ghost-card-html-header">
			<div className="ghost-card-html-header-left">
				<span className="ghost-card-html-label">Ghost Card</span>
				<span className="ghost-card-html-badge">{cardType}</span>
			</div>
			<div style={{display: "flex", alignItems: "center", gap: "6px"}}>
				{showToggle && onToggle && (
					<button
						type="button"
						className="ghost-card-html-toggle"
						onClick={onToggle}
						aria-label={toggleLabel ?? "Inspect payload"}
						title={toggleTitle ?? toggleLabel}
					>
						<span
							className="ghost-card-html-toggle-icon"
							aria-hidden="true"
						>
							{toggleLabel === "Preview" ? "👁" : "</>"}
						</span>
						<span className="ghost-card-html-toggle-text">
							{toggleLabel ?? "Inspect payload"}
						</span>
					</button>
				)}
				<button
					type="button"
					className="ghost-card-delete-button"
					onClick={onDelete}
					aria-label="Delete card"
					title="Delete card"
				>
					×
				</button>
			</div>
		</div>
	);
}

function GhostCardComponent({
	cardType,
	data,
	nodeKey,
	editor,
}: {
	cardType: string;
	data: Record<string, unknown>;
	nodeKey: NodeKey;
	editor: LexicalEditor;
}) {
	const siteContext = useContext(LabSiteContext);
	const site = siteContext?.site;
	const normalizedType = cardType.trim().toLowerCase();
	const isHtml = isHtmlCardType(normalizedType);

	// Toggles
	const [showJson, setShowJson] = useState(false);
	const [showSource, setShowSource] = useState(false);
	const [hasEdited, setHasEdited] = useState(false);
	const [jsonError, setJsonError] = useState<string | null>(null);
	const [jsonText, setJsonText] = useState("");
	const [fetchingEmbed, setFetchingEmbed] = useState(false);
	const [embedError, setEmbedError] = useState<string | null>(null);

	useEffect(() => {
		if (showJson) {
			setJsonText(JSON.stringify(data, null, 2));
		}
	}, [showJson, data]);

	const updateData = useCallback(
		(patch: Record<string, unknown>) => {
			editor.update(() => {
				const node = $getNodeByKey(nodeKey);
				if ($isGhostCardNode(node)) {
					node.updateData(patch);
				}
			});
		},
		[editor, nodeKey],
	);

	const updateField = useCallback(
		(field: string, value: unknown) => {
			editor.update(() => {
				const node = $getNodeByKey(nodeKey);
				if ($isGhostCardNode(node)) {
					const current = node.getData();
					node.setData({...current, [field]: value});
				}
			});
		},
		[editor, nodeKey],
	);

	const updateNestedField = useCallback(
		(parentField: string, field: string, value: unknown) => {
			editor.update(() => {
				const node = $getNodeByKey(nodeKey);
				if ($isGhostCardNode(node)) {
					const current = node.getData();
					const parentObj =
						typeof current[parentField] === "object" && current[parentField] !== null
							? (current[parentField] as Record<string, unknown>)
							: {};
					node.setData({
						...current,
						[parentField]: {...parentObj, [field]: value},
					});
				}
			});
		},
		[editor, nodeKey],
	);

	const handleDelete = useCallback(() => {
		editor.update(() => {
			const node = $getNodeByKey(nodeKey);
			if (node) {
				node.remove();
			}
		});
	}, [editor, nodeKey]);

	// File upload helper
	const handleFileUpload = useCallback(
		async (
			event: React.ChangeEvent<HTMLInputElement>,
			uploadType: FileUploadType,
			targetField = "src",
		) => {
			const files = event.target.files;
			if (!files || files.length === 0) return;
			const file = files[0];

			if (!site) {
				return;
			}
			try {
				const endpoint = endpointFor(uploadType);
				const form = new FormData();
				form.append("file", file, file.name);
				const json = await api<{
					images?: {url: string}[];
					files?: {url: string}[];
					media?: {url: string}[];
				}>(site, endpoint, {method: "POST", body: form});
				const url = urlFromUploadResponse(json);
				if (url) {
					updateField(targetField, url);
					if (targetField === "src" && !data.fileName) {
						updateField("fileName", file.name);
					}
				}
			} catch (err) {
				console.error("Card file upload failed:", err);
			}
		},
		[site, updateField, data.fileName],
	);

	// -------------------------------------------------------------------------
	// HTML Card handling
	// -------------------------------------------------------------------------
	const html = getHtmlCardContent(cardType, data);
	const hasHtml = html !== null && html.trim().length > 0;
	const isEditingHtml = html !== null && (showSource || !hasHtml || hasEdited);
	const [draftHtml, setDraftHtml] = useState(html ?? "");
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const sanitizedHtml = useMemo(
		() => (isEditingHtml ? "" : sanitizeGhostCardHtml(draftHtml)),
		[isEditingHtml, draftHtml],
	);

	useEffect(() => {
		setDraftHtml(html ?? "");
	}, [html]);

	useEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		if (el.scrollHeight > 0) {
			el.style.height = `${Math.max(el.scrollHeight, 120)}px`;
		}
	}, [draftHtml, isEditingHtml]);

	const handleHtmlChange = useCallback(
		(newHtml: string) => {
			setHasEdited(true);
			setDraftHtml(newHtml);
			editor.update(() => {
				const node = $getNodeByKey(nodeKey);
				if ($isGhostCardNode(node)) {
					node.setData({...node.getData(), html: newHtml});
				}
			});
		},
		[editor, nodeKey],
	);

	if (isHtml) {
		const toggleLabel = showSource ? "Preview" : "View source";

		return (
			<div
				className="ghost-card-preview ghost-card-preview-html"
				data-ghost-card-type={cardType}
			>
				<GhostCardHeader
					cardType="HTML"
					showToggle={true}
					toggleLabel={toggleLabel}
					toggleTitle={showSource ? "Show rendered preview" : "Show raw HTML source"}
					onToggle={() =>
						setShowSource(prev => {
							if (prev) {
								setHasEdited(false);
							}
							return !prev;
						})
					}
					onDelete={handleDelete}
				/>
				{isEditingHtml ? (
					<textarea
						ref={textareaRef}
						className="ghost-card-html-editor ghost-card-html-source"
						value={draftHtml}
						rows={6}
						spellCheck={false}
						placeholder="Paste or write your HTML here… e.g. <div>Hello</div>"
						aria-label="HTML source"
						data-testid="ghost-card-html-editor"
						onChange={e => handleHtmlChange(e.target.value)}
					/>
				) : hasHtml ? (
					<div
						className="ghost-card-html-content"
						onClick={e => {
							const target =
								e.target instanceof Element
									? e.target
									: (e.target as Node | null)?.parentElement;
							const anchor = target?.closest("a");
							const href = anchor?.getAttribute("href")?.trim() ?? "";
							if (/^(?:https?:)?\/\//i.test(href)) {
								e.preventDefault();
							}
						}}
						dangerouslySetInnerHTML={{__html: sanitizedHtml}}
					/>
				) : (
					<div className="ghost-card-html-empty">This HTML card is empty.</div>
				)}
			</div>
		);
	}

	// -------------------------------------------------------------------------
	// JSON payload inspector/editor mode
	// -------------------------------------------------------------------------
	if (showJson) {
		return (
			<div
				className={`ghost-card-preview ghost-card-preview-${normalizedType}`}
				data-ghost-card-type={cardType}
			>
				<GhostCardHeader
					cardType={cardType}
					showToggle={true}
					toggleLabel="Editor"
					toggleTitle="Switch back to interactive card editor"
					onToggle={() => setShowJson(false)}
					onDelete={handleDelete}
				/>
				<div className="ghost-card-json-editor-container">
					<textarea
						className="ghost-card-json-textarea"
						value={jsonText}
						rows={8}
						spellCheck={false}
						onChange={e => {
							const text = e.target.value;
							setJsonText(text);
							try {
								const parsed = JSON.parse(text);
								setJsonError(null);
								editor.update(() => {
									const node = $getNodeByKey(nodeKey);
									if ($isGhostCardNode(node)) {
										node.setData(parsed);
									}
								});
							} catch (err) {
								setJsonError(err instanceof Error ? err.message : String(err));
							}
						}}
					/>
					{jsonError && <div className="ghost-card-error-text">Invalid JSON: {jsonError}</div>}
				</div>
			</div>
		);
	}

	// -------------------------------------------------------------------------
	// Dedicated Interactive Editors & Previews
	// -------------------------------------------------------------------------

	// 1. Callout
	if (normalizedType === "callout") {
		const colors = [
			"blue",
			"green",
			"yellow",
			"red",
			"pink",
			"purple",
			"grey",
			"accent",
		];
		const currentColor = String(data.backgroundColor || "blue");
		const emoji = String(data.calloutEmoji ?? "💡");
		const text = String(data.calloutText ?? "");

		return (
			<div
				className="ghost-card-preview ghost-card-preview-callout"
				data-ghost-card-type={cardType}
			>
				<GhostCardHeader
					cardType="callout"
					showToggle={true}
					toggleLabel="Inspect payload"
					onToggle={() => setShowJson(true)}
					onDelete={handleDelete}
				/>
				<div className="ghost-card-body">
					<div className={`ghost-card-callout-box ghost-card-callout-${currentColor}`}>
						<input
							type="text"
							className="ghost-card-callout-emoji-input"
							value={emoji}
							maxLength={4}
							title="Callout emoji"
							onChange={e => updateField("calloutEmoji", e.target.value)}
						/>
						<textarea
							className="ghost-card-callout-text-input"
							value={text}
							rows={2}
							placeholder="Callout text..."
							onChange={e => updateField("calloutText", e.target.value)}
						/>
					</div>
					<div className="ghost-card-control-row">
						<span className="ghost-card-control-label">Color:</span>
						<div className="ghost-card-color-swatches">
							{colors.map(color => (
								<button
									key={color}
									type="button"
									className={`ghost-card-color-swatch ghost-card-color-${color} ${
										currentColor === color ? "is-selected" : ""
									}`}
									title={color}
									onClick={() => updateField("backgroundColor", color)}
								/>
							))}
						</div>
					</div>
				</div>
			</div>
		);
	}

	// 2. Button
	if (normalizedType === "button") {
		const text = String(data.buttonText ?? "");
		const url = String(data.buttonUrl ?? "");
		const alignment = String(data.alignment ?? "center");

		return (
			<div
				className="ghost-card-preview ghost-card-preview-button"
				data-ghost-card-type={cardType}
			>
				<GhostCardHeader
					cardType="button"
					showToggle={true}
					toggleLabel="Inspect payload"
					onToggle={() => setShowJson(true)}
					onDelete={handleDelete}
				/>
				<div className="ghost-card-body">
					<div className="ghost-card-field-row">
						<input
							type="text"
							className="ghost-card-input"
							value={text}
							placeholder="Button text..."
							onChange={e => updateField("buttonText", e.target.value)}
						/>
						<input
							type="url"
							className="ghost-card-input"
							value={url}
							placeholder="https://example.com"
							onChange={e => updateField("buttonUrl", e.target.value)}
						/>
						<div className="ghost-card-button-group">
							<button
								type="button"
								className={`ghost-card-segmented-btn ${alignment === "left" ? "is-active" : ""}`}
								onClick={() => updateField("alignment", "left")}
							>
								Left
							</button>
							<button
								type="button"
								className={`ghost-card-segmented-btn ${alignment === "center" ? "is-active" : ""}`}
								onClick={() => updateField("alignment", "center")}
							>
								Center
							</button>
						</div>
					</div>
					<div
						className="ghost-card-live-preview"
						style={{textAlign: alignment === "left" ? "left" : "center"}}
					>
						<a
							href={url || "#"}
							className="ghost-card-button-pill"
							onClick={e => e.preventDefault()}
						>
							{text || "Button text"}
						</a>
					</div>
				</div>
			</div>
		);
	}

	// 3. Toggle
	if (normalizedType === "toggle") {
		const heading = String(data.heading ?? "");
		const content = String(data.content ?? "");

		return (
			<div
				className="ghost-card-preview ghost-card-preview-toggle"
				data-ghost-card-type={cardType}
			>
				<GhostCardHeader
					cardType="toggle"
					showToggle={true}
					toggleLabel="Inspect payload"
					onToggle={() => setShowJson(true)}
					onDelete={handleDelete}
				/>
				<div className="ghost-card-body">
					<input
						type="text"
						className="ghost-card-input"
						value={heading}
						placeholder="Toggle heading..."
						onChange={e => updateField("heading", e.target.value)}
					/>
					<textarea
						className="ghost-card-textarea"
						value={content}
						rows={3}
						placeholder="Toggle collapsible content..."
						onChange={e => updateField("content", e.target.value)}
					/>
					<details className="ghost-card-toggle-details" open>
						<summary className="ghost-card-toggle-summary">
							{heading || "Toggle heading"}
						</summary>
						<div className="ghost-card-toggle-content">
							{content || "Toggle content..."}
						</div>
					</details>
				</div>
			</div>
		);
	}

	// 4. Call to action & Signup
	if (normalizedType === "call-to-action" || normalizedType === "signup") {
		const isCta = normalizedType === "call-to-action";
		const header = String(data.header ?? (isCta ? data.textValue ?? "" : ""));
		const subheader = String(data.subheader ?? "");
		const buttonText = String(data.buttonText ?? (isCta ? "Learn more" : "Subscribe"));
		const buttonUrl = String(data.buttonUrl ?? "");
		const alignment = String(data.alignment ?? "left");

		return (
			<div
				className={`ghost-card-preview ghost-card-preview-${normalizedType}`}
				data-ghost-card-type={cardType}
			>
				<GhostCardHeader
					cardType={isCta ? "call-to-action" : "signup"}
					showToggle={true}
					toggleLabel="Inspect payload"
					onToggle={() => setShowJson(true)}
					onDelete={handleDelete}
				/>
				<div className="ghost-card-body">
					<div className="ghost-card-field-row">
						<input
							type="text"
							className="ghost-card-input"
							value={header}
							placeholder={isCta ? "Call to action title..." : "Sign up header..."}
							onChange={e => updateField(isCta ? "textValue" : "header", e.target.value)}
						/>
						{!isCta && (
							<input
								type="text"
								className="ghost-card-input"
								value={subheader}
								placeholder="Sign up subheader..."
								onChange={e => updateField("subheader", e.target.value)}
							/>
						)}
					</div>
					<div className="ghost-card-field-row">
						<input
							type="text"
							className="ghost-card-input"
							value={buttonText}
							placeholder="Button label..."
							onChange={e => updateField("buttonText", e.target.value)}
						/>
						{isCta && (
							<input
								type="url"
								className="ghost-card-input"
								value={buttonUrl}
								placeholder="https://example.com"
								onChange={e => updateField("buttonUrl", e.target.value)}
							/>
						)}
						<div className="ghost-card-button-group">
							<button
								type="button"
								className={`ghost-card-segmented-btn ${alignment === "left" ? "is-active" : ""}`}
								onClick={() => updateField("alignment", "left")}
							>
								Left
							</button>
							<button
								type="button"
								className={`ghost-card-segmented-btn ${alignment === "center" ? "is-active" : ""}`}
								onClick={() => updateField("alignment", "center")}
							>
								Center
							</button>
						</div>
					</div>
					<div
						className="ghost-card-cta-preview"
						style={{textAlign: alignment === "left" ? "left" : "center"}}
					>
						<h3 className="ghost-card-cta-title">{header || (isCta ? "Call to action" : "Subscribe")}</h3>
						{!isCta && subheader && <p className="ghost-card-cta-sub">{subheader}</p>}
						<div style={{marginTop: "8px"}}>
							{!isCta && (
								<input
									type="email"
									disabled
									className="ghost-card-input"
									style={{width: "200px", marginRight: "8px", display: "inline-block"}}
									placeholder="your@email.com"
								/>
							)}
							<button type="button" className="ghost-card-button-pill">
								{buttonText}
							</button>
						</div>
					</div>
				</div>
			</div>
		);
	}

	// 5. Email content & Email CTA
	if (normalizedType === "email" || normalizedType === "email-cta") {
		const isEmailCta = normalizedType === "email-cta";
		const content = String(data.html ?? "");
		const buttonText = String(data.buttonText ?? "");
		const buttonUrl = String(data.buttonUrl ?? "");

		return (
			<div
				className={`ghost-card-preview ghost-card-preview-${normalizedType}`}
				data-ghost-card-type={cardType}
			>
				<GhostCardHeader
					cardType={isEmailCta ? "email-cta" : "email"}
					showToggle={true}
					toggleLabel="Inspect payload"
					onToggle={() => setShowJson(true)}
					onDelete={handleDelete}
				/>
				<div className="ghost-card-body">
					<div className="ghost-card-email-banner">
						<span>📬 Only visible when delivered by email (hidden on web)</span>
						<button
							type="button"
							className="ghost-card-chip-btn"
							onClick={() => updateField("html", content + '{first_name, "there"}')}
						>
							Insert &#123;first_name, &quot;there&quot;&#125;
						</button>
					</div>
					<textarea
						className="ghost-card-textarea"
						value={content}
						rows={3}
						placeholder="Email content HTML..."
						onChange={e => updateField("html", e.target.value)}
					/>
					{isEmailCta && (
						<div className="ghost-card-field-row">
							<input
								type="text"
								className="ghost-card-input"
								value={buttonText}
								placeholder="CTA button label..."
								onChange={e => updateField("buttonText", e.target.value)}
							/>
							<input
								type="url"
								className="ghost-card-input"
								value={buttonUrl}
								placeholder="https://example.com"
								onChange={e => updateField("buttonUrl", e.target.value)}
							/>
						</div>
					)}
				</div>
			</div>
		);
	}

	// 6. Public preview / Paywall
	if (normalizedType === "paywall") {
		return (
			<div
				className="ghost-card-preview ghost-card-preview-paywall"
				data-ghost-card-type={cardType}
			>
				<GhostCardHeader
					cardType="paywall"
					showToggle={true}
					toggleLabel="Inspect payload"
					onToggle={() => setShowJson(true)}
					onDelete={handleDelete}
				/>
				<div className="ghost-card-paywall-divider">
					<span>— Public Preview / Members Only —</span>
				</div>
			</div>
		);
	}

	// 7. Bookmark & Embed
	if (normalizedType === "bookmark" || normalizedType === "embed") {
		const isBookmark = normalizedType === "bookmark";
		const url = String(data.url ?? "");
		const meta = (typeof data.metadata === "object" && data.metadata !== null ? data.metadata : {}) as Record<string, unknown>;
		const title = String(meta.title ?? "");
		const desc = String(meta.description ?? "");
		const embedHtml = String(data.html ?? "");
		const caption = String(data.caption ?? "");

		const isMetadataEmpty = isBookmark
			? !title.trim() && !desc.trim()
			: !embedHtml.trim() && !title.trim();

		const handleFetchEmbed = async (targetUrl: string) => {
			const trimmedUrl = targetUrl.trim();
			if (!/^https?:\/\/\S+/i.test(trimmedUrl)) {
				return;
			}
			if (!site) {
				setEmbedError("No site connected.");
				return;
			}
			setFetchingEmbed(true);
			setEmbedError(null);
			try {
				const res = (await fetchEmbed(
					site,
					trimmedUrl,
					normalizedType,
				)) as Record<string, unknown> | null | undefined;
				if (res && typeof res === "object") {
					if (isBookmark) {
						const fetchedMeta =
							typeof res.metadata === "object" && res.metadata !== null
								? (res.metadata as Record<string, unknown>)
								: {};
						const patch: Record<string, unknown> = {
							metadata: {...meta, ...fetchedMeta},
						};
						if (typeof res.url === "string" && res.url) {
							patch.url = res.url;
						}
						updateData(patch);
					} else {
						const patch: Record<string, unknown> = {};
						if (typeof res.html === "string") {
							patch.html = res.html;
						}
						if (typeof res.type === "string") {
							patch.embedType = res.type;
						} else if (typeof res.embedType === "string") {
							patch.embedType = res.embedType;
						}
						if (typeof res.metadata === "object" && res.metadata !== null) {
							patch.metadata = {
								...meta,
								...(res.metadata as Record<string, unknown>),
							};
						}
						if (typeof res.url === "string" && res.url) {
							patch.url = res.url;
						}
						updateData(patch);
					}
				}
			} catch (err) {
				setEmbedError(
					err instanceof Error ? err.message : "Could not fetch metadata.",
				);
			} finally {
				setFetchingEmbed(false);
			}
		};

		return (
			<div
				className={`ghost-card-preview ghost-card-preview-${normalizedType}`}
				data-ghost-card-type={cardType}
			>
				<GhostCardHeader
					cardType={isBookmark ? "bookmark" : "embed"}
					showToggle={true}
					toggleLabel="Inspect payload"
					onToggle={() => setShowJson(true)}
					onDelete={handleDelete}
				/>
				<div className="ghost-card-body">
					<div className="ghost-card-field-row">
						<input
							type="url"
							className="ghost-card-input"
							value={url}
							placeholder={isBookmark ? "https://example.com/article" : "https://youtube.com/watch?v=..."}
							onChange={e => updateField("url", e.target.value)}
							onBlur={e => {
								if (isMetadataEmpty) {
									void handleFetchEmbed(e.target.value);
								}
							}}
							onKeyDown={e => {
								if (e.key === "Enter") {
									e.preventDefault();
									void handleFetchEmbed(e.currentTarget.value);
								}
							}}
						/>
						<button
							type="button"
							className="ghost-card-upload-label"
							data-testid="fetch-embed-button"
							disabled={fetchingEmbed}
							onClick={() => void handleFetchEmbed(url)}
						>
							{fetchingEmbed ? "Fetching..." : "Fetch metadata"}
						</button>
					</div>
					{embedError && (
						<div className="ghost-card-error-text" data-testid="fetch-embed-error">
							{embedError}
						</div>
					)}
					{isBookmark && (
						<div className="ghost-card-field-row">
							<input
								type="text"
								className="ghost-card-input"
								value={title}
								placeholder="Bookmark title..."
								onChange={e => updateNestedField("metadata", "title", e.target.value)}
							/>
							<input
								type="text"
								className="ghost-card-input"
								value={desc}
								placeholder="Bookmark description..."
								onChange={e => updateNestedField("metadata", "description", e.target.value)}
							/>
						</div>
					)}
					<input
						type="text"
						className="ghost-card-input"
						value={caption}
						placeholder="Caption (optional)..."
						onChange={e => updateField("caption", e.target.value)}
					/>
					{url && (
						<div className="ghost-card-bookmark-card">
							<div className="ghost-card-bookmark-content">
								<div className="ghost-card-bookmark-title">{title || url}</div>
								{desc && <div className="ghost-card-bookmark-desc">{desc}</div>}
								<div className="ghost-card-bookmark-url">{url}</div>
							</div>
						</div>
					)}
				</div>
			</div>
		);
	}

	// 8. Image, Video, Audio, File, Gallery
	if (
		normalizedType === "image" ||
		normalizedType === "video" ||
		normalizedType === "audio" ||
		normalizedType === "file" ||
		normalizedType === "gallery"
	) {
		const src = String(data.src ?? "");
		const caption = String(data.caption ?? data.fileCaption ?? "");
		const alt = String(data.alt ?? data.fileTitle ?? data.fileName ?? "");
		const supportsCardWidth =
			normalizedType === "image" ||
			normalizedType === "video" ||
			normalizedType === "gallery";
		const cardWidth = String(data.cardWidth || "regular");

		return (
			<div
				className={`ghost-card-preview ghost-card-preview-${normalizedType}`}
				data-ghost-card-type={cardType}
				data-card-width={supportsCardWidth ? cardWidth : undefined}
			>
				<GhostCardHeader
					cardType={cardType}
					showToggle={true}
					toggleLabel="Inspect payload"
					onToggle={() => setShowJson(true)}
					onDelete={handleDelete}
				/>
				<div className="ghost-card-body">
					<div className="ghost-card-field-row">
						<input
							type="url"
							className="ghost-card-input"
							value={src}
							placeholder={`Paste ${normalizedType} URL...`}
							onChange={e => updateField("src", e.target.value)}
						/>
						<label className="ghost-card-upload-label">
							Upload
							<input
								type="file"
								style={{display: "none"}}
								onChange={e =>
									handleFileUpload(
										e,
										normalizedType === "file"
											? "file"
											: normalizedType === "video"
												? "video"
												: normalizedType === "audio"
													? "audio"
													: "image",
									)
								}
							/>
						</label>
						{supportsCardWidth && (
							<div
								className="ghost-card-button-group"
								data-testid="card-width-selector"
								role="group"
								aria-label="Card width"
							>
								{(["regular", "wide", "full"] as const).map(w => (
									<button
										key={w}
										type="button"
										data-testid={`card-width-${w}`}
										className={`ghost-card-segmented-btn ${cardWidth === w ? "is-active" : ""}`}
										onClick={() => updateField("cardWidth", w)}
									>
										{w}
									</button>
								))}
							</div>
						)}
					</div>
					<div className="ghost-card-field-row">
						<input
							type="text"
							className="ghost-card-input"
							value={alt}
							placeholder={normalizedType === "file" ? "File title..." : "Alt text..."}
							onChange={e =>
								updateField(normalizedType === "file" ? "fileTitle" : "alt", e.target.value)
							}
						/>
						<input
							type="text"
							className="ghost-card-input"
							value={caption}
							placeholder="Caption (optional)..."
							onChange={e =>
								updateField(normalizedType === "file" ? "fileCaption" : "caption", e.target.value)
							}
						/>
					</div>
					{src && (
						<div className="ghost-card-media-container">
							{normalizedType === "image" && (
								<img src={src} alt={alt} className="ghost-card-media-img" />
							)}
							{normalizedType === "video" && (
								<video src={src} controls className="ghost-card-media-video" />
							)}
							{normalizedType === "audio" && (
								<audio src={src} controls className="ghost-card-media-audio" />
							)}
							{normalizedType === "file" && (
								<div className="ghost-card-file-badge">
									📁 <span>{alt || src.split("/").pop()}</span>
								</div>
							)}
							{caption && <div className="ghost-card-media-caption">{caption}</div>}
						</div>
					)}
				</div>
			</div>
		);
	}

	// 9. Product
	if (normalizedType === "product") {
		const title = String(data.productTitle ?? "");
		const desc = String(data.productDescription ?? "");
		const imgSrc = String(data.productImageSrc ?? "");
		const btnText = String(data.productButton ?? "");
		const btnUrl = String(data.productUrl ?? "");
		const ratingEnabled = Boolean(data.productRatingEnabled);
		const starRating = Number(data.productStarRating ?? 5);

		return (
			<div
				className="ghost-card-preview ghost-card-preview-product"
				data-ghost-card-type={cardType}
			>
				<GhostCardHeader
					cardType="product"
					showToggle={true}
					toggleLabel="Inspect payload"
					onToggle={() => setShowJson(true)}
					onDelete={handleDelete}
				/>
				<div className="ghost-card-body">
					<div className="ghost-card-field-row">
						<input
							type="text"
							className="ghost-card-input"
							value={title}
							placeholder="Product title..."
							onChange={e => updateField("productTitle", e.target.value)}
						/>
						<input
							type="url"
							className="ghost-card-input"
							value={imgSrc}
							placeholder="Product image URL..."
							onChange={e => updateField("productImageSrc", e.target.value)}
						/>
					</div>
					<textarea
						className="ghost-card-textarea"
						value={desc}
						rows={2}
						placeholder="Product description..."
						onChange={e => updateField("productDescription", e.target.value)}
					/>
					<div className="ghost-card-field-row">
						<input
							type="text"
							className="ghost-card-input"
							value={btnText}
							placeholder="Button label..."
							onChange={e => updateField("productButton", e.target.value)}
						/>
						<input
							type="url"
							className="ghost-card-input"
							value={btnUrl}
							placeholder="https://store.example.com"
							onChange={e => updateField("productUrl", e.target.value)}
						/>
						<label style={{display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px"}}>
							<input
								type="checkbox"
								checked={ratingEnabled}
								onChange={e => updateField("productRatingEnabled", e.target.checked)}
							/>
							Rating
						</label>
						{ratingEnabled && (
							<select
								className="ghost-card-input"
								value={starRating}
								onChange={e => updateField("productStarRating", Number(e.target.value))}
							>
								<option value={1}>★ 1</option>
								<option value={2}>★★ 2</option>
								<option value={3}>★★★ 3</option>
								<option value={4}>★★★★ 4</option>
								<option value={5}>★★★★★ 5</option>
							</select>
						)}
					</div>
					<div className="ghost-card-product-preview-card">
						{imgSrc && <img src={imgSrc} alt={title} className="ghost-card-product-img" />}
						<div className="ghost-card-product-info">
							<h4>{title || "Product Title"}</h4>
							{ratingEnabled && (
								<div className="ghost-card-stars">{"★".repeat(starRating) + "☆".repeat(5 - starRating)}</div>
							)}
							{desc && <p>{desc}</p>}
							{btnText && <span className="ghost-card-button-pill">{btnText}</span>}
						</div>
					</div>
				</div>
			</div>
		);
	}

	// 10. Header
	if (normalizedType === "header") {
		const header = String(data.header ?? "");
		const subheader = String(data.subheader ?? "");
		const btnText = String(data.buttonText ?? "");
		const btnUrl = String(data.buttonUrl ?? "");

		return (
			<div
				className="ghost-card-preview ghost-card-preview-header"
				data-ghost-card-type={cardType}
			>
				<GhostCardHeader
					cardType="header"
					showToggle={true}
					toggleLabel="Inspect payload"
					onToggle={() => setShowJson(true)}
					onDelete={handleDelete}
				/>
				<div className="ghost-card-body">
					<input
						type="text"
						className="ghost-card-input"
						value={header}
						placeholder="Header text..."
						onChange={e => updateField("header", e.target.value)}
					/>
					<input
						type="text"
						className="ghost-card-input"
						value={subheader}
						placeholder="Subheader text..."
						onChange={e => updateField("subheader", e.target.value)}
					/>
					<div className="ghost-card-field-row">
						<input
							type="text"
							className="ghost-card-input"
							value={btnText}
							placeholder="Button label..."
							onChange={e => updateField("buttonText", e.target.value)}
						/>
						<input
							type="url"
							className="ghost-card-input"
							value={btnUrl}
							placeholder="https://example.com"
							onChange={e => updateField("buttonUrl", e.target.value)}
						/>
					</div>
					<div className="ghost-card-header-hero-preview">
						<h2>{header || "Header text"}</h2>
						{subheader && <p>{subheader}</p>}
						{btnText && <span className="ghost-card-button-pill">{btnText}</span>}
					</div>
				</div>
			</div>
		);
	}

	// 11. Markdown & Codeblock
	if (normalizedType === "markdown" || normalizedType === "codeblock") {
		const isCode = normalizedType === "codeblock";
		const code = String(data.code ?? data.markdown ?? "");
		const language = String(data.language ?? "");

		return (
			<div
				className={`ghost-card-preview ghost-card-preview-${normalizedType}`}
				data-ghost-card-type={cardType}
			>
				<GhostCardHeader
					cardType={isCode ? "codeblock" : "markdown"}
					showToggle={true}
					toggleLabel="Inspect payload"
					onToggle={() => setShowJson(true)}
					onDelete={handleDelete}
				/>
				<div className="ghost-card-body">
					{isCode && (
						<input
							type="text"
							className="ghost-card-input"
							style={{maxWidth: "200px", marginBottom: "6px"}}
							value={language}
							placeholder="Language (e.g. ts, js, python)"
							onChange={e => updateField("language", e.target.value)}
						/>
					)}
					<textarea
						className="ghost-card-textarea"
						style={{fontFamily: "var(--font-mono, monospace)"}}
						value={code}
						rows={5}
						placeholder={isCode ? "// write code here..." : "# write markdown here..."}
						onChange={e => updateField(isCode ? "code" : "markdown", e.target.value)}
					/>
				</div>
			</div>
		);
	}

	// Default fallback: general ghost card with payload inspector
	return (
		<div
			className={`ghost-card-preview ghost-card-preview-${normalizedType}`}
			data-ghost-card-type={cardType}
		>
			<GhostCardHeader
				cardType={cardType}
				showToggle={true}
				toggleLabel="Inspect payload"
				onToggle={() => setShowJson(true)}
				onDelete={handleDelete}
			/>
			<div style={{padding: "0.5rem 0", color: "var(--fg-secondary, #6b7280)", fontSize: "0.85rem"}}>
				Native Ghost card: <strong>{cardType}</strong>. Click &quot;Inspect payload&quot; to view or edit raw data.
			</div>
		</div>
	);
}

export function $createGhostCardNode(
	cardType: string,
	data?: Record<string, unknown>,
): GhostCardNode {
	return new GhostCardNode(cardType, data);
}

export function $isGhostCardNode(
	node: LexicalNode | null | undefined,
): node is GhostCardNode {
	return node instanceof GhostCardNode;
}

const DEFAULT_KNOWN_TYPES = new Set([
	"root",
	"paragraph",
	"text",
	"extended-text",
	"heading",
	"extended-heading",
	"quote",
	"extended-quote",
	"horizontalrule",
	"list",
	"listitem",
	"link",
	"autolink",
	"code",
	"ghost-card",
	"footnote-reference",
]);

/**
 * Traverses a serialized Lexical JSON document and wraps unknown card/decorator
 * nodes into `{ type: "ghost-card", cardType, data, version: 1 }` so standard Lexical
 * can parse and display them without throwing `parseEditorState: type "..." not found`.
 *
 * Also converts Ghost `extended-quote` into standard Lexical `quote`, converts
 * Ghost `extended-text` into standard Lexical `text`, converts Ghost
 * superscript footnote links (`#fn{label}`) into `footnote-reference` nodes,
 * and strips any Ghost footnote HTML cards (extracting their definitions via
 * callback).
 */
export function wrapUnknownGhostCards(
	node: unknown,
	knownTypes = DEFAULT_KNOWN_TYPES,
	options?: {
		onExtractFootnotes?: (definitions: Record<string, string>) => void;
	},
): unknown {
	if (!node || typeof node !== "object") {
		return node;
	}
	if (Array.isArray(node)) {
		const filtered: unknown[] = [];
		for (const item of node) {
			if (isFootnotesHtmlCard(item)) {
				const html = getHtmlFromCard(item);
				if (html && options?.onExtractFootnotes) {
					const defs = extractFootnoteDefinitionsFromHtml(html);
					options.onExtractFootnotes(defs);
				}
				// Drop the footnote HTML card from editor state
				continue;
			}
			// Inline footnote references were saved as HTML cards (so Ghost keeps
			// the `id="fnref..."` back-reference target). Turn them back into
			// editable Lexical block nodes on import.
			if (isFootnoteReferenceHtmlCard(item)) {
				const html = getHtmlFromCard(item);
				if (html) {
					const lexicalNodes = convertFootnoteHtmlCardToLexicalNodes(html);
					if (lexicalNodes.length > 0) {
						filtered.push(...lexicalNodes);
						continue;
					}
				}
			}
			filtered.push(wrapUnknownGhostCards(item, knownTypes, options));
		}
		return filtered;
	}

	const record = node as Record<string, unknown>;

	// Ghost / Koenig text compatibility: standard Lexical has no
	// `extended-text` node type, but Koenig stores all body copy with it.
	// Mapping it to a regular text node lets the content render and export to
	// markdown instead of degrading into an opaque ghost card.
	if (record.type === "extended-text") {
		return {
			...record,
			type: "text",
			text: typeof record.text === "string" ? record.text : "",
		};
	}

	// Ghost / Koenig blockquote compatibility: convert extended-quote to standard quote
	if (record.type === "extended-quote") {
		const convertedQuote: Record<string, unknown> = {
			...record,
			type: "quote",
		};
		if (Array.isArray(convertedQuote.children)) {
			convertedQuote.children = wrapUnknownGhostCards(
				convertedQuote.children,
				knownTypes,
				options,
			) as unknown[];
		}
		return convertedQuote;
	}

	// Ghost / Koenig heading compatibility: convert extended-heading to
	// standard Lexical heading (preserving the heading tag).
	if (record.type === "extended-heading") {
		const convertedHeading: Record<string, unknown> = {
			...record,
			type: "heading",
		};
		if (Array.isArray(convertedHeading.children)) {
			convertedHeading.children = wrapUnknownGhostCards(
				convertedHeading.children,
				knownTypes,
				options,
			) as unknown[];
		}
		return convertedHeading;
	}

	// Ghost link matching #fn...: convert to footnote-reference
	if (
		record.type === "link" &&
		typeof record.url === "string" &&
		record.url.startsWith("#fn") &&
		!record.url.startsWith("#fnref")
	) {
		const label = record.url.slice(3);
		if (label.length > 0) {
			return {
				type: "footnote-reference",
				label,
				version: 1,
			};
		}
	}

	if (record.type === "ghost-card") {
		return record;
	}

	if (
		typeof record.type === "string" &&
		record.type !== "" &&
		!knownTypes.has(record.type)
	) {
		return {
			type: "ghost-card",
			cardType: record.type,
			data: node,
			version: 1,
		};
	}

	const res: Record<string, unknown> = {...record};

	if (record.root && typeof record.root === "object") {
		res.root = wrapUnknownGhostCards(record.root, knownTypes, options);
	}

	if (Array.isArray(record.children)) {
		res.children = wrapUnknownGhostCards(
			record.children,
			knownTypes,
			options,
		) as unknown[];
	}

	return res;
}

function unwrapNodes(node: unknown): unknown {
	if (!node || typeof node !== "object") {
		return node;
	}
	if (Array.isArray(node)) {
		return node.map(unwrapNodes);
	}

	const record = node as Record<string, unknown>;

	// Convert standard Lexical text back to Koenig's `extended-text` node type,
	// which is what Ghost stores and expects when content is saved back.
	if (record.type === "text") {
		return {
			...record,
			type: "extended-text",
		};
	}

	// Convert quote back to extended-quote for full Ghost/Koenig parity
	if (record.type === "quote") {
		const converted: Record<string, unknown> = {
			...record,
			type: "extended-quote",
		};
		if (Array.isArray(converted.children)) {
			converted.children = converted.children.map(unwrapNodes);
		}
		return converted;
	}

	// Convert heading back to extended-heading for full Ghost/Koenig parity
	if (record.type === "heading") {
		const converted: Record<string, unknown> = {
			...record,
			type: "extended-heading",
		};
		if (Array.isArray(converted.children)) {
			converted.children = converted.children.map(unwrapNodes);
		}
		return converted;
	}

	// Convert standard Lexical code node back to Ghost codeblock card
	if (record.type === "code") {
		let codeText = "";
		if (Array.isArray(record.children)) {
			codeText = record.children
				.map((c: any) => (typeof c?.text === "string" ? c.text : ""))
				.join("\n");
		} else if (typeof record.code === "string") {
			codeText = String(record.code);
		}
		return {
			type: "codeblock",
			version: 1,
			code: codeText,
			language: typeof record.language === "string" ? record.language : "",
			caption: typeof record.caption === "string" ? record.caption : "",
		};
	}

	// Convert footnote-reference back to Ghost link node
	if (record.type === "footnote-reference") {
		const label = String(record.label ?? "");
		return {
			type: "link",
			version: 1,
			url: "#fn" + label,
			children: [
				{
					type: "extended-text",
					version: 1,
					text: label,
					format: 64,
				},
			],
		};
	}

	if (record.type === "ghost-card") {
		let unwrappedData: unknown = record;
		if (
			typeof record.data === "object" &&
			record.data !== null &&
			!Array.isArray(record.data)
		) {
			unwrappedData = {...(record.data as Record<string, unknown>)};
		} else if (typeof record.cardType === "string") {
			unwrappedData = {
				type: record.cardType,
				version: 1,
			};
		}
		return unwrapNodes(unwrappedData);
	}

	const res: Record<string, unknown> = {...record};

	if (record.root && typeof record.root === "object") {
		res.root = unwrapNodes(record.root);
	}

	if (Array.isArray(record.children)) {
		res.children = record.children.map(unwrapNodes);
	}

	return res;
}

function attachFootnoteCardIfNeeded(
	doc: unknown,
	definitions?: Record<string, string>,
): unknown {
	if (!doc || typeof doc !== "object") {
		return doc;
	}

	const res = {...(doc as Record<string, unknown>)};
	const target = (
		res.root && typeof res.root === "object" ? res.root : res
	) as Record<string, unknown>;

	if (target.type === "root" && Array.isArray(target.children)) {
		const children = target.children.filter(child => !isFootnotesHtmlCard(child));

		const referencedLabels = findFootnoteReferenceLabels(doc);
		const defs = definitions ?? {};
		const orderedItems: FootnoteItem[] = [];
		const seen = new Set<string>();

		for (const label of referencedLabels) {
			seen.add(label);
			orderedItems.push({
				id: label,
				text: defs[label] ?? "",
			});
		}

		for (const [id, text] of Object.entries(defs)) {
			if (!seen.has(id)) {
				seen.add(id);
				orderedItems.push({id, text});
			}
		}

		if (orderedItems.length > 0) {
			const footnoteCard = compileFootnotesCard(orderedItems);
			if (footnoteCard) {
				children.push(footnoteCard);
			}
		}

		target.children = children;
	}

	return res;
}

/**
 * Traverses a serialized Lexical JSON document and unwraps any `ghost-card`
 * nodes back to their original Ghost payload shape for lossless round-tripping.
 *
 * Also converts `quote` back to `extended-quote`, converts `text` back to
 * `extended-text`, converts `footnote-reference` nodes back to Ghost link
 * nodes, and serializes the bottom Ghost footnote HTML card.
 */
export function unwrapGhostCards(
	node: unknown,
	footnoteDefinitions?: Record<string, string>,
): unknown {
	const unwrapped = unwrapNodes(node);
	const withFootnoteCard = attachFootnoteCardIfNeeded(
		unwrapped,
		footnoteDefinitions,
	);
	return convertFootnotedParagraphsToHtmlCards(withFootnoteCard);
}
