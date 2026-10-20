import React, { Component, type ReactNode } from "react";
import { Feather } from "@expo/vector-icons";
import { ActivityIndicator, Text, View } from "react-native";

import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";

export type FleetModuleState = "ready" | "loading" | "empty" | "warning" | "unavailable";
const WARNING_TONE = "#f59e0b";
export type FleetModuleError = {
  code?: string;
  status?: number;
  recovery?: { reloadCanonical?: boolean; retainedWork?: "unknown" | "retained" | "not_retained" };
};

export type FleetModuleBoundaryProps = {
  module: string;
  title?: string;
  state?: FleetModuleState;
  error?: FleetModuleError | null;
  onRetry?: () => void | Promise<void>;
  onReview?: () => void;
  children?: ReactNode;
};

class RenderBoundary extends Component<{
  children: ReactNode;
  fallback: (error: Error, retry: () => void) => ReactNode;
  onRetry?: () => void | Promise<void>;
}, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(previous: Readonly<{ children: ReactNode; fallback: (error: Error, retry: () => void) => ReactNode; onRetry?: () => void | Promise<void> }>) {
    if (previous.children !== this.props.children && this.state.error) this.setState({ error: null });
  }
  private retry = () => {
    // Keep the failed module isolated until its owner has finished refreshing.
    Promise.resolve().then(() => this.props.onRetry?.()).then(() => this.setState({ error: null }), () => undefined);
  };
  render() { return this.state.error ? this.props.fallback(this.state.error, this.retry) : this.props.children; }
}

export default function FleetModuleBoundary({ module, title, state = "ready", error, onRetry, onReview, children }: FleetModuleBoundaryProps) {
  const colors = useColors();
  const copy = useFleetCopy();
  const label = title ?? module.charAt(0).toUpperCase() + module.slice(1).replaceAll("-", " ");
  const conflict = state === "unavailable" && error?.status === 409;
  const card = { backgroundColor: colors.card, borderColor: colors.primary, borderWidth: 2, borderRadius: 16, padding: 16, gap: 10 } as const;
  const body = { color: colors.mutedForeground } as const;
  const heading = (icon: React.ComponentProps<typeof Feather>["name"], text: string, tone = colors.primary) => <View style={{ alignItems: "center", flexDirection: "row", gap: 10 }}>
    <View style={{ alignItems: "center", backgroundColor: `${tone}22`, borderRadius: 12, height: 40, justifyContent: "center", width: 40 }}><Feather name={icon} size={21} color={tone} /></View>
    <Text style={{ color: colors.text, flex: 1, fontSize: 19, fontWeight: "700" }}>{text}</Text>
  </View>;
  const recovery = (renderError?: Error, retry?: () => void) => <View testID={`fleet-module-card-${module}`} style={card} accessibilityRole="alert">
    {heading("alert-circle", `${copy(label)} ${copy(conflict ? "changed" : "is unavailable")}`, colors.destructive)}
    <Text style={body}>{copy(conflict ? "Load the current record before continuing." : "This module could not load. Other Fleet work remains available.")}</Text>
    {conflict && <Text style={body}>{copy(error?.recovery?.retainedWork === "retained" ? "Your saved work was retained." : error?.recovery?.retainedWork === "not_retained" ? "Your work was not retained. Review before reapplying." : "Check whether your work was retained.")}</Text>}
    {renderError && <Text style={body}>{copy("This module could not display.")}</Text>}
    {conflict && onReview && <TogglePillButton color="blue" onPress={onReview} accessibilityLabel={`${copy("Review current")} ${copy(label)}`}>{`${copy("Review current")} ${copy(label)}`}</TogglePillButton>}
    {(onRetry || retry) && <TogglePillButton color="blue" onPress={retry ?? onRetry} accessibilityLabel={`${copy("Retry")} ${copy(label)}`}>{`${copy("Retry")} ${copy(label)}`}</TogglePillButton>}
  </View>;

  return <View testID={`fleet-module-${module}`}>
    {state === "loading" ? <View testID={`fleet-module-card-${module}`} style={card}>{heading("clock", `${copy("Loading")} ${copy(label)}`)}<ActivityIndicator color={colors.primary} /></View>
      : state === "empty" ? <View testID={`fleet-module-card-${module}`} style={card}>{heading("inbox", `${copy("No")} ${copy(label)} ${copy("items yet")}`)}</View>
      : state === "unavailable" ? recovery()
      : <>
        {state === "warning" && <View testID={`fleet-module-card-${module}`} style={card}>{heading("alert-triangle", `${copy(label)} ${copy("needs attention")}`, WARNING_TONE)}<Text style={body}>{copy("Review this module's current information before acting.")}</Text></View>}
        <RenderBoundary fallback={recovery} onRetry={onRetry}>{children}</RenderBoundary>
      </>}
  </View>;
}
