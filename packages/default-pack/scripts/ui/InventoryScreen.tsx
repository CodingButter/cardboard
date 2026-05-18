/* @jsxImportSource preact */
import { useEffect, useRef, useState } from "preact/hooks";
import type { ItemImagesAPI } from "@two_5_d/engine";

/**
 * Inventory modal (entity-ref model).
 *
 * The carry-system stores items as ENTITIES — slots are
 * `(entityId | null)[]` and each item entity has `Item` + `Stackable`
 * (+ optional `Weapon`) components. This screen renders those slots and
 * supports drag-pick-up / drop / merge between the player's hotbar and
 * backpack containers.
 *
 * To keep the engine boundary tight the screen receives `world` + `C`
 * (component handles) live-prop refs and reads + writes through them
 * directly. No engine-side helpers are pulled in.
 */

type Slot = number | null;

export interface InventoryScreenProps {
  world: any;
  C: any;
  icons: ItemImagesAPI;
  hotbarSlots: Slot[];
  hotbarCapacity: number;
  backpackSlots: Slot[];
  backpackCapacity: number;
  activeIndex: number;
  onClose: () => void;
}

type SlotRef =
  | { kind: "hotbar"; index: number }
  | { kind: "backpack"; index: number };

function readArray(props: InventoryScreenProps, ref: SlotRef): Slot[] {
  return ref.kind === "hotbar" ? props.hotbarSlots : props.backpackSlots;
}

function readSlot(props: InventoryScreenProps, ref: SlotRef): Slot {
  return readArray(props, ref)[ref.index] ?? null;
}

function writeSlot(props: InventoryScreenProps, ref: SlotRef, value: Slot): void {
  readArray(props, ref)[ref.index] = value;
}

interface ItemView {
  itemId: string;
  displayName: string | undefined;
  type: string | undefined;
  count: number;
  max: number;
  isWeapon: boolean;
  mag: number | undefined;
  magazineSize: number | undefined;
}

function describe(entityId: number | null, world: any, C: any): ItemView | null {
  if (entityId === null) return null;
  const item = C.Item.get(entityId);
  const stack = C.Stackable.get(entityId);
  const weapon = C.Weapon.get(entityId);
  if (!item) return null;
  return {
    itemId: item.itemId,
    displayName: item.displayName,
    type: item.type,
    count: stack?.count ?? 1,
    max: stack?.max ?? 1,
    isWeapon: !!weapon,
    mag: weapon?.mag,
    magazineSize: weapon?.magazineSize,
  };
}

export function InventoryScreen(props: InventoryScreenProps) {
  const { world, C, icons, onClose } = props;
  const [cursor, setCursor] = useState<number | null>(null);
  const [cursorSource, setCursorSource] = useState<SlotRef | null>(null);
  const [version, setVersion] = useState(0);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const rootRef = useRef<HTMLDivElement>(null);

  const bump = () => setVersion((v) => v + 1);

  useEffect(() => {
    const onMove = (e: MouseEvent) => setMouse({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

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

  const tryMerge = (intoEntity: number, fromEntity: number): boolean => {
    const a = C.Item.get(intoEntity);
    const b = C.Item.get(fromEntity);
    const sa = C.Stackable.get(intoEntity);
    const sb = C.Stackable.get(fromEntity);
    if (!a || !b || !sa || !sb) return false;
    if (a.itemId !== b.itemId) return false;
    if (C.Weapon.has(intoEntity) || C.Weapon.has(fromEntity)) return false;
    const room = sa.max - sa.count;
    if (room <= 0) return false;
    const take = Math.min(room, sb.count);
    sa.count += take;
    sb.count -= take;
    if (sb.count === 0) {
      world.despawn(fromEntity);
      return true;
    }
    return false;
  };

  const handleSlotClick = (ref: SlotRef) => {
    const here = readSlot(props, ref);
    if (cursor === null) {
      if (here === null) return;
      setCursor(here);
      setCursorSource(ref);
      writeSlot(props, ref, null);
      bump();
      return;
    }
    // Cursor → slot
    if (here === null) {
      writeSlot(props, ref, cursor);
      setCursor(null);
      setCursorSource(null);
    } else if (tryMerge(here, cursor)) {
      // merged; cursor entity may already be despawned
      setCursor(null);
      setCursorSource(null);
    } else {
      // Swap
      writeSlot(props, ref, cursor);
      setCursor(here);
      setCursorSource(ref);
    }
    bump();
  };

  return (
    <div
      ref={rootRef}
      class="fixed inset-0 z-30 flex items-center justify-center bg-black/70"
      data-inventory-version={version}
      onClick={(e) => {
        if (e.target === rootRef.current) {
          // If we have a cursor item, drop it back into its source slot
          // before closing so it doesn't disappear into the void.
          if (cursor !== null && cursorSource !== null) {
            writeSlot(props, cursorSource, cursor);
          }
          onClose();
        }
      }}
    >
      <div class="cardboard-scroll flex max-h-[90vh] max-w-[90vw] flex-col gap-3 overflow-y-auto rounded-lg border border-amber-700/60 bg-zinc-900/95 p-5 shadow-2xl">
        <SlotGrid
          title="Backpack"
          cols={9}
          capacity={props.backpackCapacity}
          slots={props.backpackSlots}
          icons={icons}
          world={world}
          C={C}
          onSlotClick={(i) => handleSlotClick({ kind: "backpack", index: i })}
        />
        <SlotGrid
          title="Hotbar"
          cols={Math.max(1, props.hotbarCapacity)}
          capacity={props.hotbarCapacity}
          slots={props.hotbarSlots}
          icons={icons}
          world={world}
          C={C}
          highlightIndex={props.activeIndex}
          onSlotClick={(i) => handleSlotClick({ kind: "hotbar", index: i })}
        />
        <div class="text-center text-xs text-zinc-400">
          E/Esc close · click pick-up · click again to drop / merge
        </div>
      </div>

      {cursor !== null && (
        <FloatingStack
          entityId={cursor}
          world={world}
          C={C}
          icons={icons}
          x={mouse.x}
          y={mouse.y}
        />
      )}
    </div>
  );
}

function SlotGrid({
  title,
  cols,
  capacity,
  slots,
  icons,
  world,
  C,
  highlightIndex,
  onSlotClick,
}: {
  title: string;
  cols: number;
  capacity: number;
  slots: Slot[];
  icons: ItemImagesAPI;
  world: any;
  C: any;
  highlightIndex?: number;
  onSlotClick: (i: number) => void;
}) {
  const cells: any[] = [];
  for (let i = 0; i < capacity; i++) {
    const id = slots[i] ?? null;
    const view = describe(id, world, C);
    const isActive = highlightIndex !== undefined && i === highlightIndex;
    cells.push(
      <Slot
        key={i}
        view={view}
        icons={icons}
        accent={isActive}
        onClick={() => onSlotClick(i)}
      />,
    );
  }
  return (
    <div>
      <div class="mb-2 text-xs uppercase tracking-wider text-zinc-400">{title}</div>
      <div
        class="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {cells}
      </div>
    </div>
  );
}

function Slot({
  view,
  icons,
  accent,
  onClick,
}: {
  view: ItemView | null;
  icons: ItemImagesAPI;
  accent?: boolean;
  onClick: () => void;
}) {
  const img = view ? icons.get(view.itemId) : null;
  const title = view
    ? `${view.displayName ?? view.itemId}${view.count > 1 ? ` ×${view.count}` : ""}`
    : "";
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      class={`relative h-12 w-12 rounded border ${
        accent ? "border-amber-400" : "border-zinc-700"
      } ${
        view ? "bg-zinc-800 hover:border-amber-400" : "bg-zinc-950 hover:border-zinc-500"
      } transition-colors`}
    >
      {img ? (
        <img
          src={img.src}
          alt=""
          class="absolute inset-1 h-[calc(100%-0.5rem)] w-[calc(100%-0.5rem)] object-contain"
        />
      ) : null}
      {view && view.count > 1 && (
        <span class="absolute bottom-0 right-1 text-xs font-bold text-white drop-shadow">
          {view.count}
        </span>
      )}
      {view && view.isWeapon && view.magazineSize ? (
        <span class="absolute bottom-0 left-1 text-[10px] font-bold text-amber-300 drop-shadow">
          {view.mag ?? 0}
        </span>
      ) : null}
    </button>
  );
}

function FloatingStack({
  entityId,
  world,
  C,
  icons,
  x,
  y,
}: {
  entityId: number;
  world: any;
  C: any;
  icons: ItemImagesAPI;
  x: number;
  y: number;
}) {
  const view = describe(entityId, world, C);
  if (!view) return null;
  const img = icons.get(view.itemId);
  return (
    <div
      class="pointer-events-none fixed z-40 h-12 w-12 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${x}px`, top: `${y}px` }}
    >
      {img && <img src={img.src} alt="" class="h-full w-full object-contain drop-shadow-lg" />}
      {view.count > 1 && (
        <span class="absolute bottom-0 right-1 text-xs font-bold text-white drop-shadow">
          {view.count}
        </span>
      )}
      {view.isWeapon && view.magazineSize ? (
        <span class="absolute bottom-0 left-1 text-[10px] font-bold text-amber-300 drop-shadow">
          {view.mag ?? 0}
        </span>
      ) : null}
    </div>
  );
}
