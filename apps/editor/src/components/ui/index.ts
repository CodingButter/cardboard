/**
 * Editor primitive library — R2 redesign.
 *
 * Aggregator export so view code can `import { Slider, Toolbar, ... }
 * from "../components/ui"` (assuming the directory is preferred
 * over the legacy flat `ui.tsx` — note both can coexist, see
 * `../ui.tsx` for the pre-existing primitives).
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

export { PreviewHost } from "./PreviewHost";
export type { PreviewHostProps, PreviewEngine } from "./PreviewHost";
