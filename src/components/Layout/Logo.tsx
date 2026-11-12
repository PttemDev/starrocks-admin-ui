interface Props {
  /** Tile edge in px; everything inside scales from it. */
  size?: number;
}

/**
 * App mark: a four-point star on the indigo tile. Drawn as an SVG rather than
 * an icon-font glyph so it stays crisp at both the 28px header size and the
 * 48px login size, and so the gradient is part of the mark itself.
 */
export default function Logo({ size = 28 }: Props) {
  const id = `sr-logo-${size}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="StarRocks Manager"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366f1" />
          <stop offset="1" stopColor="#818cf8" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${id})`} />
      {/* Four-point star: straight points with concave sides. */}
      <path
        d="M18 7.2c0 3.1 2.4 5.5 5.5 5.5.7 0 1.3.6 1.3 1.3s-.6 1.3-1.3 1.3c-3.1 0-5.5 2.4-5.5 5.5 0 .7-.6 1.3-1.3 1.3s-1.3-.6-1.3-1.3c0-3.1-2.4-5.5-5.5-5.5-.7 0-1.3-.6-1.3-1.3s.6-1.3 1.3-1.3c3.1 0 5.5-2.4 5.5-5.5 0-.7.6-1.3 1.3-1.3s1.3.6 1.3 1.3Z"
        fill="#fff"
      />
      {/* Smaller companion star, lower-right. */}
      <path
        d="M24.4 20.4c0 1.4 1.1 2.5 2.5 2.5.4 0 .7.3.7.7s-.3.7-.7.7c-1.4 0-2.5 1.1-2.5 2.5 0 .4-.3.7-.7.7s-.7-.3-.7-.7c0-1.4-1.1-2.5-2.5-2.5-.4 0-.7-.3-.7-.7s.3-.7.7-.7c1.4 0 2.5-1.1 2.5-2.5 0-.4.3-.7.7-.7s.7.3.7.7Z"
        fill="#fff"
        fillOpacity="0.72"
      />
    </svg>
  );
}
