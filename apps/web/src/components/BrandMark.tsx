import React from 'react';

interface BrandMarkProps {
  size?: number;
  radius?: number;
}

export default function BrandMark({ size = 28, radius }: BrandMarkProps) {
  const r = radius ?? Math.round(size * 0.22);
  const clipId = `qclip-${size}`;
  return (
    <svg viewBox="0 0 132 132" width={size} height={size} aria-label="Quire" style={{ display: 'block' }}>
      <defs>
        <clipPath id={clipId}>
          <rect width="132" height="132" rx={(r * 132) / size} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect width="132" height="132" rx={(r * 132) / size} fill="var(--ink)" />
        <text
          x="66"
          y="100"
          textAnchor="middle"
          fontFamily="Newsreader, Georgia, 'Times New Roman', serif"
          fontStyle="italic"
          fontWeight="400"
          fontSize="112"
          fill="var(--paper)"
          style={{ letterSpacing: '-0.04em' }}
        >
          Q
        </text>
        {size >= 22 && (
          <>
            <path d="M132 102 L132 132 L102 132 Z" fill="var(--paper-2)" />
            <path d="M102 132 L132 102" stroke="var(--ink)" strokeWidth="1.2" opacity="0.45" />
          </>
        )}
      </g>
    </svg>
  );
}
