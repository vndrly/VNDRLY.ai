export function trainingExperimentMethod(value: unknown, role: string, production = process.env.NODE_ENV === "production") {
  return typeof value === "string" && ["baseline", "server", "render", "cache"].includes(value) &&
    (!production || role === "admin") ? value : null;
}
