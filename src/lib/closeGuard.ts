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
