import React, { useEffect, useState } from "react";
import GateVoiceNavButton from "@/components/GateVoiceNavButton";
import {
  requestGateVoiceEntry,
  subscribeGateVoiceListening,
} from "@/lib/gate-voice-launch";
import { useGateCopy } from "./GateChrome";
export default function GateVoiceControl() {
  const [active, setActive] = useState(false),
    c = useGateCopy();
  useEffect(() => subscribeGateVoiceListening(setActive), []);
  return (
    <GateVoiceNavButton
      active={active}
      label={
        active
          ? c("Stop Gate voice", "Detener voz de acceso")
          : c("Gate voice", "Voz de acceso")
      }
      onPress={requestGateVoiceEntry}
    />
  );
}
