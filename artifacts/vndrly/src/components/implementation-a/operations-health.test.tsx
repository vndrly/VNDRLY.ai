import { render, screen } from "@testing-library/react"; import { QueryClient, QueryClientProvider } from "@tanstack/react-query"; import { it, expect, vi } from "vitest"; import { OperationsHealth } from "./operations-health";
const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
it("limits operations health to administrators", () => { render(<QueryClientProvider client={new QueryClient()}><OperationsHealth /></QueryClientProvider>); expect(screen.getByText(/limited to company administrators/)).toBeTruthy(); expect(fetcher).not.toHaveBeenCalled(); });
