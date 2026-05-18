/**
 * Editor primitive library — R2 redesign.
 *
 * Aggregator export so view code can `import { Slider, Toolbar, ... }
 * from "../components/ui"` (assuming the directory is preferred
 * over the legacy flat `ui.tsx` — note both can coexist, see
 * `../ui.tsx` for the pre-existing primitives).
 *
 * Phase 1 of the editor redesign adds the bolded entries below to the
 * existing library. Each new primitive references the design-system
 * `@apply` classes in `apps/editor/src/styles/design-system.css` —
 * retunes happen there, not inside the component file.
 */

export { Slider, ToggleSwitch, SegmentedControl } from "./controls";
export type {
  SliderProps,
  ToggleSwitchProps,
  SegmentedControlProps,
  SegmentedControlOption,
} from "./controls";

export { PropertyRow } from "./PropertyRow";
export type { PropertyRowProps } from "./PropertyRow";

export { PanelHeader } from "./PanelHeader";
export type { PanelHeaderProps } from "./PanelHeader";

export { CollapsibleSection } from "./CollapsibleSection";
export type { CollapsibleSectionProps } from "./CollapsibleSection";

export { ColorChip } from "./ColorChip";
export type { ColorChipProps } from "./ColorChip";

export { Badge } from "./Badge";
export type { BadgeProps, BadgeVariant } from "./Badge";

export { StatusPill } from "./StatusPill";
export type { StatusPillProps, StatusPillVariant } from "./StatusPill";

export { IconButton } from "./IconButton";
export type { IconButtonProps } from "./IconButton";

export { TabStrip } from "./TabStrip";
export type { TabStripProps, TabDescriptor } from "./TabStrip";

export { DropdownMenu } from "./DropdownMenu";
export type { DropdownMenuProps, DropdownOption } from "./DropdownMenu";

export { Select } from "./Select";
export type { SelectProps, SelectOption } from "./Select";

export { ProgressBar } from "./ProgressBar";
export type { ProgressBarProps } from "./ProgressBar";

export { LogPanel } from "./LogPanel";
export type { LogPanelProps, LogLine, LogLineType } from "./LogPanel";

export { StatsBlock } from "./StatsBlock";
export type { StatsBlockProps } from "./StatsBlock";

export { KeyValueList } from "./KeyValueList";
export type { KeyValueListProps, KeyValueRow } from "./KeyValueList";

export { FpsGraph, PieChart, ChartLegend } from "./charts";
export type {
  FpsGraphProps,
  PieChartProps,
  PieSegment,
  ChartLegendProps,
  ChartLegendItem,
  ChartVariant,
} from "./charts";

export { FilePicker } from "./FilePicker";
export type { FilePickerProps } from "./FilePicker";

export { ScrollArea } from "./ScrollArea";
export type { ScrollAreaProps } from "./ScrollArea";

export { Toolbar } from "./Toolbar";
export type { ToolbarProps, ToolbarGroup } from "./Toolbar";

export { EmptyState } from "./EmptyState";
export type { EmptyStateProps } from "./EmptyState";

export { Tooltip } from "./Tooltip";
export type { TooltipProps } from "./Tooltip";

export { TopBar } from "./TopBar";
export type {
  TopBarProps,
  TopBarProject,
  TopBarScene,
  SaveState,
} from "./TopBar";

export { StatusBar } from "./StatusBar";
export type { StatusBarProps, StatusBarSection } from "./StatusBar";

export { PreviewHost } from "./PreviewHost";
export type { PreviewHostProps, PreviewEngine } from "./PreviewHost";

/* ────── Phase 1 additions ──────────────────────────────────────── */

export { Button } from "./Button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./Button";

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./Card";
export type { CardProps } from "./Card";

export { Divider } from "./Divider";
export type { DividerProps } from "./Divider";

export { TextInput } from "./TextInput";
export type { TextInputProps } from "./TextInput";

export { Textarea } from "./Textarea";
export type { TextareaProps } from "./Textarea";

export { NumberInput } from "./NumberInput";
export type { NumberInputProps } from "./NumberInput";

export { SearchInput } from "./SearchInput";
export type { SearchInputProps } from "./SearchInput";

export { Chip } from "./Chip";
export type { ChipProps, ChipVariant } from "./Chip";

export { LiveIndicator } from "./LiveIndicator";
export type { LiveIndicatorProps } from "./LiveIndicator";

export { AssetThumbnail } from "./AssetThumbnail";
export type { AssetThumbnailProps } from "./AssetThumbnail";

export { Breadcrumb } from "./Breadcrumb";
export type { BreadcrumbProps, BreadcrumbSegment } from "./Breadcrumb";

export { Kbd } from "./Kbd";
export type { KbdProps } from "./Kbd";

export { PreviewFrame } from "./PreviewFrame";
export type { PreviewFrameProps } from "./PreviewFrame";

export { TogglePill } from "./TogglePill";
export type { TogglePillProps, TogglePillOption } from "./TogglePill";

export { ThreeRailLayout, TwoRailLayout } from "./RailLayout";
export type { ThreeRailLayoutProps, TwoRailLayoutProps } from "./RailLayout";

// NOTE: The legacy `ui.tsx` SHADOWS this barrel when consumers import
// from "../components/ui" (no `/index`). The new `Modal` below is
// intentionally NOT re-exported here to avoid two `Modal`s in the
// same module graph — Phase 1 callers should import it directly from
// `./Modal` to bypass the shadow. See `views/HomeScreen.tsx` for the
// pattern.
