import {Component, type ReactNode} from "react";

type Props = {
	children: ReactNode;
	fallback: (message: string) => ReactNode;
	onCatch?: (message: string) => void;
};

type State = {message: string | null};

/**
 * Koenig throws when a post contains a Lexical node it does not know (a card
 * from a newer Ghost, say). Without a boundary that blanks the whole app.
 * Render the fallback instead; the editor never mounts, so nothing can be
 * autosaved over the post's body.
 */
export default class EditorErrorBoundary extends Component<Props, State> {
	state: State = {message: null};

	static getDerivedStateFromError(error: unknown): State {
		return {message: error instanceof Error ? error.message : String(error)};
	}

	componentDidCatch(error: unknown) {
		console.error("Editor failed to render this post", error);
		this.props.onCatch?.(
			error instanceof Error ? error.message : String(error),
		);
	}

	render() {
		if (this.state.message !== null) {
			return this.props.fallback(this.state.message);
		}
		return this.props.children;
	}
}
