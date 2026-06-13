import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  PLATFORM_EULA_LAST_UPDATED,
  PLATFORM_EULA_PRIVACY_URL,
  PLATFORM_EULA_TEXT,
  PLATFORM_EULA_TITLE,
  PLATFORM_EULA_VERSION,
} from "@workspace/platform-eula";

export interface PlatformEulaAcceptanceValue {
  accepted: boolean;
  version: string;
}

interface OnboardingPlatformEulaStepProps {
  value: PlatformEulaAcceptanceValue;
  onChange: (next: PlatformEulaAcceptanceValue) => void;
  disabled?: boolean;
}

export function OnboardingPlatformEulaStep({
  value,
  onChange,
  disabled,
}: OnboardingPlatformEulaStepProps): React.ReactElement {
  return (
    <div className="space-y-4" data-testid="step-platform-eula-body">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{PLATFORM_EULA_TITLE}</h2>
        <p className="text-sm text-gray-500 mt-1">
          Please read and accept the VNDRLY Platform Agreement to continue. Version{" "}
          {PLATFORM_EULA_VERSION} · Last updated {PLATFORM_EULA_LAST_UPDATED}.
        </p>
      </div>
      <ScrollArea
        className="h-64 rounded-md border bg-white p-4 text-sm text-gray-700 whitespace-pre-wrap"
        data-testid="scroll-platform-eula"
      >
        {PLATFORM_EULA_TEXT}
      </ScrollArea>
      <p className="text-xs text-muted-foreground">
        Privacy policy:{" "}
        <a
          href={PLATFORM_EULA_PRIVACY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          {PLATFORM_EULA_PRIVACY_URL}
        </a>
      </p>
      <label className="flex items-start gap-3 cursor-pointer">
        <Checkbox
          checked={value.accepted}
          disabled={disabled}
          onCheckedChange={(c) =>
            onChange({
              accepted: c === true,
              version: PLATFORM_EULA_VERSION,
            })
          }
          data-testid="checkbox-platform-eula"
        />
        <span className="text-sm text-gray-800 leading-snug">
          I have read and agree to the VNDRLY Platform End User License Agreement on
          behalf of my organization.
        </span>
      </label>
      {!value.accepted && (
        <p className="text-xs text-amber-700" data-testid="text-eula-required-hint">
          Acceptance is required before you can use the platform.
        </p>
      )}
    </div>
  );
}

export { PLATFORM_EULA_TITLE, PLATFORM_EULA_TEXT, PLATFORM_EULA_VERSION };
