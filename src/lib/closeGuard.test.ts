import {describe, expect, it} from "vitest";
import {canDestroyAfterFlush, shouldBlockUnload} from "./closeGuard";

describe("close guard decision logic", () => {
	it("closes immediately when nothing is pending", () => {
		expect(shouldBlockUnload({hasPending: false})).toBe("close");
	});

	it("closes immediately when there is an unresolved conflict (nothing to lose)", () => {
		expect(shouldBlockUnload({hasPending: true, conflict: true})).toBe(
			"close",
		);
	});

	it("prompts when pending changes exist without a conflict", () => {
		expect(shouldBlockUnload({hasPending: true})).toBe("prompt");
		expect(shouldBlockUnload({hasPending: true, conflict: false})).toBe(
			"prompt",
		);
	});

	it("allows destroy after flush only when nothing is pending and there is no conflict", () => {
		expect(canDestroyAfterFlush({hasPending: false})).toBe(true);
		expect(canDestroyAfterFlush({hasPending: false, conflict: false})).toBe(
			true,
		);
		expect(canDestroyAfterFlush({hasPending: true})).toBe(false);
		expect(canDestroyAfterFlush({hasPending: false, conflict: true})).toBe(
			false,
		);
	});
});
