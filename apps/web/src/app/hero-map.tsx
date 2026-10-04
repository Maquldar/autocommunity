/**
 * Decorative city-map illustration for the landing page: streets, a route converging on a driver
 * who asked for help. Pure SVG + tokens, so it follows the theme. Pins use primary/neutral —
 * SOS red is not used decoratively.
 */
export function HeroMap({ label }: { label: string }) {
  return (
    <figure className="relative mx-auto w-full max-w-md lg:max-w-none">
      <div
        aria-hidden="true"
        className="absolute -inset-4 -z-10 rounded-[2.5rem] sm:-inset-6 bg-[radial-gradient(60%_60%_at_60%_40%,color-mix(in_srgb,var(--primary)_18%,transparent),transparent)]"
      />
      <svg
        viewBox="0 0 400 320"
        role="img"
        aria-label={label}
        className="h-auto w-full overflow-hidden rounded-3xl border bg-card shadow-xl"
      >
        <rect width="400" height="320" fill="var(--muted)" />
        {/* city blocks */}
        <g fill="var(--card)">
          <rect x="18" y="18" width="104" height="70" rx="10" />
          <rect x="142" y="18" width="118" height="70" rx="10" />
          <rect x="280" y="18" width="102" height="118" rx="10" />
          <rect x="18" y="108" width="70" height="98" rx="10" />
          <rect x="108" y="108" width="152" height="98" rx="10" />
          <rect x="18" y="226" width="150" height="76" rx="10" />
          <rect x="188" y="226" width="72" height="76" rx="10" />
          <rect x="280" y="156" width="102" height="146" rx="10" />
        </g>
        {/* park */}
        <rect x="108" y="108" width="72" height="98" rx="10" fill="color-mix(in srgb, var(--success) 16%, var(--card))" />
        {/* main avenue */}
        <path d="M0 216 C 120 200, 220 236, 400 146" fill="none" stroke="var(--card)" strokeWidth="14" />
        <path d="M0 216 C 120 200, 220 236, 400 146" fill="none" stroke="var(--border)" strokeWidth="2" strokeDasharray="8 10" />
        {/* routes of helpers */}
        <path d="M62 54 L 132 54 L 132 98 L 270 98 L 270 186" fill="none" stroke="var(--primary)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 11" />
        <path d="M330 290 L 330 214 L 290 214" fill="none" stroke="var(--primary)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 11" />

        {/* driver who needs help */}
        <circle cx="270" cy="206" r="34" fill="var(--primary)" opacity="0.12" />
        <circle cx="270" cy="206" r="20" fill="var(--primary)" opacity="0.2" />
        <circle cx="270" cy="206" r="11" fill="var(--primary)" stroke="var(--card)" strokeWidth="4" />

        {/* helpers */}
        <g>
          <circle cx="62" cy="54" r="15" fill="var(--avatar-2)" stroke="var(--card)" strokeWidth="3" />
          <text x="62" y="59" textAnchor="middle" fontSize="13" fontWeight="600" fill="#fff">AK</text>
        </g>
        <g>
          <circle cx="330" cy="290" r="15" fill="var(--avatar-3)" stroke="var(--card)" strokeWidth="3" />
          <text x="330" y="295" textAnchor="middle" fontSize="13" fontWeight="600" fill="#fff">ДС</text>
        </g>
        <g>
          <circle cx="60" cy="150" r="12" fill="var(--avatar-8)" stroke="var(--card)" strokeWidth="3" />
          <circle cx="216" cy="272" r="12" fill="var(--avatar-6)" stroke="var(--card)" strokeWidth="3" />
          <circle cx="332" cy="62" r="12" fill="var(--avatar-5)" stroke="var(--card)" strokeWidth="3" />
        </g>
      </svg>
    </figure>
  );
}
