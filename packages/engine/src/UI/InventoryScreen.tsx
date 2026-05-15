/* @jsxImportSource preact */
import { useEffect, useRef, useState } from "preact/hooks";
import type { EquipSlot, ItemDef, ItemStack, PackManifest } from "AssetPack";
import { EQUIP_SLOTS } from "AssetPack";
import { defaultStackMax, quickTransfer, type InventoryShape } from "Libs/Inventory";
import type ItemImages from "ItemImages";

/**
 * Drag-drop inventory modal.
 *
 * - Bag = 27 slots in a 3×9 grid (Minecraft layout).
 * - Hotbar = 9 slots, one row, also visible on the main HUD.
 * - Equipment = 10 named slots arranged in two columns to either side
 *   of a placeholder character silhouette in the middle.
 *
 * Interaction model (Minecraft-ish):
 *   - Click empty slot with empty cursor → no-op.
 *   - Click full slot with empty cursor → pick up entire stack.
 *   - Click empty slot with held stack → place entire stack.
 *   - Click full slot with held stack:
 *       - same item id, both stackable → merge as much as fits, keep
 *         overflow on cursor.
 *       - different items, or weapons → swap.
 *   - Equipment slots reject items whose `equipSlot` doesn't match.
 *
 * The inventory is mutated in place (it's an ECS component). We bump
 * a `version` state per mutation so Preact re-renders.
 */

export interface InventoryScreenProps {
  inventory: InventoryShape;
  manifest: PackManifest;
  icons: ItemImages;
  onClose: () => void;
}

type SlotRef =
  | { kind: "bag"; index: number }
  | { kind: "hotbar"; index: number }
  | { kind: "equipment"; slot: EquipSlot };

function readSlot(inv: InventoryShape, ref: SlotRef): ItemStack | null {
  switch (ref.kind) {
    case "bag":
      return inv.bag[ref.index] ?? null;
    case "hotbar":
      return inv.hotbar[ref.index] ?? null;
    case "equipment":
      return inv.equipment[ref.slot] ?? null;
  }
}

function writeSlot(inv: InventoryShape, ref: SlotRef, stack: ItemStack | null): void {
  switch (ref.kind) {
    case "bag":
      inv.bag[ref.index] = stack;
      return;
    case "hotbar":
      inv.hotbar[ref.index] = stack;
      return;
    case "equipment":
      inv.equipment[ref.slot] = stack;
      return;
  }
}

/**
 * `true` if `stack` is allowed to occupy `ref`. Equipment enforces the
 * item's `equipSlot`; bag/hotbar accept anything.
 */
function slotAccepts(ref: SlotRef, stack: ItemStack, manifest: PackManifest): boolean {
  if (ref.kind !== "equipment") return true;
  const def = manifest.items?.[stack.itemId];
  return def?.equipSlot === ref.slot;
}

export function InventoryScreen({ inventory, manifest, icons, onClose }: InventoryScreenProps) {
  const [cursor, setCursor] = useState<ItemStack | null>(null);
  /** Slot the held cursor was picked up from — drives scroll-to-split. */
  const [cursorSource, setCursorSource] = useState<SlotRef | null>(null);
  const [version, setVersion] = useState(0);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const rootRef = useRef<HTMLDivElement>(null);

  const bump = () => setVersion((v) => v + 1);

  // Track mouse position for the floating cursor stack.
  useEffect(() => {
    const onMove = (e: MouseEvent) => setMouse({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  // Escape / E to close. Capture phase so we win over the game's
  // listeners (which would otherwise re-toggle on the same keypress).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape" || e.code === "KeyE") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const handleSlotClick = (ref: SlotRef, e: MouseEvent) => {
    // ---- Shift-click: quick transfer (no cursor required) ----
    if (e.shiftKey && cursor === null) {
      const kind = ref.kind;
      const key = kind === "equipment" ? ref.slot : ref.index;
      quickTransfer(inventory, manifest, kind, key);
      bump();
      return;
    }

    // ---- Ctrl/Cmd click ----
    if (e.ctrlKey || e.metaKey) {
      const here = readSlot(inventory, ref);
      if (cursor === null) {
        // Grab half (rounded up).
        if (!here) return;
        const def = manifest.items?.[here.itemId];
        if (def?.type === "weapon" || here.count <= 1) {
          // Can't split — just grab the whole thing.
          setCursor(here);
          setCursorSource(ref);
          writeSlot(inventory, ref, null);
        } else {
          const half = Math.ceil(here.count / 2);
          const taken: ItemStack = { itemId: here.itemId, count: half };
          if (here.mag !== undefined) taken.mag = here.mag;
          here.count -= half;
          setCursor(taken);
          setCursorSource(ref);
        }
        bump();
        return;
      }
      // Cursor held: place one (or onto matching stack).
      if (!slotAccepts(ref, cursor, manifest)) return;
      if (here === null) {
        const placed: ItemStack = { itemId: cursor.itemId, count: 1 };
        if (cursor.mag !== undefined) placed.mag = cursor.mag;
        writeSlot(inventory, ref, placed);
        cursor.count -= 1;
        if (cursor.count === 0) {
          setCursor(null);
          setCursorSource(null);
        } else setCursor({ ...cursor });
      } else if (here.itemId === cursor.itemId) {
        const def = manifest.items?.[here.itemId];
        const stackMax = def ? defaultStackMax(def) : 1;
        if (def?.type !== "weapon" && here.count < stackMax) {
          here.count += 1;
          cursor.count -= 1;
          if (cursor.count === 0) {
            setCursor(null);
            setCursorSource(null);
          } else setCursor({ ...cursor });
        }
      }
      bump();
      return;
    }

    // ---- Default click: pickup / place / merge / swap ----
    const here = readSlot(inventory, ref);
    if (cursor === null) {
      if (here === null) return;
      setCursor(here);
      setCursorSource(ref);
      writeSlot(inventory, ref, null);
    } else {
      if (!slotAccepts(ref, cursor, manifest)) return;
      if (here === null) {
        writeSlot(inventory, ref, cursor);
        setCursor(null);
        setCursorSource(null);
      } else if (here.itemId === cursor.itemId) {
        const def = manifest.items?.[here.itemId];
        const stackMax = def ? defaultStackMax(def) : 1;
        const room = stackMax - here.count;
        if (room <= 0 || def?.type === "weapon") {
          writeSlot(inventory, ref, cursor);
          setCursor(here);
          setCursorSource(ref);
        } else {
          const take = Math.min(room, cursor.count);
          here.count += take;
          cursor.count -= take;
          if (cursor.count === 0) {
            setCursor(null);
            setCursorSource(null);
          } else setCursor({ ...cursor });
        }
      } else {
        if (ref.kind === "equipment" && !slotAccepts(ref, cursor, manifest)) return;
        writeSlot(inventory, ref, cursor);
        setCursor(here);
        setCursorSource(ref);
      }
    }
    bump();
  };

  // Scroll while holding a stack — give 1 back to the source (scroll
  // down) or take 1 more from it (scroll up). Lets the player land a
  // precise quantity after grabbing a stack or half-stack.
  const handleModalWheel = (e: WheelEvent) => {
    if (!cursor || !cursorSource) return;
    if (e.deltaY === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const dir = Math.sign(e.deltaY);
    const source = readSlot(inventory, cursorSource);
    if (dir > 0) {
      // Give one back to the source.
      if (source === null) {
        // Source slot is empty — drop one back in as a fresh stack.
        if (slotAccepts(cursorSource, cursor, manifest)) {
          const placed: ItemStack = { itemId: cursor.itemId, count: 1 };
          if (cursor.mag !== undefined) placed.mag = cursor.mag;
          writeSlot(inventory, cursorSource, placed);
          cursor.count -= 1;
        }
      } else if (source.itemId === cursor.itemId) {
        const def = manifest.items?.[source.itemId];
        const stackMax = def ? defaultStackMax(def) : 1;
        if (def?.type !== "weapon" && source.count < stackMax) {
          source.count += 1;
          cursor.count -= 1;
        }
      }
    } else {
      // Take one more from the source.
      if (source && source.itemId === cursor.itemId && source.count > 0) {
        const def = manifest.items?.[source.itemId];
        if (def?.type !== "weapon") {
          source.count -= 1;
          cursor.count += 1;
          if (source.count === 0) writeSlot(inventory, cursorSource, null);
        }
      }
    }
    if (cursor.count <= 0) {
      setCursor(null);
      setCursorSource(null);
    } else setCursor({ ...cursor });
    bump();
  };

  return (
    <div
      ref={rootRef}
      class="fixed inset-0 z-30 flex items-center justify-center bg-black/70"
      data-inventory-version={version}
      onClick={(e) => {
        // Click on the backdrop closes the modal (only the outer div,
        // not children with their own handlers).
        if (e.target === rootRef.current) onClose();
      }}
      onWheel={handleModalWheel}
    >
      <div class="flex flex-col gap-3 rounded-lg border border-amber-700/60 bg-zinc-900/95 p-5 shadow-2xl">
        <div class="flex items-start gap-5">
          <CharacterPanel
            inventory={inventory}
            manifest={manifest}
            icons={icons}
            onSlotClick={handleSlotClick}
          />
          <BagGrid
            inventory={inventory}
            manifest={manifest}
            icons={icons}
            onSlotClick={handleSlotClick}
          />
        </div>
        <HotbarRow
          inventory={inventory}
          manifest={manifest}
          icons={icons}
          onSlotClick={handleSlotClick}
        />
        <div class="text-center text-xs text-zinc-400">
          E/Esc close · click pick-up · shift+click quick-transfer ·
          ctrl+click grab half / place one · scroll while holding to split
        </div>
      </div>

      {cursor && (
        <FloatingStack stack={cursor} manifest={manifest} icons={icons} x={mouse.x} y={mouse.y} />
      )}
    </div>
  );
}

/* ─── Subcomponents ─────────────────────────────────────────────────── */

interface SlotProps {
  stack: ItemStack | null;
  def: ItemDef | undefined;
  icons: ItemImages;
  onClick: (e: MouseEvent) => void;
  /** Optional label shown in the empty slot (e.g. "Helmet"). */
  placeholder?: string;
  /** Slot accent color when empty. */
  accentEmpty?: string;
}

function Slot({ stack, def, icons, onClick, placeholder, accentEmpty }: SlotProps) {
  const img = stack ? icons.get(stack.itemId) : null;
  const title = stack
    ? `${def?.name ?? stack.itemId}${stack.count > 1 ? ` ×${stack.count}` : ""}`
    : placeholder ?? "";
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      class={`relative h-12 w-12 rounded border border-zinc-700 ${
        stack ? "bg-zinc-800 hover:border-amber-400" : "bg-zinc-950 hover:border-zinc-500"
      } transition-colors`}
      style={accentEmpty && !stack ? { background: accentEmpty } : undefined}
    >
      {img ? (
        <img src={img.src} alt="" class="absolute inset-1 h-[calc(100%-0.5rem)] w-[calc(100%-0.5rem)] object-contain" />
      ) : placeholder ? (
        <span class="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-wide text-zinc-500">
          {placeholder}
        </span>
      ) : null}
      {stack && stack.count > 1 && (
        <span class="absolute bottom-0 right-1 text-xs font-bold text-white drop-shadow">
          {stack.count}
        </span>
      )}
      {stack && def?.type === "weapon" && def.weapon?.magazineSize && (
        <span class="absolute bottom-0 left-1 text-[10px] font-bold text-amber-300 drop-shadow">
          {stack.mag ?? 0}
        </span>
      )}
    </button>
  );
}

function BagGrid({
  inventory,
  manifest,
  icons,
  onSlotClick,
}: {
  inventory: InventoryShape;
  manifest: PackManifest;
  icons: ItemImages;
  onSlotClick: (ref: SlotRef, e: MouseEvent) => void;
}) {
  return (
    <div>
      <div class="mb-2 text-xs uppercase tracking-wider text-zinc-400">Backpack</div>
      <div class="grid grid-cols-9 gap-1">
        {inventory.bag.map((stack, i) => (
          <Slot
            key={i}
            stack={stack}
            def={stack ? manifest.items?.[stack.itemId] : undefined}
            icons={icons}
            onClick={(e) => onSlotClick({ kind: "bag", index: i }, e)}
          />
        ))}
      </div>
    </div>
  );
}

function HotbarRow({
  inventory,
  manifest,
  icons,
  onSlotClick,
}: {
  inventory: InventoryShape;
  manifest: PackManifest;
  icons: ItemImages;
  onSlotClick: (ref: SlotRef, e: MouseEvent) => void;
}) {
  return (
    <div>
      <div class="mb-2 text-xs uppercase tracking-wider text-zinc-400">Hotbar</div>
      <div class="flex gap-1">
        {inventory.hotbar.map((stack, i) => {
          const isActive = i === inventory.activeHotbarIndex;
          return (
            <div key={i} class="relative">
              <Slot
                stack={stack}
                def={stack ? manifest.items?.[stack.itemId] : undefined}
                icons={icons}
                onClick={(e) => onSlotClick({ kind: "hotbar", index: i }, e)}
              />
              <span
                class={`pointer-events-none absolute -top-1 left-1 text-[10px] font-bold ${
                  isActive ? "text-amber-300" : "text-zinc-500"
                }`}
              >
                {i + 1}
              </span>
              {isActive && (
                <div class="pointer-events-none absolute inset-0 rounded border-2 border-amber-400" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Body-shaped equipment panel. Two columns of slots flanking a stub
 * silhouette so the layout reads as "what's on the character." Slot
 * order follows `EQUIP_SLOTS`; visual arrangement here is fixed.
 */
function CharacterPanel({
  inventory,
  manifest,
  icons,
  onSlotClick,
}: {
  inventory: InventoryShape;
  manifest: PackManifest;
  icons: ItemImages;
  onSlotClick: (ref: SlotRef, e: MouseEvent) => void;
}) {
  const slot = (s: EquipSlot, placeholder: string) => {
    const stack = inventory.equipment[s] ?? null;
    return (
      <Slot
        stack={stack}
        def={stack ? manifest.items?.[stack.itemId] : undefined}
        icons={icons}
        onClick={(e) => onSlotClick({ kind: "equipment", slot: s }, e)}
        placeholder={placeholder}
      />
    );
  };

  // Three columns — armor / silhouette+jewelry / hands. Middle column
  // shows a humanoid figure (decorative) with amulet + paired rings
  // beneath. Wide enough for two ring slots side-by-side.
  return (
    <div>
      <div class="mb-2 text-xs uppercase tracking-wider text-zinc-400">Equipment</div>
      <div class="flex items-start gap-2">
        <div class="flex flex-col gap-1">
          {slot("helmet", "Head")}
          {slot("chest", "Chest")}
          {slot("gloves", "Gloves")}
          {slot("legs", "Legs")}
          {slot("feet", "Feet")}
        </div>
        <div class="flex flex-col items-center gap-1 rounded border border-zinc-800 bg-zinc-950/50 px-3 py-2">
          <CharacterSilhouette />
          {slot("amulet", "Amulet")}
          <div class="flex gap-1">
            {slot("ring1", "Ring")}
            {slot("ring2", "Ring")}
          </div>
        </div>
        <div class="flex flex-col gap-1">
          {slot("mainHand", "Main")}
          {slot("offHand", "Off")}
        </div>
      </div>
      <div class="mt-1 text-[10px] text-zinc-500">{EQUIP_SLOTS.length} slots</div>
    </div>
  );
}

/** Decorative humanoid figure for the equipment panel. Pure SVG. */
function CharacterSilhouette() {
  return (
    <svg
      viewBox="0 0 40 64"
      class="h-32 w-16 text-zinc-500"
      fill="currentColor"
      aria-hidden="true"
    >
      {/* Head */}
      <circle cx="20" cy="9" r="6" />
      {/* Neck */}
      <rect x="18" y="14" width="4" height="3" />
      {/* Torso */}
      <path d="M11 18 Q11 17 12 17 L28 17 Q29 17 29 18 L29 36 Q29 37 28 37 L12 37 Q11 37 11 36 Z" />
      {/* Arms */}
      <rect x="6" y="19" width="4" height="18" rx="1.5" />
      <rect x="30" y="19" width="4" height="18" rx="1.5" />
      {/* Hands */}
      <circle cx="8" cy="40" r="2.5" />
      <circle cx="32" cy="40" r="2.5" />
      {/* Legs */}
      <rect x="13" y="38" width="6" height="22" rx="1.5" />
      <rect x="21" y="38" width="6" height="22" rx="1.5" />
      {/* Feet */}
      <ellipse cx="16" cy="62" rx="4" ry="1.5" />
      <ellipse cx="24" cy="62" rx="4" ry="1.5" />
    </svg>
  );
}

function FloatingStack({
  stack,
  manifest,
  icons,
  x,
  y,
}: {
  stack: ItemStack;
  manifest: PackManifest;
  icons: ItemImages;
  x: number;
  y: number;
}) {
  const img = icons.get(stack.itemId);
  const def = manifest.items?.[stack.itemId];
  return (
    <div
      class="pointer-events-none fixed z-40 h-12 w-12 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${x}px`, top: `${y}px` }}
    >
      {img && <img src={img.src} alt="" class="h-full w-full object-contain drop-shadow-lg" />}
      {stack.count > 1 && (
        <span class="absolute bottom-0 right-1 text-xs font-bold text-white drop-shadow">
          {stack.count}
        </span>
      )}
      {def?.type === "weapon" && def.weapon?.magazineSize && (
        <span class="absolute bottom-0 left-1 text-[10px] font-bold text-amber-300 drop-shadow">
          {stack.mag ?? 0}
        </span>
      )}
    </div>
  );
}
