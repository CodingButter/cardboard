/**
 * Keybinding parser — turns strings like `"Ctrl+Shift+P"` into a
 * predicate that matches `KeyboardEvent`s.
 *
 * Cmd vs Ctrl: on macOS, `Ctrl` in a binding string is normalised to
 * the Cmd (⌘) key. We detect macOS via `navigator.platform` /
 * `navigator.userAgent` at parse time. Explicit `Meta+`/`Cmd+` always
 * means the meta key regardless of platform.
 */

export interface ParsedKeybinding {
  ctrlOrCmd: boolean; // Ctrl on Windows/Linux, Cmd on macOS
  ctrl: boolean; // explicit Ctrl (matches the literal Ctrl key only)
  meta: boolean; // explicit Meta/Cmd
  shift: boolean;
  alt: boolean;
  key: string; // lowercase main key, e.g. "p", "s", "arrowup"
}

/** Returns true when running on macOS. SSR-safe. */
export function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform || "";
  const ua = navigator.userAgent || "";
  // navigator.platform is deprecated but still the most reliable mac
  // signal in modern browsers. Fall back to userAgent's "Mac" token.
  return /Mac|iPhone|iPad|iPod/.test(platform) || /Mac OS X/.test(ua);
}

const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  del: "delete",
  ins: "insert",
  return: "enter",
  space: " ",
  spacebar: " ",
  pageup: "pageup",
  pagedown: "pagedown",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
};

/** Parse a keybinding string into its components. */
export function parseKeybinding(binding: string): ParsedKeybinding {
  const parts = binding
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  let ctrlOrCmd = false;
  let ctrl = false;
  let meta = false;
  let shift = false;
  let alt = false;
  let key = "";
  for (const raw of parts) {
    const tok = raw.toLowerCase();
    if (tok === "ctrl" || tok === "control") {
      // "Ctrl" in a binding string is shorthand for ctrl/cmd in the
      // VSCode tradition. Use "Control" if you want literal Ctrl only,
      // not (we don't currently distinguish — Ctrl always maps to the
      // platform-primary modifier).
      ctrlOrCmd = true;
    } else if (tok === "cmd" || tok === "meta" || tok === "command") {
      meta = true;
    } else if (tok === "shift") {
      shift = true;
    } else if (tok === "alt" || tok === "option" || tok === "opt") {
      alt = true;
    } else {
      key = KEY_ALIASES[tok] ?? tok;
    }
  }
  return { ctrlOrCmd, ctrl, meta, shift, alt, key };
}

/** Format a parsed binding for display, platform-aware. */
export function formatKeybinding(binding: string): string {
  const p = parseKeybinding(binding);
  const mac = isMacOS();
  const parts: string[] = [];
  if (p.ctrlOrCmd) parts.push(mac ? "⌘" : "Ctrl");
  if (p.meta && !p.ctrlOrCmd) parts.push(mac ? "⌘" : "Meta");
  if (p.alt) parts.push(mac ? "⌥" : "Alt");
  if (p.shift) parts.push(mac ? "⇧" : "Shift");
  if (p.key) {
    const display =
      p.key.length === 1
        ? p.key.toUpperCase()
        : p.key.charAt(0).toUpperCase() + p.key.slice(1);
    parts.push(display);
  }
  return mac ? parts.join("") : parts.join("+");
}

/**
 * Match a `KeyboardEvent` against a binding string.
 *
 * Modifier rules:
 *   - `Ctrl+X`  matches Ctrl+X on Windows/Linux, Cmd+X on macOS.
 *   - `Cmd+X`   matches Meta+X on any platform.
 *   - `Shift`/`Alt` are required exact matches when in the binding;
 *     additional unspecified modifiers cause a mismatch.
 */
export function matchKeybinding(
  event: KeyboardEvent,
  binding: string,
): boolean {
  const p = parseKeybinding(binding);
  const mac = isMacOS();

  // ctrl-or-cmd: on Mac, require meta and forbid ctrl; on others, the
  // reverse.
  const wantCtrl = p.ctrlOrCmd ? (mac ? false : true) : p.ctrl;
  const wantMeta = p.ctrlOrCmd ? (mac ? true : false) : p.meta;

  if (event.ctrlKey !== wantCtrl) return false;
  if (event.metaKey !== wantMeta) return false;
  if (event.shiftKey !== p.shift) return false;
  if (event.altKey !== p.alt) return false;

  if (!p.key) return false;
  const eventKey = (event.key || "").toLowerCase();
  return eventKey === p.key;
}
