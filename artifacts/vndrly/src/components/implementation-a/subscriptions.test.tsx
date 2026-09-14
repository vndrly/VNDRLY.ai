import { render, screen } from "@testing-library/react"; import { QueryClient, QueryClientProvider } from "@tanstack/react-query"; import { it, expect, vi } from "vitest"; import { Subscriptions } from "./subscriptions";
const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
it("keeps billing details out of a non-admin preview", () => { render(<QueryClientProvider client={new QueryClient()}><Subscriptions /></QueryClientProvider>); expect(screen.getByText(/Billing details/)).toBeTruthy(); expect(fetcher).not.toHaveBeenCalled(); });
