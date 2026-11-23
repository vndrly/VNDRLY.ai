import React from "react";
import { Image } from "react-native";
import { SvgXml } from "react-native-svg";
import { providerSvg } from "../../assets/images/providers/logos";
export type Provider = "teams" | "outlook" | "gmail" | "slack";
export default function ProviderLogo({ provider, size = 24 }: { provider: Provider | "google-calendar"; size?: number }) {
  return provider === "slack" ? <Image source={require("../../assets/images/providers/slack.png")} style={{ width: size, height: size }} resizeMode="contain" /> : <SvgXml xml={providerSvg[provider]} width={size} height={size} />;
}
