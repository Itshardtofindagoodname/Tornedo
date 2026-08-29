/**
 * Reusable UI primitives: header/nav strip, contextual footer, search input,
 * progress bar, status badges, key/value rows, empty & error states, and the
 * overlay pieces (modal, select list, confirm). All presentation only - every
 * keybinding and data decision lives in the App component.
 */
import { useRef } from "react";
import { Box, Text, useBoxMetrics, useWindowSize, type DOMElement } from "ink";
import type { ReactNode } from "react";
import { palette, SPINNER_FRAMES } from "./theme.js";

export type Section = "search" | "downloads" | "sources" | "settings";

const SECTION_LABELS: readonly { section: Section; number: string }[] = [
  { section: "search", number: "1" },
  { section: "downloads", number: "2" },
  { section: "sources", number: "3" },
  { section: "settings", number: "4" },
];

// --- header / navigation -----------------------------------------------------

export function NavStrip({ active }: { active: Section }): ReactNode {
  return (
    <Box gap={2}>
      {SECTION_LABELS.map(({ section, number }) => {
        const isActive = section === active;
        return (
          <Box key={section}>
            <Text color={isActive ? palette.accent : palette.dim} bold={isActive}>
              {number}
            </Text>
            <Text color={isActive ? palette.text : palette.dim} bold={isActive}>
              {" "}
              {section}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

export interface HeaderProps {
  active: Section;
  right?: ReactNode;
  /** Narrow terminal: drop the tagline and the right-side global hints. */
  compact?: boolean;
}

export function Header({ active, right, compact }: HeaderProps): ReactNode {
  return (
    <Box flexDirection="column" width="100%">
      <Box height={1} paddingX={1}>
        <Text bold>
          <Text color={palette.accent}>⚡</Text>
          <Text color={palette.text}> tornedo</Text>
        </Text>
        {!compact ? <Text color={palette.dim}> | federated torrent search</Text> : null}
        <Box flexGrow={1} />
        {right ? <Box alignItems="center">{right}</Box> : null}
      </Box>
      <Box
        height={1}
        paddingX={1}
        alignItems="center"
      >
        <NavStrip active={active} />
        <Box flexGrow={1} />
        {!compact ? (
          <Text color={palette.faint}>? help | esc back | q quit</Text>
        ) : null}
      </Box>
      <HeaderSeparator />
    </Box>
  );
}

/** Thin full-width rule under the nav strip. */
function HeaderSeparator(): ReactNode {
  const ref = useRef<DOMElement | null>(null);
  const { width } = useBoxMetrics(ref);
  return (
    <Box paddingX={1}>
      <Box ref={ref} width="100%">
        <Text color={palette.border}>
          {width > 0 ? "─".repeat(width) : ""}
        </Text>
      </Box>
    </Box>
  );
}

// --- footer ------------------------------------------------------------------

export interface HintItem {
  keys: string;
  label: string;
}

export function KeyHints({ items }: { items: readonly HintItem[] }): ReactNode {
  return (
    <Box flexGrow={1}>
      {items.map((hint, i) => (
        <Box key={i} marginRight={2}>
          <Text color={palette.accent} bold>
            {hint.keys}
          </Text>
          <Text color={palette.dim}> {hint.label}</Text>
        </Box>
      ))}
    </Box>
  );
}

export function Footer({ hints }: { hints: readonly HintItem[] }): ReactNode {
  return (
    <Box
      width="100%"
      height={1}
      paddingX={1}
      alignItems="center"
      borderTop={true}
      borderStyle="single"
      borderColor={palette.border}
    >
      <KeyHints items={hints} />
    </Box>
  );
}

export function Toast({ children }: { children: ReactNode }): ReactNode {
  return (
    <Box width="100%" height={1} paddingX={1} alignItems="center">
      <Text color={palette.subtext}>{children}</Text>
    </Box>
  );
}

// --- overlay -------------------------------------------------------------------

export function Modal({ title, children, width = 64 }: { title: string; children: ReactNode; width?: number }): ReactNode {
  const { columns } = useWindowSize();
  const w = Math.max(24, Math.min(width, columns - 4));
  return (
    <Box position="absolute" top={0} left={0} width="100%" height="100%" alignItems="center" justifyContent="center">
      <Box
        flexDirection="column"
        width={w}
        borderStyle="round"
        borderColor={palette.border}
        backgroundColor={palette.surface}
        paddingX={2}
        paddingY={1}
      >
        <Text bold color={palette.accent}>
          {title}
        </Text>
        <Box marginTop={1} width="100%">
          {children}
        </Box>
      </Box>
    </Box>
  );
}

// --- text input ---------------------------------------------------------------

export interface SearchInputProps {
  value: string;
  cursor: number;
  placeholder?: string;
  /** Prompt glyph shown in front of the field. */
  prompt?: string;
}

/**
 * Renders a single line of text with a block cursor at `cursor`. When the value
 * is wider than the field, it scrolls a window around the cursor (with "..."
 * markers) instead of wrapping, so long values like directory paths stay on one
 * line and editing stays visually coherent.
 */
export function SearchInput({ value, cursor, placeholder, prompt = "›" }: SearchInputProps): ReactNode {
  const ref = useRef<DOMElement | null>(null);
  const { width } = useBoxMetrics(ref);
  if (value.length === 0) {
    return (
      <Box ref={ref} width="100%">
        <Text color={palette.accent} bold>
          {prompt}{" "}
        </Text>
        <Text backgroundColor={palette.accent} color={palette.bg}>
          {" "}
        </Text>
        {placeholder ? <Text color={palette.dim}> {placeholder}</Text> : null}
      </Box>
    );
  }
  const clamped = Math.min(Math.max(0, cursor), value.length);
  const avail = width > 0 ? Math.max(1, width - prompt.length - 2) : 32;
  return (
    <Box ref={ref} width="100%">
      <Text color={palette.accent} bold>
        {prompt}{" "}
      </Text>
      <WindowText value={value} cursor={clamped} avail={avail} />
    </Box>
  );
}

/** Single-line slice of `value` centered on `cursor`, no wrapping. */
function WindowText({ value, cursor, avail }: { value: string; cursor: number; avail: number }): ReactNode {
  const total = value.length;
  let start = 0;
  let end = total;
  if (total > avail) {
    const visible = Math.max(1, avail - 2);
    start = Math.max(0, Math.min(cursor - Math.floor(visible / 2), total - visible));
    end = start + visible;
  }
  const hasLeft = start > 0;
  const hasRight = end < total;
  return (
    <Box flexGrow={1}>
      {hasLeft ? <Text color={palette.dim}>...</Text> : null}
      <Text>{value.slice(start, cursor)}</Text>
      <Text backgroundColor={palette.accent} color={palette.bg}>
        {value[cursor] ?? " "}
      </Text>
      <Text>{value.slice(cursor + 1, end)}</Text>
      {hasRight ? <Text color={palette.dim}>...</Text> : null}
    </Box>
  );
}

// --- bits ---------------------------------------------------------------------

export function Spinner({ tick }: { tick: number }): ReactNode {
  const frame = SPINNER_FRAMES[tick % SPINNER_FRAMES.length]!;
  return <Text color={palette.accent}>{frame}</Text>;
}

export interface ProgressBarProps {
  progress: number;
  width: number;
  color?: string;
  /** Filled cell; defaults to the Tornedo bar glyph. */
  filled?: string;
  /** Empty cell. */
  empty?: string;
}

/** Deterministic, terminal-width-aware progress bar. */
export function ProgressBar({ progress, width, color = palette.accent, filled = "━", empty = "░" }: ProgressBarProps): ReactNode {
  const p = Math.max(0, Math.min(1, progress));
  const cells = Math.max(0, width);
  const filledCells = Math.min(cells, Math.floor(p * cells));
  const rest = cells - filledCells;
  return (
    <Text>
      <Text color={color}>{filled.repeat(filledCells)}</Text>
      <Text color={palette.faint}>{empty.repeat(Math.max(0, rest))}</Text>
    </Text>
  );
}

/** Small colored label pill for a state/health. */
export function StatusBadge({ text, color = palette.dim }: { text: string; color?: string }): ReactNode {
  return (
    <Text bold color={color}>
      {text}
    </Text>
  );
}

/** A label + value pair, used in detail/diagnostics/settings rows. */
export function KeyValue({
  label,
  value,
  labelWidth = 12,
  valueColor = palette.subtext,
}: {
  label: string;
  value: ReactNode;
  labelWidth?: number;
  valueColor?: string;
}): ReactNode {
  return (
    <Box height={1}>
      <Box width={labelWidth}>
        <Text color={palette.dim}>{label}</Text>
      </Box>
      <Text color={valueColor} wrap="truncate">
        {value}
      </Text>
    </Box>
  );
}

/** Subtle horizontal rule. */
export function Separator({ width = "100%" }: { width?: string | number }): ReactNode {
  return (
    <Box width={width}>
      <Text color={palette.border}>{"─".repeat(60)}</Text>
    </Box>
  );
}

/** Friendly empty-state block. */
export function EmptyState({ message, hint }: { message: string; hint?: string }): ReactNode {
  return (
    <Box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center">
      <Text color={palette.dim}>{message}</Text>
      {hint ? (
        <Box marginTop={1}>
          <Text color={palette.faint}>{hint}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

/** Error-state block used for a failed download. */
export function ErrorState({ message, children }: { message: string; children?: ReactNode }): ReactNode {
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box>
        <Text color={palette.red} bold>
          ⚠
        </Text>
        <Text color={palette.red} bold>
          {" "}
          {message}
        </Text>
      </Box>
      {children}
    </Box>
  );
}

// --- select / confirm ---------------------------------------------------------

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/** Vertical list selector. `selected` is the highlighted row index; App owns keys. */
export function SelectList<T extends string>({
  title,
  options,
  selected,
  width = 60,
  hint,
}: {
  title: string;
  options: readonly SelectOption<T>[];
  selected: number;
  width?: number;
  hint?: string;
}): ReactNode {
  return (
    <Modal title={title} width={width + 6}>
      <Box flexDirection="column" width="100%">
        {options.map((opt, i) => (
          <Box key={opt.value} backgroundColor={i === selected ? palette.accent : undefined} paddingX={1}>
            <Text color={i === selected ? palette.bg : palette.subtext} wrap="truncate">
              {i === selected ? "»" : " "} {opt.label}
            </Text>
            {opt.hint ? (
              <Text color={i === selected ? palette.bg : palette.faint} wrap="truncate">
                {" "}- {opt.hint}
              </Text>
            ) : null}
          </Box>
        ))}
        {hint ? (
          <Box marginTop={1}>
            <Text color={palette.faint}>{hint}</Text>
          </Box>
        ) : null}
      </Box>
    </Modal>
  );
}

/** Confirmation dialog. `yes` toggles the highlighted answer; App commits on confirm. */
export function Confirm({ prompt, yes, width = 60 }: { prompt: string; yes: boolean; width?: number }): ReactNode {
  return (
    <Modal title="confirm" width={width + 6}>
      <Box flexDirection="column" width="100%">
        <Text color={palette.subtext} wrap="truncate">{prompt}</Text>
        <Box marginTop={1}>
          <Box marginRight={2} backgroundColor={yes ? palette.accent : undefined}>
            <Text color={yes ? palette.bg : palette.subtext}> yes </Text>
          </Box>
          <Box backgroundColor={!yes ? palette.accent : undefined}>
            <Text color={!yes ? palette.bg : palette.subtext}> no </Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <Text color={palette.faint}>enter confirm | tab/←→ toggle | esc cancel</Text>
        </Box>
      </Box>
    </Modal>
  );
}