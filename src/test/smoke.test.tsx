// @vitest-environment jsdom
import {render, screen} from "@testing-library/react";
import {describe, expect, it} from "vitest";

describe("testing infrastructure smoke test", () => {
	it("renders a button into jsdom and asserts it is in the document", () => {
		render(<button type="button">Click me</button>);
		const button = screen.getByRole("button", {name: "Click me"});
		expect(button).toBeInTheDocument();
	});
});
