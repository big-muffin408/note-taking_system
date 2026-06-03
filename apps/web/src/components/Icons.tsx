import React from 'react';

// Lucide-style minimal icons (16x16), matching the static design/ prototype.
// Sizing is handled by CSS (e.g. `.fmt-btn svg`, `.btn-ghost svg`), so these
// intentionally omit width/height attributes.

type IconProps = React.SVGProps<SVGSVGElement>;

const base = (props: IconProps): IconProps => ({
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  ...props,
});

// ---- Inline formatting ----
export const BoldIcon = (props: IconProps) => (
  <svg {...base(props)} fill="currentColor" stroke="none">
    <path d="M4 3h4.5a2.5 2.5 0 010 5H4V3zm0 5h5a2.5 2.5 0 010 5H4V8zm1.5-3.5v2.5h2.5a1.25 1.25 0 000-2.5h-2.5zm0 5v2.5h3a1.25 1.25 0 000-2.5h-3z" />
  </svg>
);

export const ItalicIcon = (props: IconProps) => (
  <svg {...base(props)} strokeWidth="1.5">
    <path d="M7 3h6M3 13h6M10 3l-4 10" />
  </svg>
);

export const StrikeIcon = (props: IconProps) => (
  <svg {...base(props)} strokeWidth="1.5" strokeLinecap="round">
    <path d="M3 8h10" />
    <path d="M5 5a3 2.2 0 015-1M11 9.5a3 2.4 0 01-5.4 1.6" />
  </svg>
);

export const CodeIcon = (props: IconProps) => (
  <svg {...base(props)} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 4L2 8l3 4M11 4l3 4-3 4M9 3l-2 10" />
  </svg>
);

// ---- Blocks / lists ----
export const ListIcon = (props: IconProps) => (
  <svg {...base(props)} strokeWidth="1.5" strokeLinecap="round">
    <circle cx="3" cy="4" r=".8" fill="currentColor" />
    <circle cx="3" cy="8" r=".8" fill="currentColor" />
    <circle cx="3" cy="12" r=".8" fill="currentColor" />
    <path d="M6 4h8M6 8h8M6 12h8" />
  </svg>
);

export const OrderedListIcon = (props: IconProps) => (
  <svg {...base(props)} strokeWidth="1.4" strokeLinecap="round">
    <text x="1" y="6" fontSize="4.5" fill="currentColor" stroke="none" fontFamily="monospace">1</text>
    <text x="1" y="11" fontSize="4.5" fill="currentColor" stroke="none" fontFamily="monospace">2</text>
    <text x="1" y="16" fontSize="4.5" fill="currentColor" stroke="none" fontFamily="monospace">3</text>
    <path d="M6 4h8M6 9h8M6 14h8" />
  </svg>
);

export const TaskListIcon = (props: IconProps) => (
  <svg {...base(props)} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2.5" width="5" height="5" rx="1" />
    <path d="M3.2 5l1 1 1.6-1.8" />
    <path d="M9 4.5h5M9 11h5" />
    <rect x="2" y="9" width="5" height="5" rx="1" />
  </svg>
);

export const QuoteIcon = (props: IconProps) => (
  <svg {...base(props)} fill="currentColor" stroke="none">
    <path d="M3 5c0-1 1-2 2-2v1.5c-.5 0-1 .5-1 1h1V8H3V5zm5 0c0-1 1-2 2-2v1.5c-.5 0-1 .5-1 1h1V8H8V5z" />
    <path d="M3 9h2v2H3zM8 9h2v2H8z" />
  </svg>
);

export const CodeBlockIcon = (props: IconProps) => (
  <svg {...base(props)} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M6 6.5L4.5 8 6 9.5M10 6.5L11.5 8 10 9.5" />
  </svg>
);

export const HorizontalRuleIcon = (props: IconProps) => (
  <svg {...base(props)} strokeWidth="1.5" strokeLinecap="round">
    <path d="M2 8h12" />
  </svg>
);

// ---- History ----
export const UndoIcon = (props: IconProps) => (
  <svg {...base(props)} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7h7a3.5 3.5 0 010 7H6M3 7l3-3M3 7l3 3" />
  </svg>
);

export const RedoIcon = (props: IconProps) => (
  <svg {...base(props)} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 7H6a3.5 3.5 0 000 7h4M13 7l-3-3M13 7l-3 3" />
  </svg>
);

// ---- Inserts ----
export const ImageIcon = (props: IconProps) => (
  <svg {...base(props)} strokeWidth="1.4" strokeLinejoin="round">
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <circle cx="5.5" cy="6.5" r="1.2" />
    <path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3" strokeLinecap="round" />
  </svg>
);

export const MathIcon = (props: IconProps) => (
  <svg {...base(props)} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3h8l-4 5 4 5H3l3.5-5z" />
  </svg>
);

export const TableIcon = (props: IconProps) => (
  <svg {...base(props)} strokeWidth="1.4">
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M2 6.5h12M2 9.8h12M6 3v10M10 3v10" />
  </svg>
);

// ---- Topbar / actions ----
export const ClockIcon = (props: IconProps) => (
  <svg {...base(props)} strokeWidth="1.5">
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.5V8l2 1.5" strokeLinecap="round" />
  </svg>
);

export const UploadIcon = (props: IconProps) => (
  <svg {...base(props)} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 11V3M5 6l3-3 3 3M3 13h10" />
  </svg>
);

export const ShareIcon = (props: IconProps) => (
  <svg {...base(props)} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="3.5" r="2" />
    <circle cx="4" cy="8" r="2" />
    <circle cx="12" cy="12.5" r="2" />
    <path d="M5.8 7l4.5-2.5M5.8 9l4.5 2.5" />
  </svg>
);

export const ReadIcon = (props: IconProps) => (
  <svg {...base(props)} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 4c-1.5-1-3.5-1.2-5.5-1v8.5c2-.2 4 0 5.5 1 1.5-1 3.5-1.2 5.5-1V3c-2-.2-4 0-5.5 1zM8 4v8.5" />
  </svg>
);

export const EditIcon = (props: IconProps) => (
  <svg {...base(props)} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 2.5l2.5 2.5M3 11l8-8.5 2.5 2.5L5.5 13.5 2.5 14z" />
  </svg>
);

export const ExportIcon = (props: IconProps) => (
  <svg {...base(props)} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 2v8M5 7l3 3 3-3M3 13h10" />
  </svg>
);

export const SaveIcon = (props: IconProps) => (
  <svg {...base(props)} strokeWidth="1.4" strokeLinejoin="round">
    <path d="M3 2h7l3 3v9H3z" />
    <path d="M5.5 2v3.5h5V2M5.5 14v-4h5v4" strokeLinecap="round" />
  </svg>
);

export const SparklesIcon = (props: IconProps) => (
  <svg {...base(props)} strokeWidth="1.4" strokeLinejoin="round">
    <path d="M9 2l1 2.5L12.5 5.5 10 6.5 9 9 8 6.5 5.5 5.5 8 4.5z" fill="currentColor" />
    <path d="M3.5 9.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" fill="currentColor" />
  </svg>
);
