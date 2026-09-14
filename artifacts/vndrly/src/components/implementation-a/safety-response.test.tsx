import { fireEvent, render, screen } from "@testing-library/react"; import { it, expect, vi } from "vitest"; import { SafetyResponse } from "./safety-response";
vi.mock("@/components/brand-pill-button", () => ({ default: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
it("starts with a stress-aware incident draft", () => { render(<SafetyResponse />); fireEvent.click(screen.getByRole("button", { name: "Report an incident" })); expect(screen.getByText("Ask V will check immediate safety before notifying the configured chain.")).toBeTruthy(); });
