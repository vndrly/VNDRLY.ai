import React, { Component, type ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";

export type FleetModuleState = "ready" | "loading" | "empty" | "warning" | "unavailable";
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
  onRetry?: () => void;
  onReview?: () => void;
  children?: ReactNode;
};

class RenderBoundary extends Component<{
  children: ReactNode;
  fallback: (error: Error) => ReactNode;
  onRetry?: () => void;
}, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(previous: Readonly<{ children: ReactNode; fallback: (error: Error) => ReactNode; onRetry?: () => void }>) {
    if (previous.children !== this.props.children && this.state.error) this.setState({ error: null });
  }
  render() { return this.state.error ? this.props.fallback(this.state.error) : this.props.children; }
}

export default function FleetModuleBoundary({ module, title, state = "ready", error, onRetry, onReview, children }: FleetModuleBoundaryProps) {
  const colors = useColors();
  const copy = useFleetCopy();
  const label = title ?? module.charAt(0).toUpperCase() + module.slice(1).replaceAll("-", " ");
  const conflict = state === "unavailable" && error?.status === 409;
  const card = { backgroundColor: colors.card, borderColor: conflict ? colors.primary : colors.border, borderWidth: 1, borderRadius: 14, padding: 16, gap: 10 } as const;
  const body = { color: colors.mutedForeground } as const;
  const recovery = (renderError?: Error) => <View style={card} accessibilityRole="alert">
    <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700" }}>
      {`${copy(label)} ${copy(conflict ? "changed" : "is unavailable")}`}
    </Text>
    <Text style={body}>{copy(conflict ? "Load the current record before continuing." : "This module could not load. Other Fleet work remains available.")}</Text>
    {conflict && <Text style={body}>{copy(error?.recovery?.retainedWork === "retained" ? "Your saved work was retained." : error?.recovery?.retainedWork === "not_retained" ? "Your work was not retained. Review before reapplying." : "Check whether your work was retained.")}</Text>}
    {renderError && <Text style={body}>{copy("This module could not display.")}</Text>}
    {conflict && onReview && <TogglePillButton color="blue" onPress={onReview} accessibilityLabel={`${copy("Review current")} ${copy(label)}`}>{`${copy("Review current")} ${copy(label)}`}</TogglePillButton>}
    {onRetry && <TogglePillButton color="blue" onPress={onRetry} accessibilityLabel={`${copy("Retry")} ${copy(label)}`}>{`${copy("Retry")} ${copy(label)}`}</TogglePillButton>}
  </View>;

  return <View testID={`fleet-module-${module}`}>
    {state === "loading" ? <View style={card}><ActivityIndicator color={colors.primary} /><Text style={body}>{`${copy("Loading")} ${copy(label)}`}</Text></View>
      : state === "empty" ? <View style={card}><Text style={body}>{`${copy("No")} ${copy(label)} ${copy("items yet")}`}</Text></View>
      : state === "unavailable" ? recovery()
      : <>
        {state === "warning" && <View style={card}><Text style={{ color: colors.text, fontWeight: "700" }}>{`${copy(label)} ${copy("needs attention")}`}</Text><Text style={body}>{copy("Review this module's current information before acting.")}</Text></View>}
        <RenderBoundary fallback={recovery} onRetry={onRetry}>{children}</RenderBoundary>
      </>}
  </View>;
}
