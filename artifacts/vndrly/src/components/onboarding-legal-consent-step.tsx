import { Checkbox } from "@/components/ui/checkbox";
import {
  LEGAL_POLICY_VERSION,
  MESSAGING_DISCLOSURE,
  PRIVACY_POLICY_PATH,
  TERMS_PATH,
} from "@/lib/legal-docs";

export interface OnboardingLegalConsentValue {
  accepted: boolean;
  smsOptIn: boolean;
  version: string;
}

interface OnboardingLegalConsentStepProps {
  value: OnboardingLegalConsentValue;
  onChange: (next: OnboardingLegalConsentValue) => void;
  disabled?: boolean;
}

export function OnboardingLegalConsentStep({
  value,
  onChange,
  disabled,
}: OnboardingLegalConsentStepProps): React.ReactElement {
  const currentAcceptance = value.accepted && value.version === LEGAL_POLICY_VERSION;
  return (
    <div className="space-y-4" data-testid="step-legal-consent-body">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Privacy, terms, and messaging</h2>
        <p className="mt-1 text-sm text-gray-500">
          Review VNDRLY&apos;s Privacy Policy and Terms & Conditions before continuing.
          SMS updates are optional and can be changed later.
        </p>
      </div>

      <div className="rounded-md border border-gray-200 bg-white p-4 text-sm text-gray-700">
        <p className="font-semibold text-gray-900">Legal documents</p>
        <div className="mt-2 flex flex-wrap gap-3">
          <a href={PRIVACY_POLICY_PATH} target="_blank" rel="noopener noreferrer" className="underline">
            Privacy Policy
          </a>
          <a href={TERMS_PATH} target="_blank" rel="noopener noreferrer" className="underline">
            Terms & Conditions
          </a>
        </div>
        <p className="mt-3 text-xs text-gray-500">Policy version {LEGAL_POLICY_VERSION}</p>
      </div>

      <label className="flex cursor-pointer items-start gap-3">
        <Checkbox
          checked={currentAcceptance}
          disabled={disabled}
          onCheckedChange={(c) =>
            onChange({
              ...value,
              accepted: c === true,
              version: LEGAL_POLICY_VERSION,
            })
          }
          data-testid="checkbox-legal-accept"
        />
        <span className="text-sm leading-snug text-gray-800">
          I have read and agree to the VNDRLY Terms & Conditions and acknowledge
          the VNDRLY Privacy Policy on behalf of my organization.
        </span>
      </label>
      {!currentAcceptance && (
        <p className="text-xs text-amber-700" data-testid="text-legal-consent-required-hint">
          Acceptance of the Privacy Policy and Terms & Conditions is required to continue.
        </p>
      )}

      <label className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 bg-gray-50 p-3">
        <Checkbox
          checked={value.smsOptIn}
          disabled={disabled}
          onCheckedChange={(c) =>
            onChange({
              ...value,
              accepted: currentAcceptance,
              smsOptIn: c === true,
              version: LEGAL_POLICY_VERSION,
            })
          }
          data-testid="checkbox-sms-opt-in"
        />
        <span className="text-sm leading-snug text-gray-800">
          I agree to receive transactional and operational text messages from VNDRLY
          at the mobile number I provided. {MESSAGING_DISCLOSURE.rates}{" "}
          {MESSAGING_DISCLOSURE.stop} {MESSAGING_DISCLOSURE.help}{" "}
          {MESSAGING_DISCLOSURE.carriers} Consent is not required to create an
          account or use VNDRLY.
        </span>
      </label>
    </div>
  );
}
