/**
 * Editor primitive library barrel — trimmed.
 *
 * Historically this barrel re-exported every primitive in `components/ui/`.
 * The post-extraction audit (2026-05-20) confirmed that only `Button` and
 * `Modal` are imported through this barrel; every other primitive is
 * reached via direct `./<Name>` imports from its sibling files. Trimming
 * keeps the public surface small and avoids accidental fan-out.
 *
 * Add a new export here only when more than one caller would benefit from
 * importing through `components/ui` instead of the sibling path.
 */

export { Button } from "./Button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./Button";

export { Modal } from "./Modal";
export type { ModalProps, ModalWidth } from "./Modal";
