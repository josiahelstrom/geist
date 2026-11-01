import {useEffect, useRef, useState} from "react";
import type {PostRevision} from "../lib/api";
import {
	extractLexicalPlainText,
	formatRevisionReason,
	sortRevisionsNewestFirst,
} from "../lib/revisions";

type Props = {
	revisions: PostRevision[];
	readOnly?: boolean;
	onRestore: (revision: PostRevision) => void;
	onClose: () => void;
};

type RevisionBadge = {
	label: string;
	tone: "save" | "autosave" | "published" | "neutral";
};

/** Map a Ghost revision reason to the short badge shown in the history list. */
function revisionBadge(reason?: string): RevisionBadge {
	switch (reason) {
		case "explicit_save":
			return {label: "Cmd+S", tone: "save"};
		case "background_save":
			return {label: "Autosave", tone: "autosave"};
		case "published":
			return {label: "Published", tone: "published"};
		case "unpublished":
			return {label: "Unpublished", tone: "neutral"};
		case "initial_revision":
			return {label: "Initial", tone: "neutral"};
		default:
			return {label: formatRevisionReason(reason), tone: "neutral"};
	}
}

function formatTimestamp(value: string): string {
	const date = new Date(value);
	if (!Number.isFinite(date.getTime())) {
		return value;
	}
	return date.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

const FOCUSABLE_SELECTOR =
	'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function RevisionsDrawer({
	revisions,
	readOnly = false,
	onRestore,
	onClose,
}: Props) {
	const sorted = sortRevisionsNewestFirst(revisions);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selected =
		sorted.find(revision => revision.id === selectedId) ?? sorted[0] ?? null;

	const drawerRef = useRef<HTMLElement | null>(null);
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	useEffect(() => {
		const trigger = document.activeElement as HTMLElement | null;
		const drawer = drawerRef.current;
		drawer?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();

		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				event.preventDefault();
				onCloseRef.current();
				return;
			}
			if (event.key !== "Tab" || !drawer) {
				return;
			}
			const focusable = Array.from(
				drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
			).filter(
				el =>
					!el.hidden &&
					el.style.display !== "none" &&
					el.getAttribute("aria-hidden") !== "true",
			);
			if (focusable.length === 0) {
				return;
			}
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			const active = document.activeElement;
			if (event.shiftKey && active === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && active === last) {
				event.preventDefault();
				first.focus();
			}
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
			if (trigger && document.contains(trigger)) {
				trigger.focus();
			}
		};
	}, []);

	function handleRestore() {
		if (!selected || readOnly) {
			return;
		}
		const confirmed = window.confirm(
			"Restore this version? The current title and content will be replaced.",
		);
		if (confirmed) {
			onRestore(selected);
		}
	}

	return (
		<aside
			ref={drawerRef}
			className="inspector revisions-drawer"
			data-testid="revisions-drawer"
			role="dialog"
			aria-modal="true"
			aria-labelledby="revisions-drawer-title"
		>
			<header className="inspector-header">
				<h2 id="revisions-drawer-title" className="inspector-title">Post history</h2>
				<button
					type="button"
					className="inspector-close"
					onClick={onClose}
					title="Close post history"
					aria-label="Close post history"
				>
					✕
				</button>
			</header>

			<div className="inspector-scroll">
				{revisions.length === 0 ? (
					<p className="revisions-empty">
						No saved revisions yet. Press Cmd+S to record a revision.
					</p>
				) : (
					<>
						<ul className="revisions-list">
							{sorted.map(revision => {
								const isSelected = selected?.id === revision.id;
								const badge = revisionBadge(revision.reason);
								return (
									<li key={revision.id}>
										<button
											type="button"
											className={
												isSelected
													? "revision-row is-selected"
													: "revision-row"
											}
											onClick={() =>
												setSelectedId(revision.id)
											}
											aria-pressed={isSelected}
										>
											<span className="revision-row-main">
												<span className="revision-title">
													{revision.title || "Untitled"}
												</span>
												<span className="revision-meta">
													<span className="revision-time">
														{formatTimestamp(
															revision.created_at,
														)}
													</span>
													{revision.author?.name ? (
														<span className="revision-author">
															{revision.author.name}
														</span>
													) : null}
												</span>
											</span>
											<span
												className={`revision-badge is-${badge.tone}`}
											>
												{badge.label}
											</span>
										</button>
									</li>
								);
							})}
						</ul>

						{selected ? (
							<section
								className="revision-preview"
								data-testid="revision-preview"
							>
								<header className="revision-preview-header">
									<span className="revision-preview-eyebrow">
										Preview
									</span>
									<h3 className="revision-preview-title">
										{selected.title || "Untitled"}
									</h3>
								</header>
								{selected.custom_excerpt ? (
									<p className="revision-preview-excerpt">
										{selected.custom_excerpt}
									</p>
								) : null}
								<p className="revision-preview-body">
									{extractLexicalPlainText(selected.lexical)}
								</p>
								<button
									type="button"
									className="inspector-primary-button revision-restore-button"
									onClick={handleRestore}
									disabled={readOnly}
									data-testid="restore-revision-button"
								>
									Restore this version
								</button>
								{readOnly ? (
									<p className="inspector-hint">
										Read-only mode: restoring is unavailable.
									</p>
								) : null}
							</section>
						) : null}
					</>
				)}
			</div>
		</aside>
	);
}
