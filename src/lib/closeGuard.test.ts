import {describe, expect, it, vi} from "vitest";
import {
	canDestroyAfterFlush,
	executeCloseWorkflow,
	shouldBlockUnload,
} from "./closeGuard";

describe("close guard decision logic", () => {
	it("closes immediately when nothing is pending", async () => {
		expect(shouldBlockUnload({hasPending: false})).toBe("close");

		const confirm = vi.fn().mockReturnValue(true);
		const flush = vi.fn().mockResolvedValue(undefined);

		const decision = await executeCloseWorkflow({
			state: {hasPending: false},
			confirm,
			flush,
			afterFlushState: () => ({hasPending: false}),
		});

		expect(decision).toBe("close");
		expect(confirm).not.toHaveBeenCalled();
		expect(flush).not.toHaveBeenCalled();
	});

	it("closes immediately when there is an unresolved conflict (nothing to lose)", async () => {
		expect(shouldBlockUnload({hasPending: true, conflict: true})).toBe(
			"close",
		);

		const confirm = vi.fn().mockReturnValue(true);
		const flush = vi.fn().mockResolvedValue(undefined);

		const decision = await executeCloseWorkflow({
			state: {hasPending: true, conflict: true},
			confirm,
			flush,
			afterFlushState: () => ({hasPending: true, conflict: true}),
		});

		expect(decision).toBe("close");
		expect(confirm).not.toHaveBeenCalled();
		expect(flush).not.toHaveBeenCalled();
	});

	it("does NOT destroy when pending changes exist and user cancels prompt", async () => {
		expect(shouldBlockUnload({hasPending: true})).toBe("prompt");

		const confirm = vi.fn().mockReturnValue(false);
		const flush = vi.fn().mockResolvedValue(undefined);

		const decision = await executeCloseWorkflow({
			state: {hasPending: true},
			confirm,
			flush,
			afterFlushState: () => ({hasPending: false}),
		});

		expect(decision).toBe("stay");
		expect(confirm).toHaveBeenCalledOnce();
		expect(flush).not.toHaveBeenCalled();
	});

	it("destroys when user accepts prompt and flush cleans all pending work", async () => {
		expect(shouldBlockUnload({hasPending: true})).toBe("prompt");
		expect(canDestroyAfterFlush({hasPending: false})).toBe(true);

		const confirm = vi.fn().mockReturnValue(true);
		const flush = vi.fn().mockResolvedValue(undefined);

		const decision = await executeCloseWorkflow({
			state: {hasPending: true},
			confirm,
			flush,
			afterFlushState: () => ({hasPending: false, conflict: false}),
		});

		expect(decision).toBe("destroy");
		expect(confirm).toHaveBeenCalledOnce();
		expect(flush).toHaveBeenCalledOnce();
	});

	it("does NOT destroy when user accepts prompt but flush leaves pending work", async () => {
		expect(canDestroyAfterFlush({hasPending: true})).toBe(false);

		const confirm = vi.fn().mockReturnValue(true);
		const flush = vi.fn().mockResolvedValue(undefined);

		const decision = await executeCloseWorkflow({
			state: {hasPending: true},
			confirm,
			flush,
			afterFlushState: () => ({hasPending: true, conflict: false}),
		});

		expect(decision).toBe("stay");
		expect(confirm).toHaveBeenCalledOnce();
		expect(flush).toHaveBeenCalledOnce();
	});

	it("does NOT destroy when user accepts prompt but flush encounters a conflict", async () => {
		expect(canDestroyAfterFlush({hasPending: false, conflict: true})).toBe(
			false,
		);

		const confirm = vi.fn().mockReturnValue(true);
		const flush = vi.fn().mockResolvedValue(undefined);

		const decision = await executeCloseWorkflow({
			state: {hasPending: true},
			confirm,
			flush,
			afterFlushState: () => ({hasPending: false, conflict: true}),
		});

		expect(decision).toBe("stay");
		expect(confirm).toHaveBeenCalledOnce();
		expect(flush).toHaveBeenCalledOnce();
	});

	it("does NOT destroy when flush rejects with an error (e.g. network/disk failure)", async () => {
		const confirm = vi.fn().mockReturnValue(true);
		const flush = vi.fn().mockRejectedValue(new Error("Disk full"));

		const decision = await executeCloseWorkflow({
			state: {hasPending: true},
			confirm,
			flush,
			afterFlushState: () => ({hasPending: false}),
		});

		expect(decision).toBe("stay");
		expect(confirm).toHaveBeenCalledOnce();
		expect(flush).toHaveBeenCalledOnce();
	});
});
