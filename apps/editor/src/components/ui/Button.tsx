import React from "react";
import { cn } from "../../lib/cn";

/**
 * Button — Phase 1 primitive.
 *
 * Refined replacement for the legacy `Button` in `ui.tsx`. Five
 * variants × two sizes, with optional leading/trailing icons. All
 * variants reference the design-system `.button-*` classes so retunes
 * stay centralised.
 *
 * Mockups: every page. Primary actions (Save, Export, Repack Package,
 * New Project) are amber `primary`; secondary actions (Cancel, Browse)
 * are zinc `secondary`; toolbar chrome and ghost actions are `ghost`;
 * destructive (Delete, Stop) is `danger`; success state (Bake Complete,
 * Live Reload) is `success`.
 */

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "success";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Optional icon rendered before the label. */
  leadingIcon?: React.ReactNode;
  /** Optional icon rendered after the label. */
  trailingIcon?: React.ReactNode;
  /** Stretch to fill the available width. */
  block?: boolean;
}

/** Variant → design-system class. */
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "button-primary",
  secondary: "button-secondary",
  ghost: "button-ghost",
  danger: "button-danger",
  success: "button-success",
};

/** Size → height + horizontal padding override.
 *  The design-system classes default to h-8 (32px). `sm` and `lg`
 *  override that height; `md` is a no-op. */
const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-[11px]",
  md: "",
  lg: "h-10 px-4 text-sm",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "secondary",
      size = "md",
      leadingIcon,
      trailingIcon,
      block = false,
      className,
      children,
      type = "button",
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          VARIANT_CLASS[variant],
          SIZE_CLASS[size],
          block && "w-full",
          className,
        )}
        {...rest}
      >
        {leadingIcon && (
          <span className="inline-flex items-center justify-center w-3.5 h-3.5 shrink-0">
            {leadingIcon}
          </span>
        )}
        {children && <span className="truncate">{children}</span>}
        {trailingIcon && (
          <span className="inline-flex items-center justify-center w-3.5 h-3.5 shrink-0">
            {trailingIcon}
          </span>
        )}
      </button>
    );
  },
);
