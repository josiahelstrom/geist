import {useMemo, useState} from "react";
import type {EmailSegment, NewsletterSummary, Site} from "../lib/api";

export type PublishDelivery = "web" | "web-and-email" | "email-only";
export type PublishTiming = "now" | "schedule";

export type PublishAction =
	| {kind: "publish-web"}
	| {
			kind: "publish-email";
			newsletterSlug: string;
			emailSegment: EmailSegment;
			emailOnly: boolean;
			confirmedRecipientCount: number;
	  }
	| {
			kind: "schedule";
			publishedAt: string;
			newsletterSlug?: string;
			emailSegment?: EmailSegment;
			emailOnly?: boolean;
	  };

type Props = {
	site: Site;
	postTitle: string;
	postStatus: string;
	scheduledAt?: string | null;
	newsletters: NewsletterSummary[];
	membersEnabled: boolean;
	busy: boolean;
	onExecute: (action: PublishAction) => Promise<void>;
	onClose: () => void;
};

const SEGMENT_LABELS: Record<EmailSegment, string> = {
	all: "All subscribers",
	"status:free": "Free members only",
	"status:-free": "Paid members only",
};

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

/** Local `YYYY-MM-DDTHH:mm` for a date. */
function formatLocalDateTime(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
		date.getDate(),
	)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Local `YYYY-MM-DDTHH:mm` for a time one hour from now. */
function defaultScheduleValue(): string {
	return formatLocalDateTime(new Date(Date.now() + 60 * 60 * 1000));
}

/** Reuse an existing future schedule when rescheduling, else an hour from now. */
function initialScheduleValue(scheduledAt?: string | null): string {
	if (scheduledAt) {
		const date = new Date(scheduledAt);
		if (Number.isFinite(date.getTime()) && date.getTime() > Date.now()) {
			return formatLocalDateTime(date);
		}
	}
	return defaultScheduleValue();
}

export default function PublishModal({
	site,
	postTitle,
	postStatus,
	scheduledAt,
	newsletters,
	membersEnabled,
	busy,
	onExecute,
	onClose,
}: Props) {
	// Safety rule 4.2: web-only is always the default, so publishing can never
	// email subscribers unless the user explicitly opts in below.
	const [delivery, setDelivery] = useState<PublishDelivery>("web");
	const [timing, setTiming] = useState<PublishTiming>(
		postStatus === "scheduled" ? "schedule" : "now",
	);
	const [newsletterSlug, setNewsletterSlug] = useState(
		newsletters[0]?.slug ?? "",
	);
	const [emailSegment, setEmailSegment] = useState<EmailSegment>("all");
	const [confirmed, setConfirmed] = useState(false);
	const [scheduleAt, setScheduleAt] = useState(() =>
		initialScheduleValue(scheduledAt),
	);

	const canEmail = membersEnabled && newsletters.length > 0;
	const needsConfirmation = delivery !== "web";

	const activeNewsletterSlug = useMemo(() => {
		const current = newsletters.find(n => n.slug === newsletterSlug);
		return current?.slug ?? newsletters[0]?.slug ?? "";
	}, [newsletters, newsletterSlug]);

	const selectedNewsletter = useMemo(
		() =>
			newsletters.find(n => n.slug === activeNewsletterSlug) ??
			newsletters[0],
		[newsletters, activeNewsletterSlug],
	);

	const recipientCount =
		selectedNewsletter?.count?.active_members ?? 0;
	const segmentLabel = SEGMENT_LABELS[emailSegment];

	const scheduleMs = timing === "schedule" ? Date.parse(scheduleAt) : NaN;
	const scheduleValid =
		timing !== "schedule" ||
		(Number.isFinite(scheduleMs) && scheduleMs > Date.now());

	const submitDisabled =
		busy ||
		!scheduleValid ||
		(needsConfirmation &&
			(!confirmed || activeNewsletterSlug.length === 0));

	function handleDeliveryChange(next: PublishDelivery) {
		setDelivery(next);
		setConfirmed(false);
	}

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (submitDisabled) {
			return;
		}

		if (timing === "schedule") {
			const publishedAt = new Date(scheduleMs).toISOString();
			if (needsConfirmation) {
				await onExecute({
					kind: "schedule",
					publishedAt,
					newsletterSlug: activeNewsletterSlug,
					emailSegment,
					emailOnly: delivery === "email-only",
				});
			} else {
				await onExecute({kind: "schedule", publishedAt});
			}
			return;
		}

		if (delivery === "web") {
			await onExecute({kind: "publish-web"});
			return;
		}

		await onExecute({
			kind: "publish-email",
			newsletterSlug: activeNewsletterSlug,
			emailSegment,
			emailOnly: delivery === "email-only",
			confirmedRecipientCount: recipientCount,
		});
	}

	const submitLabel =
		timing === "schedule"
			? needsConfirmation
				? "Schedule and send email"
				: "Schedule post"
			: needsConfirmation
				? delivery === "email-only"
					? "Send email only"
					: "Publish and send email"
				: "Publish now";

	return (
		<div
			className="modal-backdrop"
			role="dialog"
			aria-modal="true"
			aria-label={`Publish ${postTitle || "untitled post"}`}
			data-testid="publish-modal"
			onMouseDown={e => {
				if (e.target === e.currentTarget) {
					onClose();
				}
			}}
		>
			<div className="modal-card">
				<header className="modal-header">
					<div>
						<h2>Publish “{postTitle || "Untitled"}”</h2>
						<p className="muted small">
							{site.title} · {postStatus}
						</p>
					</div>
					<button
						type="button"
						className="icon-button"
						onClick={onClose}
						title="Close publish dialog"
						data-testid="close-publish-modal"
					>
						✕
					</button>
				</header>

				{postStatus === "scheduled" && scheduledAt && (
					<p className="muted small" data-testid="current-schedule">
						Currently scheduled for{" "}
						{new Date(scheduledAt).toLocaleString()}. Choose “Schedule
						for later” to change the time, or use the Unschedule button
						in the editor header.
					</p>
				)}

				<form onSubmit={handleSubmit}>
					<fieldset className="publish-section">
						<legend>Delivery</legend>

						<label>
							<input
								type="radio"
								name="publish-delivery"
								value="web"
								checked={delivery === "web"}
								onChange={() => handleDeliveryChange("web")}
								data-testid="delivery-web"
							/>{" "}
							Publish on web only — no email sent
						</label>

						<label>
							<input
								type="radio"
								name="publish-delivery"
								value="web-and-email"
								checked={delivery === "web-and-email"}
								disabled={!canEmail}
								onChange={() =>
									handleDeliveryChange("web-and-email")
								}
								data-testid="delivery-web-and-email"
							/>{" "}
							Publish on web and send email
						</label>

						<label>
							<input
								type="radio"
								name="publish-delivery"
								value="email-only"
								checked={delivery === "email-only"}
								disabled={!canEmail}
								onChange={() =>
									handleDeliveryChange("email-only")
								}
								data-testid="delivery-email-only"
							/>{" "}
							Send email only
						</label>

						{!canEmail && (
							<p className="muted small">
								Email delivery is unavailable: this site has no
								active newsletters or members are disabled.
							</p>
						)}
					</fieldset>

					<fieldset className="publish-section">
						<legend>Timing</legend>

						<label>
							<input
								type="radio"
								name="publish-timing"
								value="now"
								checked={timing === "now"}
								onChange={() => setTiming("now")}
								data-testid="timing-now"
							/>{" "}
							Right now
						</label>

						<label>
							<input
								type="radio"
								name="publish-timing"
								value="schedule"
								checked={timing === "schedule"}
								onChange={() => setTiming("schedule")}
								data-testid="timing-schedule"
							/>{" "}
							Schedule for later
						</label>

						{timing === "schedule" && (
							<div className="schedule-field">
								<label htmlFor="publish-schedule-at">
									Publish date and time
								</label>
								<input
									id="publish-schedule-at"
									type="datetime-local"
									value={scheduleAt}
									onChange={e => setScheduleAt(e.target.value)}
									data-testid="schedule-datetime-input"
								/>
								{!scheduleValid && (
									<p className="error" role="alert">
										Choose a time in the future.
									</p>
								)}
							</div>
						)}
					</fieldset>

					{needsConfirmation && (
						<fieldset className="publish-section">
							<legend>Newsletter</legend>

							<label htmlFor="publish-newsletter-select">
								Newsletter
							</label>
							<select
								id="publish-newsletter-select"
								data-testid="newsletter-select"
								value={activeNewsletterSlug}
								onChange={e => {
									setNewsletterSlug(e.target.value);
									setConfirmed(false);
								}}
							>
								{newsletters.map(newsletter => (
									<option
										key={newsletter.id}
										value={newsletter.slug}
									>
										{newsletter.name}
									</option>
								))}
							</select>

							<label htmlFor="publish-email-segment-select">
								Recipients
							</label>
							<select
								id="publish-email-segment-select"
								data-testid="email-segment-select"
								value={emailSegment}
								onChange={e => {
									setEmailSegment(
										e.target.value as EmailSegment,
									);
									setConfirmed(false);
								}}
							>
								<option value="all">All subscribers</option>
								<option value="status:free">
									Free members only
								</option>
								<option value="status:-free">
									Paid members only
								</option>
							</select>

							{selectedNewsletter ? (
								<>
									<div
										className="warn-banner"
										data-testid="newsletter-summary"
									>
										<div>
											<strong>
												{selectedNewsletter.name}
											</strong>
											<div data-testid="recipient-count">
												Up to{" "}
												{recipientCount.toLocaleString()}{" "}
												active subscribers
											</div>
											<div data-testid="recipient-segment">
												{segmentLabel}
											</div>
										</div>
										<span>
											This email cannot be unsent.
										</span>
									</div>

									<label className="confirm-send">
										<input
											type="checkbox"
											checked={confirmed}
											onChange={e =>
												setConfirmed(e.target.checked)
											}
											data-testid="confirm-newsletter-send"
										/>{" "}
										<span>
											I confirm sending this email to
											subscribers of{" "}
											{selectedNewsletter.name} (
											{recipientCount.toLocaleString()}{" "}
											active members).
										</span>
									</label>
								</>
							) : (
								<p className="muted small">
									No newsletter is available for this site.
								</p>
							)}
						</fieldset>
					)}

					<div className="modal-actions">
						<button type="button" onClick={onClose} disabled={busy}>
							Cancel
						</button>
						<button
							type="submit"
							className="primary-button"
							disabled={submitDisabled}
							data-testid="publish-submit"
						>
							{busy ? "Working…" : submitLabel}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
