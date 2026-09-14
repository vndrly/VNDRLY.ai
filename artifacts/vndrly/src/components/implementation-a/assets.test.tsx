import { render, screen } from "@testing-library/react"; import { QueryClient, QueryClientProvider } from "@tanstack/react-query"; import { it, expect, vi } from "vitest"; import { Assets } from "./assets";
vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ assets: [{ id: "a1", name: "Radio kit", category: "communications", status: "available" }] }), { status: 200 })));
it("renders custody inventory", async () => { render(<QueryClientProvider client={new QueryClient()}><Assets /></QueryClientProvider>); expect(await screen.findByText("Radio kit")).toBeTruthy(); });
