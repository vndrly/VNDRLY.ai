import { useLocation } from "wouter";
import { VNDRLY_LOGO_SQUARE as vndrlyLogo } from "@/lib/vndrly-brand-assets";
import DarkLightToggle, { type ThemeMode } from "@/components/dark-light-toggle";
import LanguageToggle from "@/components/language-toggle";
import { cn } from "@/lib/utils";
import { useState } from "react";
import {
  PLATFORM_EULA_LAST_UPDATED,
  PLATFORM_EULA_PRIVACY_URL,
  PLATFORM_EULA_TEXT,
  PLATFORM_EULA_TITLE,
} from "@workspace/platform-eula";

export default function PlatformEulaPage() {
  const [, navigate] = useLocation();
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const isDark = themeMode === "dark";

  return (
    <div
      className="min-h-screen flex flex-col px-6 py-12 lg:px-16 relative"
      style={{ backgroundColor: isDark ? "#3a3d42" : "#f9fafb" }}
    >
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
        <DarkLightToggle mode={themeMode} onChange={setThemeMode} variant="light" />
        <LanguageToggle variant="light" />
      </div>
      <div className="w-full max-w-3xl mx-auto relative z-10">
        <div className="flex items-center gap-3 mb-6">
          <img
            src={vndrlyLogo}
            alt="VNDRLY Logo"
            className="w-12 h-12 rounded-lg shrink-0"
            draggable={false}
          />
          <div>
            <h1
              className={cn(
                "text-2xl font-bold tracking-tight",
                isDark ? "text-white" : "text-gray-900",
              )}
            >
              {PLATFORM_EULA_TITLE}
            </h1>
            <p
              className={cn(
                "text-sm mt-1",
                isDark ? "text-gray-300" : "text-gray-500",
              )}
            >
              Last updated {PLATFORM_EULA_LAST_UPDATED}
            </p>
          </div>
        </div>

        <div
          className={cn(
            "rounded-xl border p-6 shadow-sm",
            isDark
              ? "border-white/15 bg-white/5 text-gray-100"
              : "border-gray-200 bg-white text-gray-800",
          )}
        >
          <pre
            className="whitespace-pre-wrap text-sm leading-relaxed font-sans"
            data-testid="text-platform-eula-body"
          >
            {PLATFORM_EULA_TEXT}
          </pre>
        </div>

        <p
          className={cn(
            "text-xs mt-4",
            isDark ? "text-gray-400" : "text-gray-500",
          )}
        >
          Privacy Policy:{" "}
          <a
            href={PLATFORM_EULA_PRIVACY_URL}
            className="underline underline-offset-2 text-amber-600 hover:text-amber-700"
          >
            {PLATFORM_EULA_PRIVACY_URL}
          </a>
        </p>

        <div className={cn("mt-8 pt-4 border-t", isDark ? "border-white/20" : "border-gray-200")}>
          <button
            type="button"
            className={cn(
              "text-sm font-semibold underline underline-offset-2",
              isDark ? "text-amber-400 hover:text-amber-300" : "text-amber-600 hover:text-amber-700",
            )}
            onClick={() => navigate("/")}
            data-testid="link-eula-back-sign-in"
          >
            Back to sign in
          </button>
        </div>
      </div>
    </div>
  );
}
