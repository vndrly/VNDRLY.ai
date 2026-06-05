import { act, fireEvent, screen, waitFor } from "@testing-library/react";

/** Pressable / LayeredPillButton disabled checks under jsdom + RN-web. */
export function isElementDisabled(el: unknown): boolean {
  if (!el || typeof el !== "object") return false;
  const node = el as {
    getAttribute?: (name: string) => string | null;
    disabled?: boolean;
    props?: { disabled?: boolean; accessibilityState?: { disabled?: boolean } };
  };
  if (node.getAttribute?.("aria-disabled") === "true") return true;
  if (node.disabled === true) return true;
  if (node.props?.disabled === true) return true;
  if (node.props?.accessibilityState?.disabled === true) return true;
  return false;
}

/** RN-web tap shim for DOM buttons and Pressables in jsdom. */
export function tap(el: HTMLElement): void {
  if (el.tagName === "BUTTON") {
    el.click();
    return;
  }
  fireEvent.pointerDown(el);
  fireEvent.pointerUp(el);
  fireEvent.click(el);
}

/** En-route and check-out open the mileage modal before POSTing. */
export async function tapThroughMileagePrompt(testId: string): Promise<void> {
  const actionBtn = screen.getAllByTestId(testId)[0];
  await act(async () => {
    actionBtn.click();
  });
  const skipBtn = await screen.findByTestId("button-mileage-skip");
  await act(async () => {
    skipBtn.click();
  });
}
