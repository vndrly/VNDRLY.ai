import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CameraCenterPage from "./camera-center";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CameraCenterPage siteId={11} />
    </QueryClientProvider>,
  );
}

describe("camera center", () => {
  it("shows offline hardware without exposing upstream addresses", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        gateways: [
          {
            id: "gateway-1",
            name: "Gate office",
            status: "offline",
            devices: [
              {
                id: "device-1",
                name: "Montavue recorder",
                status: "offline",
                manufacturer: "Montavue",
                model: "MNR8208",
                adapter: "montavue-onvif",
                channels: [{ id: "channel-1", name: "Front gate", status: "offline", enabled: true }],
              },
            ],
          },
        ],
      }),
    });
    renderPage();
    expect(await screen.findByText("Front gate")).toBeTruthy();
    expect(screen.getAllByText("Offline").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/rtsp:\/\/|10\.0\.0\./i);
    expect((screen.getByRole("button", { name: "View live" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("requests a short-lived HLS session only after the viewer clicks View live", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          gateways: [
            {
              id: "gateway-1",
              name: "Gate office",
              status: "online",
              devices: [
                {
                  id: "device-1",
                  name: "Main recorder",
                  status: "online",
                  manufacturer: "Montavue",
                  model: "MNR8208",
                  adapter: "montavue-onvif",
                  channels: [{ id: "channel-1", name: "Front gate", status: "online", enabled: true }],
                },
              ],
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          protocol: "hls",
          url: "https://gateway.example.test/session/front.m3u8",
          expiresAt: "2026-09-23T03:00:00.000Z",
        }),
      });
    renderPage();
    const button = await screen.findByRole("button", { name: "View live" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/api/camera-channels/channel-1/playback");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ protocol: "hls" }),
    });
    expect((await screen.findByLabelText("Front gate live video")).getAttribute("src")).toBe(
      "https://gateway.example.test/session/front.m3u8",
    );
  });
});
