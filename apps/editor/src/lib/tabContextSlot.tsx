import React from "react";

/**
 * tabContextSlot — shared "right-of-tabs" surface for the active view.
 *
 * Pattern:
 *   - `<TabContextSlotProvider/>` mounts above both the tab strip and
 *     the active view body. It owns a single React state slot holding
 *     whatever ReactNode the active view registered.
 *   - The tab strip reads the current slot value via `useTabContextSlotValue()`
 *     and passes it to `TabStrip`'s `rightSlot` prop.
 *   - The active view calls `useTabContextSlot(<MyContent .../>)` on
 *     mount; the effect writes the node into the provider, and the
 *     cleanup clears it on unmount. The slot returns to empty whenever
 *     no view is registering content, so other tabs implicitly read
 *     "nothing" without having to opt out.
 *
 * Why a render-prop hook over a portal:
 *   - Portals reparent DOM, which fights React 19's concurrent rendering
 *     when the donor unmounts mid-transition (we'd briefly see stale
 *     content in the slot).
 *   - State-in-context lets us pass the ReactNode through normal
 *     reconciliation: the slot host renders the latest value, full stop.
 *   - The hook contract is "the JSX you pass renders in the slot for as
 *     long as your view is mounted" — predictable, no out-of-tree
 *     surprises.
 */

interface TabContextSlotApi {
  /** Replace the slot's current content. Pass null to clear. */
  setSlot: (node: React.ReactNode) => void;
}

const TabContextSlotApiContext = React.createContext<TabContextSlotApi | null>(
  null,
);

const TabContextSlotValueContext = React.createContext<React.ReactNode>(null);

export interface TabContextSlotProviderProps {
  children: React.ReactNode;
}

/**
 * Mount this above any component that wants to either *read* the slot
 * (the tab strip) or *write* to it (an active view). The shell mounts
 * it once at the top, so both halves of the contract live under the
 * same provider instance.
 */
export function TabContextSlotProvider({
  children,
}: TabContextSlotProviderProps) {
  const [slot, setSlot] = React.useState<React.ReactNode>(null);
  // `setSlot` is stable across renders (React guarantees state setter
  // stability), so wrapping it in a memoised api object keeps the
  // provider value reference-stable too — consumers that read the api
  // don't re-render when the slot value changes.
  const api = React.useMemo<TabContextSlotApi>(() => ({ setSlot }), []);
  return (
    <TabContextSlotApiContext.Provider value={api}>
      <TabContextSlotValueContext.Provider value={slot}>
        {children}
      </TabContextSlotValueContext.Provider>
    </TabContextSlotApiContext.Provider>
  );
}

/**
 * Read the current slot value. Used by `PrimaryTabs` to forward the
 * node to `TabStrip`'s `rightSlot`. Returns `null` when no provider is
 * mounted so the call site is safe to use in isolated harnesses
 * (StyleGuide, tests) without crashing.
 */
export function useTabContextSlotValue(): React.ReactNode {
  return React.useContext(TabContextSlotValueContext);
}

/**
 * Register a node as the active view's tab-row right slot.
 *
 * Usage in a view:
 *
 *     export function MyView() {
 *       useTabContextSlot(<MySlotControl />);
 *       return <div>...</div>;
 *     }
 *
 * The node renders in the tab strip's right slot for as long as `MyView`
 * is mounted. When the view unmounts (or the user switches tabs), the
 * slot is cleared.
 *
 * Calling outside a provider is a no-op so views can be rendered in
 * harnesses (StyleGuide previews, tests) without wiring the provider.
 */
export function useTabContextSlot(node: React.ReactNode): void {
  const api = React.useContext(TabContextSlotApiContext);
  React.useEffect(() => {
    if (!api) return;
    api.setSlot(node);
    return () => {
      api.setSlot(null);
    };
  }, [api, node]);
}
