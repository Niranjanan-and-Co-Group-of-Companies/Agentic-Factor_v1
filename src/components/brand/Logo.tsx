// Agentic Factor mark: an A and an F sharing one stroke, with the F's stem broken by a single
// vermilion square — the piece of work the agents hand back. Traced from the approved artwork
// (2048px master) at its exact geometry. The ink follows the theme (--logo-ink: ink on light,
// paper on dark); the square is always the brand vermilion.

export const MARK_WIDTH = 1227;
export const MARK_HEIGHT = 684;
export const MARK_INK = "#201D18";
export const MARK_ACCENT = "#DF552D";

/** The mark's shapes in its own 1227×684 space: [A with the F's lower stem, F top, F middle bar, square]. */
export const MARK_PATHS = {
  a: "M338.5 0H485L711.5 456H835V668A16 16 0 0 1 819 684H665.5L600.5 547H225L161 684H0ZM411.5 161L294 411H531Z",
  fTop: "M698 228V19A19 19 0 0 1 717 0H1211A16 16 0 0 1 1227 16V123A14 14 0 0 1 1213 137H835V228Z",
  fBar: "M880 274H1168V395A15 15 0 0 1 1153 410H880Z",
  square: { x: 698, y: 274, width: 137, height: 136 },
};

export function MarkShapes({ ink = "var(--logo-ink, var(--text-primary))", accent = `var(--logo-accent, ${MARK_ACCENT})` }: { ink?: string; accent?: string }) {
  return (
    <>
      <path d={MARK_PATHS.a} fill={ink} fillRule="evenodd" />
      <path d={MARK_PATHS.fTop} fill={ink} />
      <path d={MARK_PATHS.fBar} fill={ink} />
      <rect {...MARK_PATHS.square} fill={accent} />
    </>
  );
}

/**
 * The mark alone, no background. `square` (default) centres it in a size×size box, for avatars and
 * tiles; `wide` makes `size` its height, for headers next to the name.
 */
export function LogoMark({ size = 28, title, shape = "square" }: { size?: number; title?: string; shape?: "square" | "wide" }) {
  const wide = shape === "wide";
  const pad = (MARK_WIDTH - MARK_HEIGHT) / 2;
  return (
    <svg
      width={wide ? Math.round((size * MARK_WIDTH) / MARK_HEIGHT) : size}
      height={size}
      viewBox={wide ? `0 0 ${MARK_WIDTH} ${MARK_HEIGHT}` : `0 ${-pad} ${MARK_WIDTH} ${MARK_WIDTH}`}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ flexShrink: 0, display: "block" }}
    >
      <MarkShapes />
    </svg>
  );
}

export default function Logo({ size = 28, showText = true, textSize = "1.32rem" }: { size?: number; showText?: boolean; textSize?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.42), color: "var(--text-primary)", lineHeight: 1 }}>
      <LogoMark size={Math.round(size * 0.74)} shape="wide" title={showText ? undefined : "Agentic Factor"} />
      {showText && (
        <span style={{ fontFamily: "var(--font-display)", fontSize: textSize, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
          Agentic <em style={{ fontStyle: "italic" }}>Factor</em>
        </span>
      )}
    </span>
  );
}
