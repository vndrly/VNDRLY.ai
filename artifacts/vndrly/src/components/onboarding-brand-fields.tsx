import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles } from "lucide-react";
import { extractLogoColorsFromFile } from "@/lib/extract-logo-colors";
import { getContrastWarning, getColorPairWarning } from "@/lib/brand-color";

export interface VendorBrandingValues {
  brandPrimaryColor: string;
  logoUrl: string;
}

export interface PartnerBrandingValues {
  brandPrimaryColor: string;
  brandAccentColor: string;
  logoUrl: string;
  logoSquareUrl: string;
}

interface BaseProps {
  disabled?: boolean;
  onUploadLogo: (
    file: File,
    slot: "horizontal" | "square",
  ) => Promise<void>;
  onSuggestColors: (colors: { primary: string; accent: string }) => void;
}

interface VendorBrandFieldsProps extends BaseProps {
  variant: "vendor";
  value: VendorBrandingValues;
  onChange: (next: VendorBrandingValues) => void;
}

interface PartnerBrandFieldsProps extends BaseProps {
  variant: "partner";
  value: PartnerBrandingValues;
  onChange: (next: PartnerBrandingValues) => void;
}

export type OnboardingBrandFieldsProps =
  | VendorBrandFieldsProps
  | PartnerBrandFieldsProps;

export function OnboardingBrandFields(
  props: OnboardingBrandFieldsProps,
): React.ReactElement {
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState(false);

  const handleFile = async (
    file: File,
    slot: "horizontal" | "square",
  ): Promise<void> => {
    setSuggesting(true);
    try {
      await props.onUploadLogo(file, slot);
      const colors = await extractLogoColorsFromFile(file);
      props.onSuggestColors(colors);
      setSuggested(true);
    } finally {
      setSuggesting(false);
    }
  };

  const primary = props.value.brandPrimaryColor;
  const accent =
    props.variant === "partner" ? props.value.brandAccentColor : "";

  return (
    <div className="space-y-4">
      {props.variant === "partner" ? (
        <>
          <div>
            <Label>Horizontal logo</Label>
            <p className="text-xs text-gray-500 mb-1">
              Used in the sidebar and ticket headers.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="file"
                accept="image/*"
                disabled={props.disabled || suggesting}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f, "horizontal");
                }}
                data-testid="input-logo"
                className="text-sm"
              />
              {props.value.logoUrl && (
                <img
                  src={props.value.logoUrl}
                  alt="logo preview"
                  className="h-12 max-w-[160px] object-contain border rounded"
                />
              )}
            </div>
          </div>
          <div>
            <Label>Square logo</Label>
            <p className="text-xs text-gray-500 mb-1">
              Used in 64×64 badges and the visitor portal poster.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="file"
                accept="image/*"
                disabled={props.disabled || suggesting}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f, "square");
                }}
                data-testid="input-logo-square"
                className="text-sm"
              />
              {props.value.logoSquareUrl && (
                <img
                  src={props.value.logoSquareUrl}
                  alt="square logo preview"
                  className="h-12 w-12 object-contain border rounded"
                />
              )}
            </div>
          </div>
        </>
      ) : (
        <div>
          <Label>Company logo</Label>
          <p className="text-xs text-gray-500 mb-1">
            Upload your logo — we&apos;ll suggest brand colors and update the
            header preview.
          </p>
          <div className="flex items-center gap-3">
            <input
              type="file"
              accept="image/*"
              disabled={props.disabled || suggesting}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f, "square");
              }}
              data-testid="input-vendor-logo"
              className="text-sm"
            />
            {props.value.logoUrl && (
              <img
                src={props.value.logoUrl}
                alt="logo preview"
                className="h-12 w-12 object-contain border rounded"
              />
            )}
          </div>
        </div>
      )}

      {suggesting && (
        <p className="text-xs text-muted-foreground" data-testid="text-color-suggesting">
          Uploading and reading colors from your logo…
        </p>
      )}
      {suggested && !suggesting && (
        <p
          className="text-xs text-[color:var(--brand-primary)] flex items-center gap-1.5"
          data-testid="text-colors-suggested"
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          Suggested colors from your logo — adjust below if needed.
        </p>
      )}

      <div className={props.variant === "partner" ? "grid grid-cols-2 gap-3" : ""}>
        <div>
          <Label>Primary color</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={primary || "#e6ac00"}
              disabled={props.disabled}
              onChange={(e) => {
                if (props.variant === "partner") {
                  props.onChange({
                    ...props.value,
                    brandPrimaryColor: e.target.value,
                  });
                } else {
                  props.onChange({
                    ...props.value,
                    brandPrimaryColor: e.target.value,
                  });
                }
              }}
              className="h-10 w-12 rounded border cursor-pointer"
              data-testid="input-brand-primary-picker"
            />
            <Input
              value={primary}
              disabled={props.disabled}
              onChange={(e) => {
                if (props.variant === "partner") {
                  props.onChange({
                    ...props.value,
                    brandPrimaryColor: e.target.value,
                  });
                } else {
                  props.onChange({
                    ...props.value,
                    brandPrimaryColor: e.target.value,
                  });
                }
              }}
              placeholder="#e6ac00"
              data-testid="input-brand-primary"
            />
          </div>
          {primary && getContrastWarning(primary) && (
            <p className="mt-1 text-xs text-amber-600">{getContrastWarning(primary)}</p>
          )}
        </div>
        {props.variant === "partner" && (
          <div>
            <Label>Accent color</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={accent || "#616161"}
                disabled={props.disabled}
                onChange={(e) =>
                  props.onChange({
                    ...props.value,
                    brandAccentColor: e.target.value,
                  })
                }
                className="h-10 w-12 rounded border cursor-pointer"
                data-testid="input-brand-accent-picker"
              />
              <Input
                value={accent}
                disabled={props.disabled}
                onChange={(e) =>
                  props.onChange({
                    ...props.value,
                    brandAccentColor: e.target.value,
                  })
                }
                placeholder="#616161"
                data-testid="input-brand-accent"
              />
            </div>
            {accent && getContrastWarning(accent) && (
              <p className="mt-1 text-xs text-amber-600">{getContrastWarning(accent)}</p>
            )}
          </div>
        )}
      </div>
      {props.variant === "partner" &&
        primary &&
        accent &&
        getColorPairWarning(primary, accent) && (
          <p className="text-xs text-amber-600" data-testid="signup-warning-brand-color-pair">
            {getColorPairWarning(primary, accent)}
          </p>
        )}
    </div>
  );
}
