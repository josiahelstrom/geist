import {describe, expect, it} from "vitest";
import {
	DEFAULT_CARD_PAYLOADS,
	LAB_CARD_CATALOG,
	filterCardMenu,
	type LabCardMenuEntry,
} from "./ghostCardCatalog";

describe("ghostCardCatalog", () => {
	it("defines all major native Ghost card default payloads", () => {
		const expectedCards = [
			"image",
			"codeblock",
			"markdown",
			"video",
			"audio",
			"callout",
			"call-to-action",
			"horizontalrule",
			"html",
			"toggle",
			"button",
			"bookmark",
			"file",
			"header",
			"paywall",
			"product",
			"embed",
			"email",
			"gallery",
			"email-cta",
			"signup",
			"transistor",
		];

		for (const card of expectedCards) {
			expect(DEFAULT_CARD_PAYLOADS[card]).toBeDefined();
			expect(DEFAULT_CARD_PAYLOADS[card].type).toBe(card);
			expect(DEFAULT_CARD_PAYLOADS[card].version).toBeGreaterThanOrEqual(1);
		}
	});

	it("has visibility configurations according to Koenig spec", () => {
		expect(DEFAULT_CARD_PAYLOADS["call-to-action"].visibility).toBeDefined();
		expect(DEFAULT_CARD_PAYLOADS["html"].visibility).toBeDefined();
		expect(DEFAULT_CARD_PAYLOADS["transistor"].visibility).toBeDefined();
		// transistor should default to members-only web visibility
		const transVis = (DEFAULT_CARD_PAYLOADS["transistor"].visibility as any).web;
		expect(transVis.nonMember).toBe(false);

		// standard cards like image, button, toggle should not have visibility
		expect(DEFAULT_CARD_PAYLOADS["image"].visibility).toBeUndefined();
		expect(DEFAULT_CARD_PAYLOADS["button"].visibility).toBeUndefined();
		expect(DEFAULT_CARD_PAYLOADS["toggle"].visibility).toBeUndefined();
	});

	it("catalogs ~20+ primary and embed menu items", () => {
		expect(LAB_CARD_CATALOG.length).toBeGreaterThanOrEqual(22);
		const sections = new Set(LAB_CARD_CATALOG.map(c => c.section));
		expect(sections.has("Primary")).toBe(true);
		expect(sections.has("Embeds")).toBe(true);
	});

	it("filters cards by query prefix and fuzzy match", () => {
		const groups = filterCardMenu("img");
		expect(groups.length).toBeGreaterThan(0);
		expect(groups[0].items[0].cardType).toBe("image");

		const yt = filterCardMenu("yt");
		expect(yt.some(g => g.items.some(i => i.id === "youtube"))).toBe(true);

		const pay = filterCardMenu("pay");
		expect(pay.some(g => g.items.some(i => i.cardType === "paywall"))).toBe(true);

		const tog = filterCardMenu("tog");
		expect(tog.some(g => g.items.some(i => i.cardType === "toggle"))).toBe(true);
	});

	it("respects site settings when filtering (e.g. membersEnabled, postType)", () => {
		const withMembers = filterCardMenu("signup", {membersEnabled: true});
		expect(withMembers.some(g => g.items.some(i => i.cardType === "signup"))).toBe(true);

		const withoutMembers = filterCardMenu("signup", {membersEnabled: false});
		expect(withoutMembers.some(g => g.items.some(i => i.cardType === "signup"))).toBe(false);

		const forPage = filterCardMenu("email", {postType: "page"});
		expect(forPage.some(g => g.items.some(i => i.cardType === "email"))).toBe(false);
	});

	it("dynamic insertParams for signup injects siteTitle and siteDescription", () => {
		const signupEntry = LAB_CARD_CATALOG.find(i => i.id === "signup") as LabCardMenuEntry;
		expect(signupEntry).toBeDefined();
		const params = signupEntry.insertParams?.({
			siteTitle: "My Publication",
			siteDescription: "The best tech blog",
		});
		expect(params?.header).toBe("Sign up for My Publication");
		expect(params?.subheader).toBe("The best tech blog");
	});
});
