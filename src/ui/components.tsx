/**
 * Small reusable UI atoms: header, footer/hints, toast, modal overlay and the
 * cursor-rendering text input. Presentation only — all key handling lives in
 * the App component.
 */
import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { VERSION } from "../version.js";
import { palette, SPINNER_FRAMES } from "./theme.js";

// --- layout -------------------------------------------------------------

export function Header({ right }: { right?: ReactNode }): ReactNode {
  return (
    <Box width="100%" height={1} backgroundColor={palette.accent} paddingLeft={1}>
      <Text color={palette.bg} bold>
        ⚡ tornedo
      </Text>
      <Text color={palette.bg}>
        {"  ·  "}federated torrent search v{VERSION}
      </Text>
      <Box flexGrow={1} alignItems="center" justifyContent="flex-end" paddingRight={2}>
        {right}
      </Box>
    </Box>
  );
}

export interface HintItem {
  keys: string;
  label: string;
}

export function Hints({ items }: { items: readonly HintItem[] }): ReactNode {
  return (
    <Box>
      {items.map((hint, i) => (
        <Box key={i} marginRight={2}>
          <Text color={palette.accent} bold>
            [{hint.keys}]
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
      backgroundColor={palette.panel}
      paddingLeft={1}
      alignItems="flex-start"
    >
      <Hints items={hints} />
    </Box>
  );
}

export function Toast({ children }: { children: ReactNode }): ReactNode {
  return (
    <Box width="100%" height={1} backgroundColor={palette.panel} paddingLeft={1} alignItems="center">
      <Text color={palette.subtext}>{children}</Text>
    </Box>
  );
}

// --- overlay --------------------------------------------------------------

export function Modal({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <Box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      alignItems="center"
      justifyContent="center"
    >
      <Box
        flexDirection="column"
        width={64}
        borderStyle="round"
        borderColor={palette.accent}
        backgroundColor={palette.panel}
        paddingX={2}
        paddingY={1}
      >
        <Text bold color={palette.accent}>
          {title}
        </Text>
        <Box marginTop={1}>{children}</Box>
      </Box>
    </Box>
  );
}

// --- text input --------------------------------------------------------------

export interface TextInputProps {
  value: string;
  cursor: number;
  placeholder?: string;
  accent?: string;
}

/** Renders a line of text with a block cursor at `cursor`. */
export function TextInput({ value, cursor, placeholder, accent = palette.accent }: TextInputProps): ReactNode {
  if (value.length === 0) {
    return (
      <Box flexGrow={1}>
        <Text backgroundColor={accent} color={palette.bg}>
          {" "}
        </Text>
        {placeholder ? <Text dimColor> {placeholder}</Text> : null}
      </Box>
    );
  }
  const clamped = Math.min(Math.max(0, cursor), value.length);
  return (
    <Box flexGrow={1}>
      <Text>{value.slice(0, clamped)}</Text>
      <Text backgroundColor={accent} color={palette.bg}>
        {value[clamped] ?? " "}
      </Text>
      <Text>{value.slice(clamped + 1)}</Text>
    </Box>
  );
}

// --- bits -------------------------------------------------------------------

export function Spinner({ tick }: { tick: number }): ReactNode {
  const frame = SPINNER_FRAMES[tick % SPINNER_FRAMES.length]!;
  return <Text color={palette.accent}>{frame}</Text>;
}

export function ProgressBar({ progress, width, color = palette.cyan }: { progress: number; width: number; color?: string }): ReactNode {
  const p = Math.max(0, Math.min(1, progress));
  const filled = Math.min(width, Math.floor(p * width));
  const rest = width - filled;
  return (
    <Text color={color}>
      {"█".repeat(filled)}
      <Text color={palette.faint}>{"░".repeat(Math.max(0, rest))}</Text>
    </Text>
  );
}

/** Animated determinate progress: pulses the head cell while `active`. */
export function AnimatedProgress({ progress, width, active, tick, color = palette.cyan }: { progress: number; width: number; active: boolean; tick: number; color?: string }): ReactNode {
  const p = Math.max(0, Math.min(1, progress));
  const filled = Math.min(width, Math.floor(p * width));
  const rest = width - filled;
  const parts: ReactNode[] = [];
  if (filled > 0) parts.push(<Text key="done" color={color}>{"█".repeat(filled)}</Text>);
  if (rest > 0) {
    if (active && tick % 2 === 0) {
      parts.push(<Text key="head" backgroundColor={color} color={palette.bg}>{" "}</Text>);
      parts.push(<Text key="rest" color={palette.faint}>{"░".repeat(rest - 1)}</Text>);
    } else {
      parts.push(<Text key="rest" color={palette.faint}>{"░".repeat(rest)}</Text>);
    }
  }
  return <Text>{parts}</Text>;
}

/** Indeterminate activity meter for speed/throughput. */
export function ActivityMeter({ rate, tick }: { rate: number; tick: number }): ReactNode {
  const full = Math.max(0, Math.min(12, Math.round((tick % 12) + rate * 8)));
  return (
    <Text color={palette.cyan}>
      {"▁▂▃▄▅▆▇█"[full % 8]}
      <Text color={palette.faint}>{"▁▂▃▄▅▆▇█".slice(0, 1)}</Text>
    </Text>
  );
}

// --- select / confirm ------------------------------------------------------

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
    <Modal title={title}>
      <Box flexDirection="column" width={width - 6}>
        {options.map((opt, i) => (
          <Box key={opt.value} backgroundColor={i === selected ? palette.accent : undefined}>
            <Text color={i === selected ? palette.bg : palette.subtext}>
              {i === selected ? "»" : " "} {opt.label}
            </Text>
            {opt.hint ? <Text color={i === selected ? palette.bg : palette.faint}> — {opt.hint}</Text> : null}
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
    <Modal title="confirm">
      <Box flexDirection="column" width={width - 6}>
        <Text color={palette.subtext}>{prompt}</Text>
        <Box marginTop={1}>
          <Box marginRight={2} backgroundColor={yes ? palette.accent : undefined}>
            <Text color={yes ? palette.bg : palette.subtext}> yes </Text>
          </Box>
          <Box backgroundColor={!yes ? palette.accent : undefined}>
            <Text color={!yes ? palette.bg : palette.subtext}> no </Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <Text color={palette.faint}>enter confirm · tab/←→ toggle · esc cancel</Text>
        </Box>
      </Box>
    </Modal>
  );
}
