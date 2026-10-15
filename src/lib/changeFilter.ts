/**
 * Decides which `onChange` emissions from the Koenig editor are real edits.
 *
 * Koenig/Lexical emit `onChange` when the editor mounts (state normalisation,
 * nested editors initialising). Treating those as edits would flip the post to
 * "Unsaved" and send a PUT 1.5s later merely because the post was opened.
 *
 * Rules:
 * - Nothing is an edit until the user has interacted with the editor
 *   (`markInteraction`). Emissions before that only refresh the baseline.
 * - After interaction, an emission identical to the last one we saw is a no-op
 *   (e.g. a selection-only update) and is dropped.
 * - Anything else is a real edit. Undoing back to the original content is
 *   still an edit because the baseline moves with every accepted emission.
 */
export function createChangeFilter() {
	let baseline: string | null = null;
	let interacted = false;

	return {
		/** Call from capture-phase input events on the editor surface. */
		markInteraction() {
			interacted = true;
		},

		/** Returns true when `next` (serialised editor state) should be saved. */
		accept(next: string): boolean {
			if (!interacted) {
				baseline = next;
				return false;
			}
			if (next === baseline) {
				return false;
			}
			baseline = next;
			return true;
		},

		/** Start over, e.g. when a different post or server version is bound. */
		reset() {
			baseline = null;
			interacted = false;
		},
	};
}
