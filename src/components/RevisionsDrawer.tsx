import {useState} from "react";
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
		<aside className="meta-sidebar revisions-drawer" data-testid="revisions-drawer">
			<div className="meta-sidebar-header">
				<h2>Post history</h2>
				<button
					type="button"
					className="icon-button"
					onClick={onClose}
					title="Close post history"
				>
					✕
				</button>
			</div>

			{revisions.length === 0 ? (
				<p className="revisions-empty">
					No saved revisions yet. Press Cmd+S to record a revision.
				</p>
			) : (
				<>
					<ul className="revisions-list">
						{sorted.map(revision => {
							const isSelected = selected?.id === revision.id;
							return (
								<li key={revision.id}>
									<button
										type="button"
										className={
											isSelected
												? "revision-item selected"
												: "revision-item"
										}
										onClick={() => setSelectedId(revision.id)}
										aria-pressed={isSelected}
									>
										<span className="revision-time">
											{new Date(revision.created_at).toLocaleString()}
										</span>
										<span className="revision-reason">
											{formatRevisionReason(revision.reason)}
										</span>
										<span className="revision-title">{revision.title}</span>
										{revision.author?.name ? (
											<span className="revision-author">
												{revision.author.name}
											</span>
										) : null}
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
							<h3 className="revision-preview-title">{selected.title}</h3>
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
								className="primary-button"
								onClick={handleRestore}
								disabled={readOnly}
								data-testid="restore-revision-button"
							>
								Restore this version
							</button>
						</section>
					) : null}
				</>
			)}
		</aside>
	);
}
