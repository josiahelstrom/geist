// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach, describe, expect, it, vi} from "vitest";
import type {NewsletterSummary, Site} from "../lib/api";
import PublishModal from "./PublishModal";

afterEach(cleanup);

const SITE: Site = {
	base: "https://example.com",
	siteUrl: "https://example.com/",
	title: "Test Publication",
	version: "6.68",
	keyKind: "staff",
	role: "Owner",
	clockOffset: 0,
};

const NEWSLETTERS: NewsletterSummary[] = [
	{
		id: "nl-1",
		name: "Weekly Digest",
		slug: "weekly-digest",
		status: "active",
		count: {active_members: 1420},
	},
	{
		id: "nl-2",
		name: "Special Alerts",
		slug: "special-alerts",
		status: "active",
		count: {active_members: 350},
	},
];

describe("PublishModal", () => {
	it("disables publish button until the newsletter recipient checkbox is checked", async () => {
		const user = userEvent.setup();
		const onExecute = vi.fn().mockResolvedValue(undefined);

		render(
			<PublishModal
				site={SITE}
				postTitle="Gated Release"
				postStatus="draft"
				newsletters={NEWSLETTERS}
				membersEnabled={true}
				busy={false}
				onExecute={onExecute}
				onClose={vi.fn()}
			/>,
		);

		// Default is Web only, which can publish immediately.
		const initialSubmit = screen.getByRole("button", {name: "Publish now"});
		expect(initialSubmit).toBeEnabled();

		// Switch to Web + Email.
		const webAndEmailRadio = screen.getByRole("radio", {
			name: "Web + Email",
		});
		await user.click(webAndEmailRadio);

		const emailSubmit = screen.getByRole("button", {
			name: "Publish and send email",
		});
		expect(emailSubmit).toBeDisabled();

		// Check the recipient confirmation checkbox.
		const confirmCheckbox = screen.getByRole("checkbox", {
			name: /I confirm sending this email to subscribers of/i,
		});
		expect(confirmCheckbox).not.toBeChecked();

		await user.click(confirmCheckbox);
		expect(confirmCheckbox).toBeChecked();
		expect(emailSubmit).toBeEnabled();

		// Unchecking disables the submit button again.
		await user.click(confirmCheckbox);
		expect(confirmCheckbox).not.toBeChecked();
		expect(emailSubmit).toBeDisabled();

		// Re-checking and submitting invokes onExecute.
		await user.click(confirmCheckbox);
		expect(emailSubmit).toBeEnabled();
		await user.click(emailSubmit);

		expect(onExecute).toHaveBeenCalledWith({
			kind: "publish-email",
			newsletterSlug: "weekly-digest",
			emailSegment: "all",
			emailOnly: false,
			confirmedRecipientCount: 1420,
		});
	});

	it("includes the recipient count in the confirmation checkbox's accessible name", async () => {
		const user = userEvent.setup();

		render(
			<PublishModal
				site={SITE}
				postTitle="Recipient Count Verification"
				postStatus="draft"
				newsletters={NEWSLETTERS}
				membersEnabled={true}
				busy={false}
				onExecute={vi.fn()}
				onClose={vi.fn()}
			/>,
		);

		await user.click(screen.getByRole("radio", {name: "Web + Email"}));

		// Weekly Digest has 1,420 members
		const weeklyCheckbox = screen.getByRole("checkbox", {
			name: "I confirm sending this email to subscribers of Weekly Digest (1,420 active members).",
		});
		expect(weeklyCheckbox).toBeInTheDocument();

		// Switch newsletter to Special Alerts (350 members)
		const newsletterSelect = screen.getByLabelText("Newsletter");
		await user.selectOptions(newsletterSelect, "special-alerts");

		const alertsCheckbox = screen.getByRole("checkbox", {
			name: "I confirm sending this email to subscribers of Special Alerts (350 active members).",
		});
		expect(alertsCheckbox).toBeInTheDocument();
	});

	it("blocks email-only scheduled publishing without a valid future datetime", async () => {
		const user = userEvent.setup();
		const onExecute = vi.fn().mockResolvedValue(undefined);

		render(
			<PublishModal
				site={SITE}
				postTitle="Scheduled Letter"
				postStatus="draft"
				newsletters={NEWSLETTERS}
				membersEnabled={true}
				busy={false}
				onExecute={onExecute}
				onClose={vi.fn()}
			/>,
		);

		// Switch delivery to Email only
		await user.click(screen.getByRole("radio", {name: "Email only"}));

		// Switch timing to Schedule
		await user.click(screen.getByRole("radio", {name: "Schedule"}));

		const scheduleInput = screen.getByLabelText("Publish date and time");
		expect(scheduleInput).toBeInTheDocument();

		// Check the recipient confirmation checkbox
		const confirmCheckbox = screen.getByRole("checkbox", {
			name: /active members/i,
		});
		await user.click(confirmCheckbox);

		const submitButton = screen.getByRole("button", {
			name: "Schedule and send email",
		});

		// By default it starts with a future time (+1h), so button is enabled
		expect(submitButton).toBeEnabled();

		// Set datetime to the past -> publishing is blocked
		fireEvent.change(scheduleInput, {
			target: {value: "2020-01-01T12:00"},
		});

		expect(
			screen.getByText("Choose a time in the future."),
		).toBeInTheDocument();
		expect(submitButton).toBeDisabled();

		// Set datetime to an invalid string -> publishing is blocked
		fireEvent.change(scheduleInput, {target: {value: ""}});
		expect(submitButton).toBeDisabled();

		// Set datetime to a valid future time -> publishing is unblocked
		fireEvent.change(scheduleInput, {
			target: {value: "2099-06-15T10:00"},
		});

		expect(
			screen.queryByText("Choose a time in the future."),
		).not.toBeInTheDocument();
		expect(submitButton).toBeEnabled();

		await user.click(submitButton);

		expect(onExecute).toHaveBeenCalledWith({
			kind: "schedule",
			publishedAt: new Date("2099-06-15T10:00").toISOString(),
			newsletterSlug: "weekly-digest",
			emailSegment: "all",
			emailOnly: true,
		});
	});

	it("closes on Escape and returns focus to the triggering element", async () => {
		const user = userEvent.setup();
		const onClose = vi.fn();

		const triggerButton = document.createElement("button");
		triggerButton.textContent = "Open Publish Dialog";
		document.body.appendChild(triggerButton);
		triggerButton.focus();
		expect(document.activeElement).toBe(triggerButton);

		const {unmount} = render(
			<PublishModal
				site={SITE}
				postTitle="Trigger Focus Test"
				postStatus="draft"
				newsletters={NEWSLETTERS}
				membersEnabled={true}
				busy={false}
				onExecute={vi.fn()}
				onClose={onClose}
			/>,
		);

		// Modal opens and initial focus is trapped inside
		expect(document.activeElement).not.toBe(triggerButton);

		await user.keyboard("{Escape}");
		expect(onClose).toHaveBeenCalledOnce();

		unmount();
		expect(document.activeElement).toBe(triggerButton);
		document.body.removeChild(triggerButton);
	});

	it("does not close on Escape when busy", async () => {
		const user = userEvent.setup();
		const onClose = vi.fn();

		render(
			<PublishModal
				site={SITE}
				postTitle="Busy Test"
				postStatus="draft"
				newsletters={NEWSLETTERS}
				membersEnabled={true}
				busy={true}
				onExecute={vi.fn()}
				onClose={onClose}
			/>,
		);

		await user.keyboard("{Escape}");
		expect(onClose).not.toHaveBeenCalled();
	});

	it("traps focus: Tab from the last control wraps to the first, and Shift+Tab wraps back", () => {
		render(
			<PublishModal
				site={SITE}
				postTitle="Focus Trap Test"
				postStatus="draft"
				newsletters={NEWSLETTERS}
				membersEnabled={true}
				busy={false}
				onExecute={vi.fn()}
				onClose={vi.fn()}
			/>,
		);

		const firstControl = screen.getByRole("button", {
			name: "Close publish dialog",
		});
		const lastControl = screen.getByRole("button", {name: "Publish now"});

		// On mount, the first focusable control receives focus
		expect(firstControl).toHaveFocus();

		// Shift+Tab from first control wraps to the last control
		fireEvent.keyDown(document, {key: "Tab", shiftKey: true});
		expect(lastControl).toHaveFocus();

		// Tab from last control wraps back to the first control
		fireEvent.keyDown(document, {key: "Tab", shiftKey: false});
		expect(firstControl).toHaveFocus();
	});
});
