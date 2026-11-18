import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ back: vi.fn(), replace: vi.fn(), canGoBack: true }));
vi.mock("expo-router", () => ({ router: {
  back: navigation.back, replace: navigation.replace, canGoBack: () => navigation.canGoBack,
} }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ foreground: "#fff", text: "#fff" }) }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({top:0,bottom:0,left:0,right:0}) }));
vi.mock("@/lib/ios-page-layout", () => ({ iosPageLayout: true }));
vi.mock("@/components/BrandTitleRow", () => ({ default: () => null }));
vi.mock("@/components/AskVVoiceIndicator", () => ({ default: () => null }));
vi.mock("@/components/SphereBackButton", () => ({ default: ({onPress}: {onPress: () => void}) => <button onClick={onPress}>Back</button> }));

import InPageHeader from "./InPageHeader";
import PortalPageHeader from "./PortalPageHeader";
import WorkHubPageTitle from "./WorkHubPageTitle";
import { pageBack } from "@/lib/page-back";

afterEach(() => { cleanup(); vi.clearAllMocks(); navigation.canGoBack = true; });
const headers = [
  ["in-page", () => <InPageHeader title="Previous page test" />],
  ["portal", () => <PortalPageHeader title="Previous page test" testIdPrefix="portal" />],
  ["Work Hub", () => <WorkHubPageTitle title="Previous page test" />],
] as const;

it.each(headers)("%s Back pops the actual previous screen", (_name, header) => {
  render(header());
  fireEvent.click(screen.getByRole("button", {name:"Back"}));
  expect(navigation.back).toHaveBeenCalledOnce();
  expect(navigation.replace).not.toHaveBeenCalled();
});

it.each(headers)("%s Back does not invent a destination on direct entry", (_name, header) => {
  navigation.canGoBack = false;
  render(header());
  fireEvent.click(screen.getByRole("button", {name:"Back"}));
  expect(navigation.back).not.toHaveBeenCalled();
  expect(navigation.replace).not.toHaveBeenCalled();
});

it("the native Back helper stays put when there is no previous screen", () => {
  navigation.canGoBack = false;
  pageBack();
  expect(navigation.replace).not.toHaveBeenCalled();
});

it("an editor's local Back returns from that editor before leaving its page", () => {
  const closeEditor = vi.fn();
  render(<InPageHeader title="Editor" onBack={closeEditor} />);
  fireEvent.click(screen.getByRole("button", {name:"Back"}));
  expect(closeEditor).toHaveBeenCalledOnce();
  expect(navigation.back).not.toHaveBeenCalled();
});
