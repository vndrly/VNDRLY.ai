import { TogglePillButton } from "@/components/toggle-pill";
import { useState } from "react";
import { useLocation } from "wouter";
import vndrlyLogo from "@assets/512_Vndrly_Logo_2_1777147855089.png";
import AmberButton from "@/components/amber-button";
import BlueButton from "@/components/blue-button";
import LanguageToggle from "@/components/language-toggle";
import DarkLightToggle, { type ThemeMode } from "@/components/dark-light-toggle";
import { cn } from "@/lib/utils";
import backIcon from "@assets/Amber-back-button-logo-tuned.png";

export default function Signup() {
  const [, navigate] = useLocation();
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const isDark = themeMode === "dark";

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      <div className="flex-1 flex items-center justify-center px-6 py-12 lg:px-16 relative" style={{ backgroundColor: isDark ? "#3a3d42" : "#ffffff" }}>
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/8 to-transparent pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/8 to-transparent pointer-events-none" />
        <div className="absolute top-4 right-4 z-20">
          <LanguageToggle variant="light" />
        </div>
        <div className="absolute top-4 left-4 z-20">
          <DarkLightToggle mode={themeMode} onChange={setThemeMode} variant="light" />
        </div>
        <div className="w-full max-w-md relative z-10">
          <div className="flex flex-col items-start mb-10">
            <img src={vndrlyLogo} alt="VNDRLY Logo" className="w-20 h-20 rounded-xl mb-4" draggable={false} />
            <div className="flex items-center gap-3">
              <img src={backIcon} alt="Back" className="w-10 h-10 cursor-pointer hover:opacity-80 transition-opacity" draggable={false} onClick={() => navigate("/")} data-testid="button-back" />
              <h1 className={cn("text-3xl font-bold tracking-tight", isDark ? "text-white" : "text-gray-900")}>Get Started with VNDRLY</h1>
            </div>
            <p className={cn("text-sm mt-2", isDark ? "text-gray-300" : "text-gray-500")}>Choose your account type to begin onboarding.</p>
          </div>

          <div className="space-y-4">
            <div className="border-2 border-amber-500 rounded-xl p-6 hover:bg-amber-50/50 transition-colors cursor-pointer" onClick={() => navigate("/signup/vendor")}>
              <h2 className="text-lg font-bold text-gray-900 mb-1">Sign Up as a Vendor</h2>
              <p className="text-sm text-gray-500">You provide field services and assign employees to job sites.</p>
              <div className="mt-4">
                <TogglePillButton color="amber" className="w-full h-11">Begin Vendor Onboarding</TogglePillButton>
              </div>
            </div>

            <div className="border-2 border-blue-500 rounded-xl p-6 hover:bg-blue-50/50 transition-colors cursor-pointer" onClick={() => navigate("/signup/partner")}>
              <h2 className="text-lg font-bold text-gray-900 mb-1">Sign Up as a Partner</h2>
              <p className="text-sm text-gray-500">You own or manage drilling sites and oversee vendor operations.</p>
              <div className="mt-4">
                <TogglePillButton color="blue" className="w-full h-11">Begin Partner Onboarding</TogglePillButton>
              </div>
            </div>
          </div>

          <div className={cn("mt-6 pt-4 border-t", isDark ? "border-white/20" : "border-gray-200")}>
            <p className={cn("text-sm text-center", isDark ? "text-gray-300" : "text-gray-500")}>
              Already have an account?{" "}
              <a href="/" className="font-semibold text-amber-600 hover:text-amber-700 underline underline-offset-2" onClick={(e) => { e.preventDefault(); navigate("/"); }}>
                Sign In
              </a>
            </p>
          </div>
        </div>
      </div>

      <div className="hidden lg:block w-[3px] bg-amber-500 shrink-0" />

      <div className="hidden lg:flex flex-1 relative overflow-hidden">
        <img
          src="/vndrly-background.jpg"
          alt="Oil field operations"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-gray-900/80 via-gray-900/30 to-transparent" />
        <div className="relative z-10 flex items-end justify-center p-12 w-full h-full">
          <div className="bg-white/10 backdrop-blur-md rounded-xl p-8 max-w-md border-2 border-amber-500">
            <h2 className="text-xl font-bold text-white mb-2">Field Management Elevated</h2>
            <p className="text-sm text-white/85 leading-relaxed">
              VNDRLY bridges the gap between Partners, Vendors, and Field Employees with real-time GPS tracking and seamless work order management.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
