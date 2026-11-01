export type UnloadDecision = "close" | "prompt";

export type CloseState = {
	hasPending: boolean;
	conflict?: boolean;
};

/**
 * Determines whether closing the editor window should proceed immediately
 * or block to prompt the user to save unsaved changes.
 */
export function shouldBlockUnload(state: CloseState): UnloadDecision {
	if (!state.hasPending || state.conflict) {
		return "close";
	}
	return "prompt";
}

/**
 * Determines whether the window may be destroyed after an attempted flush.
 * Returns true only if the flush succeeded with no pending work and no conflict.
 */
export function canDestroyAfterFlush(result: CloseState): boolean {
	return !result.hasPending && !result.conflict;
}

export type CloseWorkflowDecision = "close" | "stay" | "destroy";

/**
 * Coordinates the full close-confirmation workflow:
 * - nothing pending -> close immediately
 * - pending + user cancels -> do NOT destroy ("stay")
 * - pending + user accepts + flush clean -> destroy
 * - pending + flush failed/still pending -> do NOT destroy ("stay")
 */
export async function executeCloseWorkflow(options: {
	state: CloseState;
	confirm: () => boolean | Promise<boolean>;
	flush: () => Promise<void>;
	afterFlushState: () => CloseState;
}): Promise<CloseWorkflowDecision> {
	if (shouldBlockUnload(options.state) === "close") {
		return "close";
	}
	const userConfirmed = await options.confirm();
	if (!userConfirmed) {
		return "stay";
	}
	try {
		await options.flush();
		if (canDestroyAfterFlush(options.afterFlushState())) {
			return "destroy";
		}
		return "stay";
	} catch {
		return "stay";
	}
}
