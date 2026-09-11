import { useEffect, useId, useState, type ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import type { GateMemorySuggestion } from "@/lib/gate-entry-memory";
import { cn } from "@/lib/utils";

type GateMemoryInputProps = ComponentProps<typeof Input> & {
  suggestions: GateMemorySuggestion[];
  onPick: (suggestion: GateMemorySuggestion) => void;
  suggestionsLabel?: string;
};

export function GateMemoryInput({
  suggestions,
  onPick,
  suggestionsLabel,
  className,
  onFocus,
  onBlur,
  onChange,
  onKeyDown,
  ...props
}: GateMemoryInputProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const show = open && suggestions.length > 0;
  const activeOptionId = show && suggestions[highlight] ? `${listId}-option-${highlight}` : undefined;

  useEffect(() => {
    setHighlight(0);
  }, [suggestions]);

  return (
    <div className="relative">
      <Input
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-autocomplete="list"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={show}
        aria-controls={listId}
        aria-activedescendant={activeOptionId}
        {...props}
        className={className}
        onFocus={(event) => {
          setOpen(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setOpen(false);
          onBlur?.(event);
        }}
        onChange={(event) => {
          setOpen(true);
          onChange?.(event);
        }}
        onKeyDown={(event) => {
          if (show && event.key === "ArrowDown") {
            event.preventDefault();
            setHighlight((index) => (index + 1) % suggestions.length);
          } else if (show && event.key === "ArrowUp") {
            event.preventDefault();
            setHighlight((index) => (index - 1 + suggestions.length) % suggestions.length);
          } else if (show && event.key === "Enter" && suggestions[highlight]) {
            event.preventDefault();
            onPick(suggestions[highlight]);
            setOpen(false);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
          onKeyDown?.(event);
        }}
      />
      {show ? (
        <ul
          id={listId}
          role="listbox"
          data-testid="gate-memory-suggestions"
          aria-label={suggestionsLabel}
          className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border-2 border-gray-300 bg-white py-1 shadow-lg dark:border-gray-400"
        >
          {suggestions.map((row, index) => (
            <li
              id={`${listId}-option-${index}`}
              key={row.id}
              role="option"
              aria-selected={index === highlight}
              data-testid={`gate-memory-suggestion-${index}`}
              className={cn(
                "flex w-full cursor-pointer flex-col items-start px-3 py-2 text-left text-sm text-gray-900",
                index === highlight ? "bg-amber-100" : "hover:bg-gray-100",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => {
                onPick(row);
                setOpen(false);
              }}
            >
              <span className="font-medium">{row.label}</span>
              {row.detail ? <span className="text-xs text-muted-foreground">{row.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
