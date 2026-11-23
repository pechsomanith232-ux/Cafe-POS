"use client";

import type { VariantProps } from "class-variance-authority";
import type * as React from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ToggleOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
  /** Fill color when selected (e.g. a POS category color); defaults to the primary token. */
  color?: string | null;
};

/**
 * One selected style for every single-choice toggle in the app: the chosen
 * option is filled (bg-primary text-primary-foreground), the others are
 * outline (or ghost). Items stay real buttons with aria-pressed, so they keep
 * the "button" role that tests and screen readers expect.
 */
export function TogglePills<T extends string>({
  value,
  onValueChange,
  options,
  size = "default",
  unselected = "outline",
  pill = false,
  className,
  itemClassName,
  ...rest
}: {
  value: T;
  onValueChange: (v: T) => void;
  options: ToggleOption<T>[];
  size?: VariantProps<typeof buttonVariants>["size"];
  unselected?: "outline" | "ghost";
  /** Fully rounded chips (POS categories). */
  pill?: boolean;
  className?: string;
  itemClassName?: string;
} & Omit<React.ComponentProps<"div">, "onChange">) {
  return (
    <div role="group" className={cn("flex gap-2", className)} {...rest}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            disabled={o.disabled}
            onClick={() => onValueChange(o.value)}
            className={cn(
              buttonVariants({ variant: on ? "default" : unselected, size }),
              on && "shadow-xs",
              pill && "rounded-full",
              itemClassName,
            )}
            style={
              o.color
                ? on
                  ? { backgroundColor: o.color, borderColor: o.color, color: "white" }
                  : { borderColor: o.color }
                : undefined
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
