import { ModalDismissButton } from "./modal-dismiss-button";
import * as React from "react";
import {
  normalizePlateState,
  orderPlateStates,
  US_PLATE_STATES,
  type PlateStateCode,
} from "@workspace/plate-state";
import { Check, ChevronsUpDown, CreditCard, X } from "lucide-react";
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
  gateLayout?: boolean;
}

export function PlateStatePicker({
  value,
  onChange,
  preferredStates,
  disabled = false,
  error,
  gateLayout = false,
}: PlateStatePickerProps) {
  const { t } = useTranslation();
  const errorId = React.useId();
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
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
            ref={triggerRef}
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
          ref={menuRef}
          aria-label={t("plateStatePicker.label")}
          align={gateLayout ? "end" : undefined}
          side={gateLayout ? "bottom" : undefined}
          avoidCollisions={!gateLayout}
          collisionPadding={12}
          style={gateLayout ? {
            width: "min(calc(var(--radix-popover-trigger-width) * 1.25), calc(100vw - 24px))",
            height: "min(24rem, max(10rem, var(--radix-popover-content-available-height)), calc(100dvh - 24px))",
          } : { maxHeight: "min(calc(100dvh - 24px), var(--radix-popover-content-available-height))" }}
          className={cn("flex flex-col overflow-hidden w-[var(--radix-popover-trigger-width)] border-2 border-[color:var(--brand-primary)] bg-white p-2 text-gray-700", gateLayout && "data-[state=open]:animate-none")}
          role="dialog"
          onOpenAutoFocus={gateLayout ? event => {
            event.preventDefault();
            menuRef.current?.focus({ preventScroll: true });
          } : undefined}
          onCloseAutoFocus={gateLayout ? event => {
            event.preventDefault();
            triggerRef.current?.focus({ preventScroll: true });
          } : undefined}
        >
          <div className={cn("flex shrink-0 items-center", gateLayout ? "justify-between gap-2" : "justify-end")}>
            {gateLayout && <h2 className="flex min-w-0 items-center gap-2 pl-2 text-sm font-semibold">
              <CreditCard aria-hidden="true" className="size-4 shrink-0 text-[var(--brand-primary)]" />
              {t("plateStatePicker.label")}
            </h2>}
            <button type="button" aria-label={t("common.close")} className="inline-flex h-11 w-11 shrink-0 items-center justify-center" onClick={() => setOpen(false)}>
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
          <Command
            className="min-h-0 flex-1 bg-white text-gray-900"
            label={t("plateStatePicker.search")}
            loop
            shouldFilter={false}
          >
            <CommandInput
              aria-label={t("plateStatePicker.search")}
              className="text-gray-900 placeholder:text-gray-500"
              onValueChange={setQuery}
              placeholder={t("plateStatePicker.search")}
              value={query}
            />
            <CommandList className={cn("min-h-0 overflow-y-auto", gateLayout && "max-h-none flex-1")}>
              <CommandEmpty>{t("plateStatePicker.noResults")}</CommandEmpty>
              {preferredOptions.length > 0 ? (
                <CommandGroup
                  className="bg-white text-gray-900 [&_[cmdk-group-heading]]:text-gray-500"
                  heading={t("plateStatePicker.preferred")}
                >
                  {preferredOptions.map((state) => {
                    const isSelected = state.code === value;
                    return (
                      <CommandItem
                        aria-selected={isSelected}
                        className="bg-white text-gray-900 aria-selected:bg-[var(--brand-primary)] aria-selected:text-white data-[selected=true]:bg-[var(--brand-primary)] data-[selected=true]:text-white"
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
                <CommandGroup
                  className="bg-white text-gray-900 [&_[cmdk-group-heading]]:text-gray-500"
                  heading={t("plateStatePicker.all")}
                >
                  {remainingOptions.map((state) => {
                    const isSelected = state.code === value;
                    return (
                      <CommandItem
                        aria-selected={isSelected}
                        className="bg-white text-gray-900 aria-selected:bg-[var(--brand-primary)] aria-selected:text-white data-[selected=true]:bg-[var(--brand-primary)] data-[selected=true]:text-white"
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
          {!gateLayout && <div className="modal-safe-footer"><ModalDismissButton onClick={()=>{setOpen(false);setQuery("");}} /></div>}
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
