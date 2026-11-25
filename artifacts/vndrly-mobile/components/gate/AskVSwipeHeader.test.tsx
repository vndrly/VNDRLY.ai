import React from "react";
import { render, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ gesture: null as any, setMuted: vi.fn(), startConversation: vi.fn() }));
vi.mock("react-native", () => ({ View: ({children, testID}: any) => <div data-testid={testID}>{children}</div>, PanResponder: { create: (handlers:any) => { mock.gesture=handlers; return {panHandlers:{}}; } } }));
vi.mock("@/hooks/use-askv-voice-session", () => ({ useAskVVoiceSession: () => mock }));
import AskVSwipeHeader from "./AskVSwipeHeader";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("re-engages the shared voice session on a deliberate downward header swipe", () => {
 render(<AskVSwipeHeader />);
 expect(mock.gesture.onMoveShouldSetPanResponder(null,{dx:3,dy:40})).toBe(true);
 mock.gesture.onPanResponderRelease(null,{dx:3,dy:40});
 expect(mock.setMuted).toHaveBeenCalledExactlyOnceWith(false);
 expect(mock.startConversation).toHaveBeenCalledOnce();
 expect(mock.startConversation).toHaveBeenCalledWith(undefined, undefined, { gateFocus: true });
});
it("disengages the shared voice session on a deliberate upward header swipe", () => {
 render(<AskVSwipeHeader />);
 expect(mock.gesture.onMoveShouldSetPanResponder(null,{dx:3,dy:-40})).toBe(true);
 mock.gesture.onPanResponderRelease(null,{dx:3,dy:-40});
 expect(mock.setMuted).toHaveBeenCalledExactlyOnceWith(true);
 expect(mock.startConversation).not.toHaveBeenCalled();
});
it("does not change engagement for taps or horizontal gestures", () => {
 render(<AskVSwipeHeader />);
 for(const state of [{dx:0,dy:4},{dx:0,dy:-4},{dx:60,dy:40},{dx:60,dy:-40}]) {
  expect(mock.gesture.onMoveShouldSetPanResponder(null,state)).toBe(false);
  mock.gesture.onPanResponderRelease(null,state);
 }
 expect(mock.startConversation).not.toHaveBeenCalled();
 expect(mock.setMuted).not.toHaveBeenCalled();
});
it("ignores short vertical drags even after claiming the gesture", () => {
 render(<AskVSwipeHeader />);
 for(const dy of [30,-30]) {
  expect(mock.gesture.onMoveShouldSetPanResponder(null,{dx:0,dy})).toBe(true);
  mock.gesture.onPanResponderRelease(null,{dx:0,dy});
 }
 expect(mock.setMuted).not.toHaveBeenCalled();
 expect(mock.startConversation).not.toHaveBeenCalled();
});
