import React from "react";
import {
  Eye,
  EyeOff,
  Lightbulb,
  MoreVertical,
  Plus,
  Spotlight,
  Square,
  Sun,
  Trash2,
} from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { EmptyState } from "../../../components/ui";
import { Tooltip } from "../../../components/ui/Tooltip";
import { registerCommand } from "../../../state/useCommandStore";
import {
  MOCK_LIGHTS,
  type LightKind,
  type LightRow,
} from "../scene-fixtures";

/**
 * LightingPanel — scene-light list + per-light enable toggle + selection
 * for editing.
 *
 * Opt-in panel (not part of the default Map.png layout). Renders a
 * compact, dense list of every light entity in the scene. Each row
 * shows: kind icon, color swatch, name, intensity readout, enable
 * toggle. Clicking a row selects the light for editing (the future
 * cell/entity inspector will read from `cardboard.scene.lighting.activeId`
 * to render the property editor).
 *
 * Persistence contract (Wave 2 placeholder; replaced by the real
 * scene-light store in a later wave):
 *   - `cardboard.scene.lighting.activeId`          string light id
 *   - `cardboard.scene.lighting.enabledOverrides`  JSON Record<id, boolean>
 *
 * The overrides map lets the user flip `enabled` on top of the
 * fixture's default without forking the fixture shape. A missing
 * entry means "use the fixture default", which keeps storage tidy
 * when the user hasn't touched anything.
 *
 * Every interactive control also registers a command via
 * `registerCommand` so the palette + future keybindings can drive the
 * same actions. Per-light commands are dynamic — re-registered when
 * the light roster changes (today MOCK_LIGHTS is module-level, but
 * the effect is keyed on the resolved light list so a future store
 * swap flows through without touching the effect).
 */

// ---------------------------------------------------------------------------
// localStorage helpers — mirror LayersPanel's pattern. The JSON-shaped
// key gets a safe parse/stringify wrapper; both swallow quota /
// private-mode / corrupt-value failures so the panel always renders
// something even if storage is wedged.

const LS_ACTIVE_ID = "cardboard.scene.lighting.activeId";
const LS_ENABLED_OVERRIDES = "cardboard.scene.lighting.enabledOverrides";

function readLS(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLS(key: string, value: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore quota / private-mode failures */
  }
}

function readJSON<T>(key: string, fallback: T): T {
  const raw = readLS(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    writeLS(key, JSON.stringify(value));
  } catch {
    /* JSON.stringify can throw on circular refs — defensive only */
  }
}

// ---------------------------------------------------------------------------
// Initial-state builders. The active-id default and enabled-overrides
// default both derive from MOCK_LIGHTS so a future fixture edit
// (added/removed light) flows through without touching this file.

function defaultActiveId(): string {
  return MOCK_LIGHTS[0]?.id ?? "";
}

// ---------------------------------------------------------------------------
// Responsive breakpoints — measured on the panel root via ResizeObserver.
//
//   < COMPACT_WIDTH_PX  → drop the intensity readout column.
//   < TIGHT_WIDTH_PX    → also drop the color swatch (kind icon alone).
//   < HEADER_COLLAPSE_PX → fold Delete + Enable-All + Disable-All
//                         behind a kebab menu in the header toolbar.
//
// All actions remain reachable through the command palette in every
// width state, so collapsing the visual buttons doesn't strand the
// functionality.
const COMPACT_WIDTH_PX = 180;
const TIGHT_WIDTH_PX = 140;
const HEADER_COLLAPSE_PX = 220;
// Below this width the toolbar's "LIGHTS" eyebrow label is hidden so
// the kebab + Add button keep room. The label is purely decorative —
// the panel's identity is already conveyed by the dock tab.
const HEADER_LABEL_HIDE_PX = 120;

// ---------------------------------------------------------------------------
// Kind icon mapping. The fixture's `LightKind` enum maps onto these
// lucide glyphs. Directional → Sun, point → Lightbulb, spot →
// Spotlight, area → Square (filled-square hints at the area-light
// quad). The icon size matches the rest of the panel's 12px line.

function kindIconClass(kind: LightKind): {
  Icon: React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
  label: string;
} {
  switch (kind) {
    case "directional":
      return { Icon: Sun, label: "Directional light" };
    case "point":
      return { Icon: Lightbulb, label: "Point light" };
    case "spot":
      return { Icon: Spotlight, label: "Spot light" };
    case "area":
      return { Icon: Square, label: "Area light" };
  }
}

// ---------------------------------------------------------------------------
// Panel root.

export function LightingPanel(): React.JSX.Element {
  // ---- State -------------------------------------------------------------

  const [activeId, setActiveId] = React.useState<string>(() => {
    const stored = readLS(LS_ACTIVE_ID);
    if (stored && MOCK_LIGHTS.some((l) => l.id === stored)) return stored;
    return defaultActiveId();
  });

  const [enabledOverrides, setEnabledOverrides] = React.useState<
    Record<string, boolean>
  >(() => readJSON<Record<string, boolean>>(LS_ENABLED_OVERRIDES, {}));

  // Compact-mode flags driven by the panel root's measured width.
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState<number>(0);

  React.useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(w);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  // Width === 0 is the pre-measurement state. Treat it as "wide enough"
  // so the toolbar renders its expanded form on the very first paint
  // and only collapses if the ResizeObserver actually reports a narrow
  // measurement. Avoids a flash of the kebab on startup.
  const compact = width > 0 && width < COMPACT_WIDTH_PX;
  const tight = width > 0 && width < TIGHT_WIDTH_PX;
  const headerCollapsed = width > 0 && width < HEADER_COLLAPSE_PX;
  const hideHeaderLabel = width > 0 && width < HEADER_LABEL_HIDE_PX;

  // ---- Persistence -------------------------------------------------------

  React.useEffect(() => {
    writeLS(LS_ACTIVE_ID, activeId);
  }, [activeId]);

  React.useEffect(() => {
    writeJSON(LS_ENABLED_OVERRIDES, enabledOverrides);
  }, [enabledOverrides]);

  // ---- Handlers ----------------------------------------------------------

  const activateLight = React.useCallback((lightId: string) => {
    setActiveId(lightId);
  }, []);

  const toggleLight = React.useCallback((lightId: string) => {
    setEnabledOverrides((prev) => {
      // Look up the fixture's baseline so the override flips relative
      // to it, not to a missing/false initial value.
      const fixture = MOCK_LIGHTS.find((l) => l.id === lightId);
      const baseline = fixture?.enabled ?? true;
      const currentlyEnabled = prev[lightId] ?? baseline;
      return { ...prev, [lightId]: !currentlyEnabled };
    });
  }, []);

  // Stub — real Add flow lands in Wave 3 when the scene-light store
  // is in place. Logging keeps the command palette interactive so
  // users can verify the wire-up.
  const addLight = React.useCallback(() => {
    // eslint-disable-next-line no-console
    console.log("[LightingPanel] scene.light.add invoked (stub)");
  }, []);

  // Stub — confirms before logging so the destructive-action gate is
  // exercised. Real implementation removes the active light from the
  // scene-light store and reassigns activeId to the next neighbour.
  const deleteActiveLight = React.useCallback(() => {
    if (typeof window === "undefined") return;
    const light = MOCK_LIGHTS.find((l) => l.id === activeId);
    const name = light?.name ?? activeId;
    const ok = window.confirm(`Delete light "${name}"?`);
    if (!ok) return;
    // eslint-disable-next-line no-console
    console.log("[LightingPanel] scene.light.delete invoked (stub)", activeId);
  }, [activeId]);

  const enableAllLights = React.useCallback(() => {
    setEnabledOverrides(() => {
      const next: Record<string, boolean> = {};
      for (const l of MOCK_LIGHTS) next[l.id] = true;
      return next;
    });
  }, []);

  const disableAllLights = React.useCallback(() => {
    setEnabledOverrides(() => {
      const next: Record<string, boolean> = {};
      for (const l of MOCK_LIGHTS) next[l.id] = false;
      return next;
    });
  }, []);

  // Stable handler refs so the per-light command registrations don't
  // need to re-run on every render. Mirrors the README's canonical
  // handler-ref pattern.
  const activateRef = React.useRef(activateLight);
  const toggleRef = React.useRef(toggleLight);
  const addRef = React.useRef(addLight);
  const deleteRef = React.useRef(deleteActiveLight);
  const enableAllRef = React.useRef(enableAllLights);
  const disableAllRef = React.useRef(disableAllLights);
  React.useEffect(() => {
    activateRef.current = activateLight;
    toggleRef.current = toggleLight;
    addRef.current = addLight;
    deleteRef.current = deleteActiveLight;
    enableAllRef.current = enableAllLights;
    disableAllRef.current = disableAllLights;
  }, [
    activateLight,
    toggleLight,
    addLight,
    deleteActiveLight,
    enableAllLights,
    disableAllLights,
  ]);

  // ---- Resolved light list ----------------------------------------------
  //
  // Widen the `as const` fixture entries to plain LightRow so the
  // map stays typed against the interface (Map.get returns
  // `LightRow | undefined`, not the literal-union shape).

  const lights: LightRow[] = React.useMemo(
    () => MOCK_LIGHTS.map((l) => ({ ...l })),
    [],
  );

  // Resolve the visible "enabled" value for a given light id —
  // override-wins-over-fixture-default. Exposed as a helper because
  // both the row render and the command-registration loop need it.
  const isLightEnabled = React.useCallback(
    (light: LightRow): boolean =>
      enabledOverrides[light.id] ?? light.enabled,
    [enabledOverrides],
  );

  // ---- Command registry --------------------------------------------------
  //
  // Static commands first, then a dynamic batch per light. We flatten
  // all per-invocation unregister functions into a single array and
  // run them on cleanup. The dynamic effect is keyed on `lights` so
  // a future fixture/store swap that adds or removes lights flows
  // through without manual intervention.

  // Static commands — header actions. Mount-once registration.
  React.useEffect(() => {
    const unregs = [
      registerCommand({
        id: "scene.light.add",
        title: "Add Light…",
        category: "Light",
        keywords: ["light", "add", "create", "new"],
        description: "Create a new scene light (stub).",
        run: () => addRef.current(),
      }),
      registerCommand({
        id: "scene.light.delete",
        title: "Delete Active Light",
        category: "Light",
        keywords: ["light", "delete", "remove", "destroy"],
        description:
          "Delete the currently-active scene light after confirmation.",
        run: () => deleteRef.current(),
      }),
      registerCommand({
        id: "scene.light.enableAll",
        title: "Enable All Lights",
        category: "Light",
        keywords: ["light", "enable", "all", "show", "on"],
        description: "Enable every scene light at once.",
        run: () => enableAllRef.current(),
      }),
      registerCommand({
        id: "scene.light.disableAll",
        title: "Disable All Lights",
        category: "Light",
        keywords: ["light", "disable", "all", "hide", "off"],
        description: "Disable every scene light at once.",
        run: () => disableAllRef.current(),
      }),
    ];
    return () => unregs.forEach((u) => u());
  }, []);

  // Dynamic per-light commands — `Activate Light: <Name>` and
  // `Toggle Light: <Name>` for each row.
  React.useEffect(() => {
    const unregs: Array<() => void> = [];
    for (const l of lights) {
      unregs.push(
        registerCommand({
          id: `scene.light.activate.${l.id}`,
          title: `Activate Light: ${l.name}`,
          category: "Light",
          keywords: [
            "light",
            "activate",
            "select",
            l.name.toLowerCase(),
            l.kind,
          ],
          description: l.description,
          run: () => activateRef.current(l.id),
        }),
        registerCommand({
          id: `scene.light.toggle.${l.id}`,
          title: `Toggle Light: ${l.name}`,
          category: "Light",
          keywords: [
            "light",
            "toggle",
            "enable",
            "disable",
            l.name.toLowerCase(),
            l.kind,
          ],
          description: l.description,
          run: () => toggleRef.current(l.id),
        }),
      );
    }
    return () => unregs.forEach((u) => u());
  }, [lights]);

  // ---- Render ------------------------------------------------------------

  return (
    <div
      ref={rootRef}
      data-panel="lighting"
      className="h-full w-full min-h-0 flex flex-col gap-1 overflow-x-hidden"
    >
      <LightingToolbar
        collapsed={headerCollapsed}
        hideLabel={hideHeaderLabel}
        onAdd={addLight}
        onDelete={deleteActiveLight}
        onEnableAll={enableAllLights}
        onDisableAll={disableAllLights}
      />
      <div className="flex-1 min-h-0 flex flex-col gap-1 overflow-y-auto overflow-x-hidden">
        {lights.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <EmptyState
              icon={<Lightbulb size={28} />}
              title="No lights"
              description="Add a light to begin shaping the scene's atmosphere."
            />
          </div>
        ) : (
          lights.map((l) => {
            const enabled = isLightEnabled(l);
            const isActive = l.id === activeId;
            return (
              <LightRowView
                key={l.id}
                light={l}
                isActive={isActive}
                enabled={enabled}
                compact={compact}
                tight={tight}
                onActivate={activateLight}
                onToggle={toggleLight}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header toolbar — Add / Delete / Enable All / Disable All. Below
// HEADER_COLLAPSE_PX, the destructive + bulk actions fold behind a
// kebab so the row stays a single line at narrow widths.

interface LightingToolbarProps {
  collapsed: boolean;
  hideLabel: boolean;
  onAdd: () => void;
  onDelete: () => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
}

function LightingToolbar({
  collapsed,
  hideLabel,
  onAdd,
  onDelete,
  onEnableAll,
  onDisableAll,
}: LightingToolbarProps): React.JSX.Element {
  return (
    <div className="shrink-0 h-7 flex items-center gap-1 min-w-0">
      {hideLabel ? (
        // Keep the spacer so the action cluster stays right-aligned —
        // dropping the label without a placeholder would shove the
        // buttons to the left edge.
        <span className="flex-1 min-w-0" aria-hidden="true" />
      ) : (
        <span className="flex-1 min-w-0 text-[10px] uppercase tracking-[0.18em] text-(--color-fg-muted) font-semibold truncate">
          Lights
        </span>
      )}
      <div className="shrink-0 flex items-center gap-1">
        {/* Add is always present — it's the primary "create" action and
            doesn't compete with anything for width. */}
        <ToolbarIconButton
          ariaLabel="Add Light"
          tooltipLabel="Add"
          tooltipDescription="Create a new scene light (stub)."
          onClick={onAdd}
          icon={<Plus size={12} aria-hidden="true" />}
        />
        {collapsed ? (
          <LightingKebab
            onDelete={onDelete}
            onEnableAll={onEnableAll}
            onDisableAll={onDisableAll}
          />
        ) : (
          <>
            <ToolbarIconButton
              ariaLabel="Enable All Lights"
              tooltipLabel="Enable All"
              tooltipDescription="Enable every scene light at once."
              onClick={onEnableAll}
              icon={<Eye size={12} aria-hidden="true" />}
            />
            <ToolbarIconButton
              ariaLabel="Disable All Lights"
              tooltipLabel="Disable All"
              tooltipDescription="Disable every scene light at once."
              onClick={onDisableAll}
              icon={<EyeOff size={12} aria-hidden="true" />}
            />
            <ToolbarIconButton
              ariaLabel="Delete Active Light"
              tooltipLabel="Delete"
              tooltipDescription="Delete the currently-active scene light after confirmation."
              onClick={onDelete}
              icon={<Trash2 size={12} aria-hidden="true" />}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar icon button — wide-mode variant. Re-uses the same chrome as
// NotesPanel's toolbar buttons so the editor's icon-action vocabulary
// stays consistent across panels.

interface ToolbarIconButtonProps {
  ariaLabel: string;
  tooltipLabel: string;
  tooltipDescription: string;
  onClick: () => void;
  icon: React.ReactNode;
}

function ToolbarIconButton({
  ariaLabel,
  tooltipLabel,
  tooltipDescription,
  onClick,
  icon,
}: ToolbarIconButtonProps): React.JSX.Element {
  return (
    <Tooltip
      side="bottom"
      stages={[
        { delay: 1000, content: <span>{tooltipLabel}</span> },
        {
          delay: 3000,
          content: (
            <div>
              <div className="font-semibold">{tooltipLabel}</div>
              <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                {tooltipDescription}
              </div>
            </div>
          ),
        },
      ]}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={onClick}
        className={[
          "inline-flex items-center justify-center",
          "w-6 h-6 rounded",
          "border transition-colors",
          "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary)",
          "hover:border-amber-500/60 hover:text-(--color-fg-primary)",
        ].join(" ")}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Kebab menu — fold Delete + Enable-All + Disable-All into a single
// trigger at narrow widths. Click-outside + Escape both close.

interface LightingKebabProps {
  onDelete: () => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
}

function LightingKebab({
  onDelete,
  onEnableAll,
  onDisableAll,
}: LightingKebabProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (!wrapperRef.current?.contains(target)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <Tooltip
        side="bottom"
        stages={[
          { delay: 1000, content: <span>More</span> },
          {
            delay: 3000,
            content: (
              <div>
                <div className="font-semibold">More actions</div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                  Reveal Enable All, Disable All, and Delete actions — folded
                  behind a kebab at narrow panel widths.
                </div>
              </div>
            ),
          },
        ]}
      >
        <button
          type="button"
          aria-label="More lighting actions"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={[
            "inline-flex items-center justify-center",
            "w-6 h-6 rounded",
            "border transition-colors",
            "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary)",
            "hover:border-amber-500/60 hover:text-(--color-fg-primary)",
          ].join(" ")}
        >
          <MoreVertical size={12} aria-hidden="true" />
        </button>
      </Tooltip>
      {open && (
        <div
          role="menu"
          className={[
            "absolute right-0 top-full mt-1 z-50",
            "min-w-[160px] py-1 rounded-md",
            "border border-(--color-border-strong) bg-zinc-900 shadow-lg",
          ].join(" ")}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onEnableAll();
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-(--color-fg-secondary) hover:bg-zinc-800 hover:text-(--color-fg-primary)"
          >
            <Eye size={12} aria-hidden="true" />
            <span>Enable All</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onDisableAll();
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-(--color-fg-secondary) hover:bg-zinc-800 hover:text-(--color-fg-primary)"
          >
            <EyeOff size={12} aria-hidden="true" />
            <span>Disable All</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onDelete();
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-(--color-fg-secondary) hover:bg-zinc-800 hover:text-(--color-fg-primary)"
          >
            <Trash2 size={12} aria-hidden="true" />
            <span>Delete Active</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Light row — extracted so the body of the panel stays declarative.
// Each row is its own flex line so it composes cleanly when stacked.
//
// Visual order:
//   [kind icon] [color swatch] [name (truncated)] [intensity] [eye toggle]
//
// `compact` drops the intensity readout. `tight` additionally drops
// the color swatch (the kind icon alone gives enough at-a-glance
// information). Both modes still expose the full data through the
// row's progressive tooltip.

interface LightRowViewProps {
  light: LightRow;
  isActive: boolean;
  enabled: boolean;
  compact: boolean;
  tight: boolean;
  onActivate: (id: string) => void;
  onToggle: (id: string) => void;
}

function LightRowView({
  light,
  isActive,
  enabled,
  compact,
  tight,
  onActivate,
  onToggle,
}: LightRowViewProps): React.JSX.Element {
  const { Icon: KindIcon, label: kindLabel } = kindIconClass(light.kind);
  const EyeIcon = enabled ? Eye : EyeOff;

  // Intensity is rendered to one decimal so torches (2.5) and the sun
  // (1.0) are both legible without truncation. Padding to 3 chars
  // ("1.0" / "10.0") keeps the column visually aligned across rows.
  const intensityLabel = light.intensity.toFixed(1);

  return (
    <div
      className={[
        "flex items-center gap-1.5 min-h-[24px] h-6 px-1.5 rounded min-w-0",
        "border transition-colors",
        isActive
          ? "bg-amber-500/10 border-amber-500"
          : "bg-transparent border-(--color-border-strong) hover:border-amber-500/40",
      ].join(" ")}
    >
      {/* Kind icon — also acts as the row's primary "activate" hit
          target. Always rendered. Disabled lights render the icon at
          reduced opacity so the row's overall state reads at a glance
          without parsing the eye toggle. */}
      <Tooltip
        side="right"
        stages={[
          { delay: 1000, content: <span>{light.name}</span> },
          {
            delay: 3000,
            content: (
              <div>
                <div className="font-semibold">{light.name}</div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                  {kindLabel} — intensity {intensityLabel}.
                  <br />
                  {light.description}
                </div>
              </div>
            ),
          },
        ]}
      >
        <button
          type="button"
          aria-label={`Activate light: ${light.name}`}
          aria-pressed={isActive}
          onClick={() => onActivate(light.id)}
          className={[
            "flex items-center justify-center w-5 h-5 rounded shrink-0",
            "transition-opacity",
            enabled ? "opacity-100" : "opacity-40",
            isActive
              ? "text-amber-400"
              : "text-(--color-fg-secondary) hover:text-(--color-fg-primary)",
          ].join(" ")}
        >
          <KindIcon size={12} aria-hidden={true} />
        </button>
      </Tooltip>

      {/* Color swatch — hidden in tight mode. Doubles as an activator
          since users tend to grab the swatch when targeting a light. */}
      {!tight ? (
        <Tooltip
          side="right"
          stages={[
            {
              delay: 1000,
              content: <span>{light.color}</span>,
            },
            {
              delay: 3000,
              content: (
                <div>
                  <div className="font-semibold">{light.name} color</div>
                  <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                    {light.color} — {light.description}
                  </div>
                </div>
              ),
            },
          ]}
        >
          <button
            type="button"
            aria-label={`Activate light: ${light.name} (color ${light.color})`}
            aria-pressed={isActive}
            onClick={() => onActivate(light.id)}
            className={[
              "w-3 h-3 rounded-sm border shrink-0",
              "transition-shadow",
              isActive
                ? "border-amber-500 shadow-[0_0_0_1px_var(--color-accent)]"
                : "border-(--color-border-strong) hover:border-amber-500/60",
            ].join(" ")}
            style={{ backgroundColor: light.color }}
          />
        </Tooltip>
      ) : null}

      {/* Name — click also activates. Truncates with ellipsis on narrow
          panels; the full name + description is in the hover tooltip.
          `wrapperClassName="flex-1 min-w-0"` makes the Tooltip's wrapper
          span itself flex-fill the row so the inner button can actually
          grow — previously the default `relative inline-flex` wrapper
          collapsed to intrinsic content width and left dead space to the
          right of the name. */}
      <Tooltip
        side="right"
        wrapperClassName="flex-1 min-w-0"
        stages={[
          { delay: 1000, content: <span>{light.name}</span> },
          {
            delay: 3000,
            content: (
              <div>
                <div className="font-semibold">{light.name}</div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                  {light.description}
                </div>
              </div>
            ),
          },
        ]}
      >
        <button
          type="button"
          aria-label={`Activate light: ${light.name}`}
          aria-pressed={isActive}
          onClick={() => onActivate(light.id)}
          className={[
            "w-full min-w-0 text-left text-[11px] truncate",
            "transition-colors",
            enabled ? "" : "opacity-60",
            isActive
              ? "text-(--color-fg-primary) font-medium"
              : "text-(--color-fg-secondary) hover:text-(--color-fg-primary)",
          ].join(" ")}
        >
          {light.name}
        </button>
      </Tooltip>

      {/* Intensity readout — hidden in compact mode. Tabular-nums so
          the digits don't jitter between rows of different values. */}
      {!compact ? (
        <Tooltip
          side="left"
          stages={[
            { delay: 1000, content: <span>Intensity {intensityLabel}</span> },
            {
              delay: 3000,
              content: (
                <div>
                  <div className="font-semibold">Intensity {intensityLabel}</div>
                  <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                    {light.name}'s brightness multiplier (0–10).
                  </div>
                </div>
              ),
            },
          ]}
        >
          <span
            aria-label={`Intensity ${intensityLabel}`}
            className={[
              "shrink-0 text-[10px] tabular-nums",
              enabled
                ? "text-(--color-fg-muted)"
                : "text-(--color-fg-muted) opacity-50",
            ].join(" ")}
          >
            {intensityLabel}
          </span>
        </Tooltip>
      ) : null}

      {/* Enable toggle — always present. Mirrors LayersPanel's eye
          toggle so the visibility/enable affordance is consistent
          across scene-list panels. */}
      <Tooltip
        side="left"
        stages={[
          {
            delay: 1000,
            content: (
              <span>{enabled ? "Disable" : "Enable"} {light.name}</span>
            ),
          },
          {
            delay: 3000,
            content: (
              <div>
                <div className="font-semibold">
                  {enabled ? "Disable" : "Enable"} {light.name}
                </div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                  {light.description}
                </div>
              </div>
            ),
          },
        ]}
      >
        <button
          type="button"
          aria-label={`Toggle light: ${light.name}`}
          aria-pressed={enabled}
          onClick={() => onToggle(light.id)}
          className={[
            "flex items-center justify-center w-5 h-5 rounded shrink-0",
            "transition-colors",
            enabled
              ? "text-(--color-fg-secondary) hover:text-(--color-fg-primary)"
              : "text-(--color-fg-muted) hover:text-(--color-fg-secondary)",
          ].join(" ")}
        >
          <EyeIcon size={12} aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "lighting",
  title: "Lighting",
  icon: <Sun size={12} />,
};

export default LightingPanel;
