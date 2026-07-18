/**
 * Original line-art SVG icons for each Nightowl Woodworks service.
 * Rendered in currentColor at a consistent 48x48 viewBox.
 */
export function ServiceIcon({ name, size = 40 }: { name: string; size?: number }) {
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  const icons: Record<string, React.ReactNode> = {
    // Circular saw blade over a board
    cutting: (
      <>
        <circle cx="24" cy="20" r="11" {...stroke} />
        <circle cx="24" cy="20" r="3" {...stroke} />
        <path d="M24 9v-4M35 20h4M24 31v4M13 20H9M32 12l3-3M32 28l3 3M16 28l-3 3M16 12l-3-3" {...stroke} />
        <path d="M6 40h36M10 40v-4h28v4" {...stroke} />
      </>
    ),
    // Board edge with banding strip peeling on
    edging: (
      <>
        <rect x="6" y="26" width="36" height="10" rx="1" {...stroke} />
        <path d="M6 26 L26 10 L42 10" {...stroke} />
        <path d="M26 10 L26 26" {...stroke} />
        <path d="M12 31h8M26 31h10" {...stroke} />
      </>
    ),
    // Cabinet
    fabrication: (
      <>
        <rect x="9" y="8" width="30" height="32" rx="2" {...stroke} />
        <path d="M24 8v32M9 24h30" {...stroke} />
        <path d="M19 16v4M29 16v4M19 30v4M29 30v4" {...stroke} />
      </>
    ),
    // Technical drawing with ruler
    custom: (
      <>
        <rect x="8" y="6" width="26" height="34" rx="2" {...stroke} />
        <path d="M13 14h12M13 20h16M13 26h10" {...stroke} />
        <path d="M30 30 L42 18l-4-4-12 12v4z" {...stroke} />
        <path d="M31 25l4 4" {...stroke} />
      </>
    ),
    // Delivery truck
    delivery: (
      <>
        <rect x="4" y="14" width="22" height="16" rx="1" {...stroke} />
        <path d="M26 20h9l7 7v3h-4" {...stroke} />
        <circle cx="12" cy="34" r="4" {...stroke} />
        <circle cx="33" cy="34" r="4" {...stroke} />
        <path d="M16 34h13M8 34H4v-4" {...stroke} />
      </>
    ),
    // Advisory — compass over blueprint
    advisory: (
      <>
        <path d="M24 6v6M24 12l-10 26M24 12l10 26" {...stroke} />
        <circle cx="24" cy="9" r="3" {...stroke} />
        <path d="M17 30a10 10 0 0 0 14 0" {...stroke} />
        <path d="M8 42h32" {...stroke} />
      </>
    ),
    // Industries
    construction: (
      <>
        <path d="M6 40h36M10 40V18l12-8v30M22 40V10l16 10v20" {...stroke} />
        <path d="M28 26h4M28 32h4M14 24h4M14 30h4" {...stroke} />
      </>
    ),
    realestate: (
      <>
        <path d="M8 40V14h14v26M22 40V22h18v18M4 40h40" {...stroke} />
        <path d="M12 20h6M12 26h6M12 32h6M27 27h4M35 27h0M27 33h4M34 33h4M34 27h4" {...stroke} />
      </>
    ),
    designers: (
      <>
        <path d="M10 38 L34 14l6 6-24 24H10v-6z" {...stroke} />
        <path d="M30 18l6 6" {...stroke} />
        <path d="M14 34l4 4" {...stroke} />
        <circle cx="38" cy="10" r="3" {...stroke} />
      </>
    ),
  };

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden focusable="false">
      {icons[name] ?? icons.fabrication}
    </svg>
  );
}
