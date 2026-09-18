import * as React from "react";
import {
  normalizePlateState,
  orderPlateStates,
  US_PLATE_STATES,
  type PlateStateCode,
} from "@workspace/plate-state";
import { Check, ChevronsUpDown } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { WORK_HUB_BRANDED_FIELD_CLASS } from "@/components/work-hub/chrome";

export interface PlateStatePickerProps {
  value: PlateStateCode | null;
  onChange: (state: PlateStateCode) => void;
  preferredStates: readonly (PlateStateCode | string | null | undefined)[];
  disabled?: boolean;
  error?: string;
}

export function PlateStatePicker({
  value,
  onChange,
  preferredStates,
  disabled = false,
  error,
}: PlateStatePickerProps) {
  const { t } = useTranslation();
  const errorId = React.useId();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const selectedState = React.useMemo(
    () => US_PLATE_STATES.find((state) => state.code === value) ?? null,
    [value],
  );
  const states = React.useMemo(
    () => orderPlateStates(preferredStates, query),
    [preferredStates, query],
  );
  const preferredCodes = React.useMemo(() => {
    const codes = new Set<PlateStateCode>();
    for (const candidate of preferredStates) {
      const code = normalizePlateState(candidate);
      if (code) codes.add(code);
    }
    return codes;
  }, [preferredStates]);
  const preferredOptions = states.filter((state) => preferredCodes.has(state.code));
  const remainingOptions = states.filter((state) => !preferredCodes.has(state.code));
  const selectLabel = t("plateStatePicker.select");
  const triggerLabel = selectedState
    ? t("plateStatePicker.selected", {
        state: selectedState.name,
        code: selectedState.code,
      })
    : selectLabel;

  React.useEffect(() => {
    if (disabled) {
      setOpen(false);
      setQuery("");
    }
  }, [disabled]);

  const selectState = (state: PlateStateCode) => {
    if (disabled) return;
    onChange(state);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="space-y-1.5">
      <Popover
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setQuery("");
        }}
        open={open}
      >
        <PopoverTrigger asChild>
          <Button
            aria-describedby={error ? errorId : undefined}
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-label={triggerLabel}
            aria-invalid={error ? true : undefined}
            className={cn(
              WORK_HUB_BRANDED_FIELD_CLASS, "justify-between font-normal",
              error && "border-destructive",
            )}
            data-testid="plate-state-picker-trigger"
            disabled={disabled}
            type="button"
            variant="outline"
          >
            <span>{selectedState ? `${selectedState.name} (${selectedState.code})` : selectLabel}</span>
            <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          aria-label={t("plateStatePicker.label")}
          className="w-[var(--radix-popover-trigger-width)] border-2 border-[color:var(--brand-primary)] bg-white p-2 text-gray-700"
          role="dialog"
        >
          <Command label={t("plateStatePicker.search")} loop shouldFilter={false}>
            <CommandInput
              aria-label={t("plateStatePicker.search")}
              className="text-popover-foreground placeholder:text-popover-foreground/60"
              onValueChange={setQuery}
              placeholder={t("plateStatePicker.search")}
              value={query}
            />
            <CommandList>
              <CommandEmpty>{t("plateStatePicker.noResults")}</CommandEmpty>
              {preferredOptions.length > 0 ? (
                <CommandGroup heading={t("plateStatePicker.preferred")}>
                  {preferredOptions.map((state) => {
                    const isSelected = state.code === value;
                    return (
                      <CommandItem
                        aria-selected={isSelected}
                        className="text-popover-foreground aria-selected:bg-[var(--brand-primary)] aria-selected:text-white data-[selected=true]:bg-[var(--brand-primary)] data-[selected=true]:text-white"
                        key={state.code}
                        onSelect={() => selectState(state.code)}
                        role="option"
                        value={`${state.name} ${state.code}`}
                      >
                        <Check
                          aria-hidden="true"
                          className={cn("size-4", isSelected ? "opacity-100" : "opacity-0")}
                        />
                        {state.name} ({state.code})
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ) : null}
              {remainingOptions.length > 0 ? (
                <CommandGroup heading={t("plateStatePicker.all")}>
                  {remainingOptions.map((state) => {
                    const isSelected = state.code === value;
                    return (
                      <CommandItem
                        aria-selected={isSelected}
                        className="text-popover-foreground aria-selected:bg-[var(--brand-primary)] aria-selected:text-white data-[selected=true]:bg-[var(--brand-primary)] data-[selected=true]:text-white"
                        key={state.code}
                        onSelect={() => selectState(state.code)}
                        role="option"
                        value={`${state.name} ${state.code}`}
                      >
                        <Check
                          aria-hidden="true"
                          className={cn("size-4", isSelected ? "opacity-100" : "opacity-0")}
                        />
                        {state.name} ({state.code})
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error ? (
        <p className="text-sm text-destructive" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default PlateStatePicker;
