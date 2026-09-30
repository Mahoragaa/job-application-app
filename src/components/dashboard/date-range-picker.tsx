"use client";

import { useState, useEffect } from "react";
import { CalendarDays } from "lucide-react";

interface DateRangePickerProps {
  fromDate: string; // ISO date string: YYYY-MM-DD
  toDate: string;   // ISO date string: YYYY-MM-DD
  onFromChange: (date: string) => void;
  onToChange: (date: string) => void;
}

/**
 * Converts DD/MM/YYYY → YYYY-MM-DD (ISO) for internal storage.
 * Returns empty string if input is invalid.
 */
function ddmmyyyyToISO(input: string): string {
  const parts = input.split("/");
  if (parts.length !== 3) return "";
  const [dd, mm, yyyy] = parts;
  if (!dd || !mm || !yyyy || yyyy.length !== 4) return "";
  const d = new Date(`${yyyy}-${mm}-${dd}`);
  if (isNaN(d.getTime())) return "";
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

/**
 * Converts YYYY-MM-DD → DD/MM/YYYY for display in the text input.
 */
function isoToDDMMYYYY(iso: string): string {
  if (!iso) return "";
  const [yyyy, mm, dd] = iso.split("-");
  if (!yyyy || !mm || !dd) return "";
  return `${dd}/${mm}/${yyyy}`;
}

function DateInput({
  label,
  value,
  onChange,
  max,
  min,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  max?: string;
  min?: string;
}) {
  const [textValue, setTextValue] = useState(isoToDDMMYYYY(value));
  const [error, setError] = useState(false);

  // Keep text input in sync when parent changes value (e.g. reset)
  useEffect(() => {
    setTextValue(isoToDDMMYYYY(value));
    setError(false);
  }, [value]);

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setTextValue(raw);

    // Auto-insert slashes as user types
    if (/^\d{2}$/.test(raw) || /^\d{2}\/\d{2}$/.test(raw)) {
      setTextValue(raw + "/");
      return;
    }

    // Try to parse as DD/MM/YYYY
    if (raw.length === 10) {
      const iso = ddmmyyyyToISO(raw);
      if (iso) {
        setError(false);
        onChange(iso);
      } else {
        setError(true);
      }
    } else {
      setError(false);
    }
  };

  const handleCalendarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const iso = e.target.value; // already YYYY-MM-DD
    onChange(iso);
    setTextValue(isoToDDMMYYYY(iso));
    setError(false);
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
        {label}
      </label>
      <div className="relative flex items-center">
        {/* Text input (DD/MM/YYYY) */}
        <input
          type="text"
          value={textValue}
          onChange={handleTextChange}
          placeholder="DD/MM/YYYY"
          maxLength={10}
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
            type="date"
            value={value}
            min={min}
            max={max}
            onChange={handleCalendarChange}
            className="absolute inset-0 opacity-0 cursor-pointer w-full"
          />
        </label>
      </div>
      {error && (
        <p className="text-xs text-red-400">Invalid date — use DD/MM/YYYY</p>
      )}
    </div>
  );
}

export function DateRangePicker({
  fromDate,
  toDate,
  onFromChange,
  onToChange,
}: DateRangePickerProps) {
  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="flex items-end gap-2">
      <DateInput
        label="From"
        value={fromDate}
        onChange={onFromChange}
        max={toDate || today}
      />
      <div className="pb-1 text-muted-foreground/50 text-sm font-medium">→</div>
      <DateInput
        label="To"
        value={toDate}
        onChange={onToChange}
        min={fromDate}
        max={today}
      />
    </div>
  );
}
