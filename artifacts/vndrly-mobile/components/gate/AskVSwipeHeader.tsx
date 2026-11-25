import React, { useMemo } from "react";
import { PanResponder, View, type ViewProps } from "react-native";
import { useAskVVoiceSession } from "@/hooks/use-askv-voice-session";

/** Swipe down on the header to engage; swipe up to disengage the shared session. */
export default function AskVSwipeHeader(props: ViewProps) {
  const voice = useAskVVoiceSession();
  const gesture = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, state) => Math.abs(state.dy) > 24 && Math.abs(state.dy) > Math.abs(state.dx) * 1.5,
    onPanResponderRelease: (_, state) => {
      if (Math.abs(state.dy) < 36 || Math.abs(state.dy) <= Math.abs(state.dx) * 1.5) return;
      if (state.dy < 0) {
        voice.setMuted(true);
        return;
      }
      voice.setMuted(false);
      void voice.startConversation(undefined, undefined, { gateFocus: true });
    },
  }), [voice.setMuted, voice.startConversation]);
  return <View {...props} {...gesture.panHandlers} testID="askv-swipe-header" />;
}
