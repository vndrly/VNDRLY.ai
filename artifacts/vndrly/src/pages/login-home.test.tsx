import en from "@/lib/locales/en.json";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Login from "./login";
import { DEFAULT_BRAND } from "@/hooks/use-brand";

const brandState = vi.hoisted(() => ({ brand: null as Record<string, unknown> | null }));
vi.mock("@/hooks/use-brand", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-brand")>();
  return { ...actual, useBrand: () => brandState.brand ?? actual.DEFAULT_BRAND };
});

const authState = vi.hoisted(() => ({ user: null as any, navigate: vi.fn(), location: "/login" }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: authState.user, login: vi.fn() }) }));
vi.mock("wouter", () => ({ useLocation: () => [authState.location, authState.navigate] }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key === "login.learnMoreVndrly" ? en.login.learnMoreVndrly : key, i18n: { language: "en" } }) }));
vi.mock("@/components/language-toggle", () => ({ default: () => <span>EN / ES</span> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); brandState.brand = null; authState.user = null; authState.navigate.mockClear(); });

it("replaces the login theme switch with a branded link directly to the commercial homepage", () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
  window.history.replaceState({}, "", "/login");
  render(<Login />);
  const home = screen.getByRole("link", { name: "Learn more about VNDRLY.ai" });
  expect(home.getAttribute("href")).toBe("/");
  expect(home.querySelector("img")).toBeTruthy();
  expect(home.querySelector('[data-testid="sphere-back-circle"]')).toBeTruthy();
  expect(screen.queryByTestId("dark-light-toggle")).toBeNull();
  expect(screen.getByLabelText("login.passwordLabel")).toBeTruthy();
});

it("keeps company identity on the login form while the home link retains VNDRLY identity", () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
  brandState.brand = { ...DEFAULT_BRAND, name: "Example Company", primary: "#3260cd", logoSquareUrl: "/company-logo.png", isOrgBranded: true };
  render(<Login />);
  expect(screen.getByRole("heading", { name: "Example Company" })).toBeTruthy();
  expect(screen.getByTestId("img-login-partner-logo").getAttribute("src")).toBe("/company-logo.png");
  const home = screen.getByTestId("login-home-link");
  expect(home.style.getPropertyValue("--brand-primary")).toBe(DEFAULT_BRAND.primary);
  const password = screen.getByTestId("input-password");
  fireEvent.change(password, { target: { value: "test-password" } });
  fireEvent.click(screen.getByTestId("button-toggle-password-visibility"));
  expect(password.getAttribute("type")).toBe("text");
  expect((password as HTMLInputElement).value).toBe("test-password");
  fireEvent.click(screen.getByTestId("button-toggle-password-visibility"));
  expect(password.getAttribute("type")).toBe("password");
});

it("allows explicit account switching without redirecting the signed-in account", () => {
  authState.user = { role: "partner" };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
  render(<Login allowAccountSwitch />);
  expect(screen.getByLabelText("login.passwordLabel")).toBeTruthy();
  expect(authState.navigate).not.toHaveBeenCalled();
});

it("retains the normal signed-in login redirect", () => {
  authState.user = { role: "partner" };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
  render(<Login />);
  expect(authState.navigate).toHaveBeenCalledWith("/", { replace: true });
});
