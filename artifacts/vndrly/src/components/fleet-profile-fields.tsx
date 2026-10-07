import { useTranslation } from "react-i18next";
import type { FleetOperationalProfile } from "@workspace/api-zod";
import { fleetCopy } from "@/lib/fleet-copy";
import { PngPillButton } from "@/components/png-pill-rollover";
export function FleetProfileFields({
  value,
  onChange,
  disabled = false,
}: {
  disabled?: boolean;
  value: FleetOperationalProfile | undefined;
  onChange: (value: FleetOperationalProfile | undefined) => void;
}) {
  const { i18n } = useTranslation();
  const c = fleetCopy(i18n.language);
  return (
    <section className="space-y-2 rounded border p-3">
      <h4>{c.profile}</h4>
      <p className="text-xs">{c.profileHint}</p>
      {value && (
        <PngPillButton disabled={disabled} onClick={() => onChange(undefined)}>
          {c.removeProfile}
        </PngPillButton>
      )}
      <label>
        {c.profileName}
        <input
          disabled={disabled}
          className="block rounded border p-2"
          value={value?.name ?? ""}
          onChange={(event) =>
            onChange({
              name: event.target.value,
              inspectionItems: value?.inspectionItems ?? [],
              manifestFields: value?.manifestFields ?? [],
            })
          }
        />
      </label>
      {value &&
        (["inspectionItems", "manifestFields"] as const).map((key) => (
          <fieldset key={key} className="space-y-2">
            <legend>{c[key]}</legend>
            {value[key].map((item, index) => (
              <div className="flex flex-wrap gap-2" key={index}>
                <label>
                  {c.requirementId}
                  <input
                    disabled={disabled}
                    className="block rounded border p-2"
                    value={item.id}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        [key]: value[key].map((row, i) =>
                          i === index
                            ? { ...row, id: event.target.value }
                            : row,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  {c.requirementLabel}
                  <input
                    className="block rounded border p-2"
                    value={item.label}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        [key]: value[key].map((row, i) =>
                          i === index
                            ? { ...row, label: event.target.value }
                            : row,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={item.required}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        [key]: value[key].map((row, i) =>
                          i === index
                            ? { ...row, required: event.target.checked }
                            : row,
                        ),
                      })
                    }
                  />
                  {c.required}
                </label>
                <PngPillButton
                  disabled={disabled}
                  onClick={() =>
                    onChange({
                      ...value,
                      [key]: value[key].filter((_, i) => i !== index),
                    })
                  }
                >
                  {c.removeRequirement}
                </PngPillButton>
              </div>
            ))}
            <PngPillButton
              disabled={disabled || value[key].length >= 50}
              onClick={() => {
                const id = `field_${crypto.randomUUID().slice(0, 8)}`;
                onChange({
                  ...value,
                  [key]: [...value[key], { id, label: id, required: false }],
                });
              }}
            >
              {c.addRequirement}
            </PngPillButton>
          </fieldset>
        ))}
    </section>
  );
}
