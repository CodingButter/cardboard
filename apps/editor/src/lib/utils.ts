import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Standard shadcn/ui className helper: merges Tailwind classes with
 * conflict resolution. Kept here so future `bunx shadcn add ...`
 * generations have the import path they expect.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
