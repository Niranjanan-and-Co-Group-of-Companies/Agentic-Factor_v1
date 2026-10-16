// Agentic Factor mark: three lines of work stepping down, finished by a vermilion dot —
// work being done. Colours follow the theme (ink tile on paper, paper tile on ink).

export function LogoMark({ size = 28, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} style={{ flexShrink: 0, display: "block" }}>
      <rect width="32" height="32" rx="8" fill="var(--text-primary)" />
      <rect x="7.5" y="8.5" width="17" height="3" rx="1.5" fill="var(--bg-primary)" />
      <rect x="7.5" y="14.5" width="12" height="3" rx="1.5" fill="var(--bg-primary)" />
      <rect x="7.5" y="20.5" width="7" height="3" rx="1.5" fill="var(--bg-primary)" />
      <circle cx="22" cy="22" r="2.75" fill="var(--accent)" />
    </svg>
  );
}

export default function Logo({ size = 28, showText = true, textSize = "1.32rem" }: { size?: number; showText?: boolean; textSize?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, color: "var(--text-primary)", lineHeight: 1 }}>
      <LogoMark size={size} title={showText ? undefined : "Agentic Factor"} />
      {showText && (
        <span style={{ fontFamily: "var(--font-display)", fontSize: textSize, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
          Agentic <em style={{ fontStyle: "italic" }}>Factor</em>
        </span>
      )}
    </span>
  );
}
