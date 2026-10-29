import {useEffect, useMemo, useRef, useState} from "react";
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

const FOCUSABLE_SELECTOR =
	'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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

	const sheetRef = useRef<HTMLDivElement | null>(null);
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;
	const busyRef = useRef(busy);
	busyRef.current = busy;

	// Trap focus inside the sheet while it is open, close on Esc, and return
	// focus to the Publish trigger when the sheet unmounts (§4.6).
	useEffect(() => {
		const previous = document.activeElement as HTMLElement | null;
		const sheet = sheetRef.current;
		sheet?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();

		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				event.preventDefault();
				if (!busyRef.current) {
					onCloseRef.current();
				}
				return;
			}
			if (event.key !== "Tab" || !sheet) {
				return;
			}
			const focusable = Array.from(
				sheet.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
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

		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("keydown", handleKeyDown);
			previous?.focus?.();
		};
	}, []);

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

	const recipientCount = selectedNewsletter?.count?.active_members ?? 0;
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
			className="sheet-backdrop"
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
			<div className="publish-sheet" ref={sheetRef}>
				<header className="sheet-header">
					<div className="sheet-heading">
						<h2 className="sheet-title">
							Publish “{postTitle || "Untitled"}”
						</h2>
						<p className="sheet-subtitle">
							{site.title} · {postStatus}
						</p>
					</div>
					<button
						type="button"
						className="sheet-close"
						onClick={onClose}
						title="Close publish dialog"
						aria-label="Close publish dialog"
						data-testid="close-publish-modal"
					>
						✕
					</button>
				</header>

				<form className="sheet-form" onSubmit={handleSubmit}>
					<div className="sheet-body">
						{postStatus === "scheduled" && scheduledAt && (
							<p className="sheet-note" data-testid="current-schedule">
								Currently scheduled for{" "}
								{new Date(scheduledAt).toLocaleString()}. Choose
								“Schedule for later” to change the time, or use the
								Unschedule button in the editor header.
							</p>
						)}

						<fieldset className="sheet-section">
							<legend className="sheet-legend">Delivery</legend>

							<div
								className="segmented"
								role="radiogroup"
								aria-label="Delivery"
							>
								<label className="segment">
									<input
										type="radio"
										name="publish-delivery"
										value="web"
										checked={delivery === "web"}
										onChange={() =>
											handleDeliveryChange("web")
										}
										data-testid="delivery-web"
									/>
									<span className="segment-label">Web only</span>
								</label>

								<label className="segment">
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
									/>
									<span className="segment-label">
										Web + Email
									</span>
								</label>

								<label className="segment">
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
									/>
									<span className="segment-label">
										Email only
									</span>
								</label>
							</div>

							{!canEmail && (
								<p className="sheet-hint">
									Email delivery is unavailable: this site has
									no active newsletters or members are disabled.
								</p>
							)}
						</fieldset>

						<fieldset className="sheet-section">
							<legend className="sheet-legend">Timing</legend>

							<div
								className="segmented"
								role="radiogroup"
								aria-label="Timing"
							>
								<label className="segment">
									<input
										type="radio"
										name="publish-timing"
										value="now"
										checked={timing === "now"}
										onChange={() => setTiming("now")}
										data-testid="timing-now"
									/>
									<span className="segment-label">Now</span>
								</label>

								<label className="segment">
									<input
										type="radio"
										name="publish-timing"
										value="schedule"
										checked={timing === "schedule"}
										onChange={() => setTiming("schedule")}
										data-testid="timing-schedule"
									/>
									<span className="segment-label">
										Schedule
									</span>
								</label>
							</div>

							{timing === "schedule" && (
								<div className="sheet-field schedule-field">
									<label
										className="sheet-label"
										htmlFor="publish-schedule-at"
									>
										Publish date and time
									</label>
									<input
										id="publish-schedule-at"
										className="sheet-input"
										type="datetime-local"
										value={scheduleAt}
										onChange={e =>
											setScheduleAt(e.target.value)
										}
										data-testid="schedule-datetime-input"
									/>
									{!scheduleValid && (
										<p className="sheet-error" role="alert">
											Choose a time in the future.
										</p>
									)}
								</div>
							)}
						</fieldset>

						{needsConfirmation && (
							<fieldset className="sheet-section">
								<legend className="sheet-legend">Newsletter</legend>

								<div className="sheet-field">
									<label
										className="sheet-label"
										htmlFor="publish-newsletter-select"
									>
										Newsletter
									</label>
									<select
										id="publish-newsletter-select"
										className="sheet-select"
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
								</div>

								<div className="sheet-field">
									<label
										className="sheet-label"
										htmlFor="publish-email-segment-select"
									>
										Recipients
									</label>
									<select
										id="publish-email-segment-select"
										className="sheet-select"
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
								</div>

								{selectedNewsletter ? (
									<>
										<div
											className="warn-banner sheet-warn"
											data-testid="newsletter-summary"
										>
											<div className="sheet-warn-copy">
												<strong>
													{selectedNewsletter.name}
												</strong>
												<div data-testid="recipient-count">
													Sending to{" "}
													{recipientCount.toLocaleString()}{" "}
													active subscribers
												</div>
												<div data-testid="recipient-segment">
													{segmentLabel}
												</div>
											</div>
											<span className="sheet-warn-note">
												This email cannot be unsent.
											</span>
										</div>

										<label className="confirm-send sheet-confirm">
											<input
												type="checkbox"
												checked={confirmed}
												onChange={e =>
													setConfirmed(e.target.checked)
												}
												data-testid="confirm-newsletter-send"
											/>
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
									<p className="sheet-hint">
										No newsletter is available for this site.
									</p>
								)}
							</fieldset>
						)}
					</div>

					<footer className="sheet-actions">
						<button
							type="button"
							className="sheet-action is-secondary"
							onClick={onClose}
							disabled={busy}
						>
							Cancel
						</button>
						<button
							type="submit"
							className={
								needsConfirmation
									? "sheet-action is-primary is-email"
									: "sheet-action is-primary"
							}
							disabled={submitDisabled}
							data-testid="publish-submit"
						>
							{busy ? "Working…" : submitLabel}
						</button>
					</footer>
				</form>
			</div>
		</div>
	);
}
