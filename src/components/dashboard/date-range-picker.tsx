"use client";

import { useState, useEffect } from "react";
import { CalendarDays } from "lucide-react";
import {
  autoFormatDateInput,
  isoToDDMMYYYY,
  parseDDMMYYYY,
  toLocalISODate,
} from "@/lib/dates";

interface DateRangePickerProps {
  fromDate: string; // local ISO date string: YYYY-MM-DD
  toDate: string;   // local ISO date string: YYYY-MM-DD
  onFromChange: (date: string) => void;
  onToChange: (date: string) => void;
  /** Range-level error (e.g. From after To) shown under the inputs */
  error?: string | null;
}

function DateInput({
  id,
  label,
  value,
  onChange,
  max,
  min,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (iso: string) => void;
  max?: string;
  min?: string;
}) {
  const [textValue, setTextValue] = useState(isoToDDMMYYYY(value));
  const [error, setError] = useState<string | null>(null);

  // Keep text input in sync when parent changes value (e.g. reset)
  useEffect(() => {
    setTextValue(isoToDDMMYYYY(value));
    setError(null);
  }, [value]);

  /** Returns an error message, or null if `iso` is acceptable. */
  const checkBounds = (iso: string): string | null => {
    if (max && iso > max) return `Must be on or before ${isoToDDMMYYYY(max)}`;
    if (min && iso < min) return `Must be on or after ${isoToDDMMYYYY(min)}`;
    return null;
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Slashes are auto-inserted only while typing forward, so backspace works
    const formatted = autoFormatDateInput(textValue, e.target.value);
    setTextValue(formatted);

    if (formatted.length < 10) {
      setError(null);
      return;
    }

    const iso = parseDDMMYYYY(formatted);
    if (!iso) {
      setError("Invalid date — use DD/MM/YYYY");
      return;
    }
    const boundsError = checkBounds(iso);
    if (boundsError) {
      setError(boundsError);
      return;
    }
    setError(null);
    onChange(iso);
  };

  // Leaving the field with an incomplete/invalid value restores the last valid date
  const handleBlur = () => {
    const iso = parseDDMMYYYY(textValue);
    if (!iso || checkBounds(iso)) {
      setTextValue(isoToDDMMYYYY(value));
      setError(null);
    }
  };

  const handleCalendarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const iso = e.target.value; // already YYYY-MM-DD
    if (!iso) return;
    onChange(iso);
    setTextValue(isoToDDMMYYYY(iso));
    setError(null);
  };

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="text-xs text-muted-foreground font-medium uppercase tracking-wide"
      >
        {label}
      </label>
      <div className="relative flex items-center">
        {/* Text input (DD/MM/YYYY) */}
        <input
          id={id}
          type="text"
          inputMode="numeric"
          value={textValue}
          onChange={handleTextChange}
          onBlur={handleBlur}
          placeholder="DD/MM/YYYY"
          maxLength={10}
          aria-invalid={!!error}
          className={`h-9 w-[130px] rounded-l-md border bg-background px-3 text-sm
            text-foreground placeholder:text-muted-foreground/50 outline-none
            focus:ring-1 focus:ring-primary transition-colors
            ${error ? "border-red-500 focus:ring-red-500" : "border-border/60 focus:ring-primary/60"}`}
        />

        {/* Calendar icon button — opens hidden native date picker */}
        <label
          className="relative h-9 px-2.5 flex items-center justify-center
            rounded-r-md border border-l-0 border-border/60 bg-muted/40
            hover:bg-muted/80 cursor-pointer transition-colors group"
          title="Pick from calendar"
        >
          <CalendarDays className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
          <input
            id={`${id}-calendar`}
            type="date"
            value={value}
            min={min}
            max={max}
            onChange={handleCalendarChange}
            className="absolute inset-0 opacity-0 cursor-pointer w-full"
            aria-label={`${label} (calendar)`}
          />
        </label>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

export function DateRangePicker({
  fromDate,
  toDate,
  onFromChange,
  onToChange,
  error,
}: DateRangePickerProps) {
  const today = toLocalISODate();

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-end gap-2">
        <DateInput
          id="date-from"
          label="From"
          value={fromDate}
          onChange={onFromChange}
          max={toDate || today}
        />
        <div className="pb-1 text-muted-foreground/50 text-sm font-medium">→</div>
        <DateInput
          id="date-to"
          label="To"
          value={toDate}
          onChange={onToChange}
          min={fromDate}
          max={today}
        />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
