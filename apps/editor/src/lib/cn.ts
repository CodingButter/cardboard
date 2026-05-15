import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Standard shadcn-style class-name helper. `clsx` handles conditional
 * lists and `tailwind-merge` resolves conflicting Tailwind utility
 * classes (e.g. `p-2 p-4` → `p-4`). Used everywhere we accept a
 * `className` prop alongside built-in classes.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
