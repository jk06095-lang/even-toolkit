import * as React from 'react';

type SvgIcon = React.FC<React.SVGProps<SVGSVGElement>>;

// Helper: pixel-art icons use a 12x12 grid with 2px cells in a 24x24 viewBox
const P = ({ x, y }: { x: number; y: number }) => (
  <rect x={x * 2} y={y * 2} width={2} height={2} fill="currentColor" />
);

// ─── Feature & Function ─────────────────────────────────────────

export const IcTranslate: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={1} y={2} /><P x={2} y={2} /><P x={3} y={2} /><P x={4} y={2} /><P x={5} y={2} />
    <P x={3} y={3} /><P x={3} y={4} /><P x={3} y={5} /><P x={3} y={6} /><P x={3} y={7} />
    <P x={2} y={4} /><P x={4} y={4} />
    <P x={7} y={4} /><P x={8} y={4} /><P x={9} y={4} /><P x={10} y={4} />
    <P x={7} y={5} /><P x={10} y={5} />
    <P x={7} y={6} /><P x={8} y={6} /><P x={9} y={6} /><P x={10} y={6} />
    <P x={7} y={7} /><P x={10} y={7} />
    <P x={7} y={8} /><P x={8} y={8} /><P x={9} y={8} /><P x={10} y={8} />
    <P x={5} y={9} /><P x={6} y={9} />
  </svg>
);

export const IcAccount: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={4} y={2} /><P x={5} y={2} /><P x={6} y={2} /><P x={7} y={2} />
    <P x={3} y={3} /><P x={8} y={3} />
    <P x={3} y={4} /><P x={8} y={4} />
    <P x={4} y={5} /><P x={5} y={5} /><P x={6} y={5} /><P x={7} y={5} />
    <P x={2} y={7} /><P x={3} y={7} /><P x={4} y={7} /><P x={5} y={7} /><P x={6} y={7} /><P x={7} y={7} /><P x={8} y={7} /><P x={9} y={7} />
    <P x={1} y={8} /><P x={10} y={8} />
    <P x={1} y={9} /><P x={10} y={9} />
    <P x={1} y={10} /><P x={10} y={10} />
  </svg>
);

export const IcSearch: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={3} y={2} /><P x={4} y={2} /><P x={5} y={2} /><P x={6} y={2} />
    <P x={2} y={3} /><P x={7} y={3} />
    <P x={2} y={4} /><P x={7} y={4} />
    <P x={2} y={5} /><P x={7} y={5} />
    <P x={3} y={6} /><P x={4} y={6} /><P x={5} y={6} /><P x={6} y={6} />
    <P x={7} y={7} />
    <P x={8} y={8} />
    <P x={9} y={9} />
    <P x={10} y={10} />
  </svg>
);

export const IcEmail: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={1} y={3} /><P x={2} y={3} /><P x={3} y={3} /><P x={4} y={3} /><P x={5} y={3} /><P x={6} y={3} /><P x={7} y={3} /><P x={8} y={3} /><P x={9} y={3} /><P x={10} y={3} />
    <P x={1} y={4} /><P x={2} y={4} /><P x={9} y={4} /><P x={10} y={4} />
    <P x={1} y={5} /><P x={3} y={5} /><P x={8} y={5} /><P x={10} y={5} />
    <P x={1} y={6} /><P x={4} y={6} /><P x={5} y={6} /><P x={6} y={6} /><P x={7} y={6} /><P x={10} y={6} />
    <P x={1} y={7} /><P x={10} y={7} />
    <P x={1} y={8} /><P x={10} y={8} />
    <P x={1} y={9} /><P x={2} y={9} /><P x={3} y={9} /><P x={4} y={9} /><P x={5} y={9} /><P x={6} y={9} /><P x={7} y={9} /><P x={8} y={9} /><P x={9} y={9} /><P x={10} y={9} />
  </svg>
);

export const IcInfo: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={5} y={3} /><P x={6} y={3} />
    <P x={5} y={5} /><P x={6} y={5} />
    <P x={5} y={6} /><P x={6} y={6} />
    <P x={5} y={7} /><P x={6} y={7} />
    <P x={5} y={8} /><P x={6} y={8} />
    <P x={5} y={9} /><P x={6} y={9} />
  </svg>
);

export const IcMinimize: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={2} y={6} /><P x={3} y={6} /><P x={4} y={6} /><P x={5} y={6} /><P x={6} y={6} /><P x={7} y={6} /><P x={8} y={6} /><P x={9} y={6} />
  </svg>
);

export const IcGo: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={4} y={2} /><P x={5} y={3} /><P x={6} y={4} /><P x={7} y={5} /><P x={8} y={6} />
    <P x={7} y={7} /><P x={6} y={8} /><P x={5} y={9} /><P x={4} y={10} />
  </svg>
);

export const IcChevronBack: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={7} y={2} /><P x={6} y={3} /><P x={5} y={4} /><P x={4} y={5} /><P x={3} y={6} />
    <P x={4} y={7} /><P x={5} y={8} /><P x={6} y={9} /><P x={7} y={10} />
  </svg>
);

export const IcChevronDown: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={2} y={4} /><P x={3} y={5} /><P x={4} y={6} /><P x={5} y={7} /><P x={6} y={8} />
    <P x={7} y={7} /><P x={8} y={6} /><P x={9} y={5} /><P x={10} y={4} />
  </svg>
);

export const IcCross: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={2} y={2} /><P x={3} y={3} /><P x={4} y={4} /><P x={5} y={5} /><P x={6} y={6} /><P x={7} y={7} /><P x={8} y={8} /><P x={9} y={9} /><P x={10} y={10} />
    <P x={10} y={2} /><P x={9} y={3} /><P x={8} y={4} /><P x={7} y={5} /><P x={5} y={7} /><P x={4} y={8} /><P x={3} y={9} /><P x={2} y={10} />
  </svg>
);

export const IcMore: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={5} y={2} /><P x={6} y={2} /><P x={5} y={3} /><P x={6} y={3} />
    <P x={5} y={5} /><P x={6} y={5} /><P x={5} y={6} /><P x={6} y={6} />
    <P x={5} y={8} /><P x={6} y={8} /><P x={5} y={9} /><P x={6} y={9} />
  </svg>
);

export const IcImage: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={1} y={2} /><P x={2} y={2} /><P x={3} y={2} /><P x={4} y={2} /><P x={5} y={2} /><P x={6} y={2} /><P x={7} y={2} /><P x={8} y={2} /><P x={9} y={2} /><P x={10} y={2} />
    <P x={1} y={3} /><P x={10} y={3} />
    <P x={1} y={4} /><P x={3} y={4} /><P x={4} y={4} /><P x={10} y={4} />
    <P x={1} y={5} /><P x={3} y={5} /><P x={4} y={5} /><P x={10} y={5} />
    <P x={1} y={6} /><P x={10} y={6} />
    <P x={1} y={7} /><P x={3} y={7} /><P x={6} y={7} /><P x={10} y={7} />
    <P x={1} y={8} /><P x={4} y={8} /><P x={5} y={8} /><P x={7} y={8} /><P x={8} y={8} /><P x={10} y={8} />
    <P x={1} y={9} /><P x={10} y={9} />
    <P x={1} y={10} /><P x={2} y={10} /><P x={3} y={10} /><P x={4} y={10} /><P x={5} y={10} /><P x={6} y={10} /><P x={7} y={10} /><P x={8} y={10} /><P x={9} y={10} /><P x={10} y={10} />
  </svg>
);

export const IcBrightness: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={5} y={1} /><P x={6} y={1} />
    <P x={2} y={2} /><P x={9} y={2} />
    <P x={3} y={3} /><P x={8} y={3} />
    <P x={4} y={3} /><P x={5} y={3} /><P x={6} y={3} /><P x={7} y={3} />
    <P x={1} y={5} /><P x={3} y={4} /><P x={8} y={4} /><P x={10} y={5} />
    <P x={3} y={5} /><P x={8} y={5} />
    <P x={3} y={6} /><P x={8} y={6} />
    <P x={1} y={6} /><P x={10} y={6} />
    <P x={3} y={7} /><P x={4} y={7} /><P x={5} y={7} /><P x={6} y={7} /><P x={7} y={7} /><P x={8} y={7} />
    <P x={3} y={8} /><P x={8} y={8} />
    <P x={2} y={9} /><P x={9} y={9} />
    <P x={5} y={10} /><P x={6} y={10} />
  </svg>
);

export const IcWifi: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={3} y={3} /><P x={4} y={3} /><P x={5} y={3} /><P x={6} y={3} /><P x={7} y={3} /><P x={8} y={3} />
    <P x={2} y={4} /><P x={9} y={4} />
    <P x={4} y={5} /><P x={5} y={5} /><P x={6} y={5} /><P x={7} y={5} />
    <P x={3} y={6} /><P x={8} y={6} />
    <P x={5} y={7} /><P x={6} y={7} />
    <P x={5} y={9} /><P x={6} y={9} />
    <P x={5} y={10} /><P x={6} y={10} />
  </svg>
);

export const IcBattery: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={5} y={2} /><P x={6} y={2} />
    <P x={3} y={3} /><P x={4} y={3} /><P x={5} y={3} /><P x={6} y={3} /><P x={7} y={3} /><P x={8} y={3} />
    <P x={3} y={4} /><P x={4} y={4} /><P x={5} y={4} /><P x={6} y={4} /><P x={7} y={4} /><P x={8} y={4} />
    <P x={3} y={5} /><P x={4} y={5} /><P x={5} y={5} /><P x={6} y={5} /><P x={7} y={5} /><P x={8} y={5} />
    <P x={3} y={6} /><P x={4} y={6} /><P x={5} y={6} /><P x={6} y={6} /><P x={7} y={6} /><P x={8} y={6} />
    <P x={3} y={7} /><P x={4} y={7} /><P x={5} y={7} /><P x={6} y={7} /><P x={7} y={7} /><P x={8} y={7} />
    <P x={3} y={8} /><P x={4} y={8} /><P x={5} y={8} /><P x={6} y={8} /><P x={7} y={8} /><P x={8} y={8} />
    <P x={3} y={9} /><P x={4} y={9} /><P x={5} y={9} /><P x={6} y={9} /><P x={7} y={9} /><P x={8} y={9} />
    <P x={3} y={10} /><P x={4} y={10} /><P x={5} y={10} /><P x={6} y={10} /><P x={7} y={10} /><P x={8} y={10} />
  </svg>
);

export const IcSettings: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={4} y={1} /><P x={5} y={1} /><P x={6} y={1} /><P x={7} y={1} />
    <P x={3} y={2} /><P x={5} y={2} /><P x={6} y={2} /><P x={8} y={2} />
    <P x={2} y={3} /><P x={3} y={3} /><P x={8} y={3} /><P x={9} y={3} />
    <P x={1} y={4} /><P x={2} y={4} /><P x={9} y={4} /><P x={10} y={4} />
    <P x={1} y={5} /><P x={4} y={5} /><P x={7} y={5} /><P x={10} y={5} />
    <P x={1} y={6} /><P x={4} y={6} /><P x={7} y={6} /><P x={10} y={6} />
    <P x={1} y={7} /><P x={2} y={7} /><P x={9} y={7} /><P x={10} y={7} />
    <P x={2} y={8} /><P x={3} y={8} /><P x={8} y={8} /><P x={9} y={8} />
    <P x={3} y={9} /><P x={5} y={9} /><P x={6} y={9} /><P x={8} y={9} />
    <P x={4} y={10} /><P x={5} y={10} /><P x={6} y={10} /><P x={7} y={10} />
  </svg>
);

export const IcHome: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={5} y={1} /><P x={6} y={1} />
    <P x={4} y={2} /><P x={7} y={2} />
    <P x={3} y={3} /><P x={8} y={3} />
    <P x={2} y={4} /><P x={9} y={4} />
    <P x={1} y={5} /><P x={10} y={5} />
    <P x={2} y={6} /><P x={9} y={6} />
    <P x={2} y={7} /><P x={9} y={7} />
    <P x={2} y={8} /><P x={9} y={8} />
    <P x={2} y={9} /><P x={5} y={9} /><P x={6} y={9} /><P x={9} y={9} />
    <P x={2} y={10} /><P x={3} y={10} /><P x={4} y={10} /><P x={5} y={10} /><P x={6} y={10} /><P x={7} y={10} /><P x={8} y={10} /><P x={9} y={10} />
  </svg>
);

export const IcMap: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={5} y={1} /><P x={6} y={1} />
    <P x={4} y={2} /><P x={7} y={2} />
    <P x={3} y={3} /><P x={8} y={3} />
    <P x={3} y={4} /><P x={8} y={4} />
    <P x={4} y={5} /><P x={7} y={5} />
    <P x={5} y={6} /><P x={6} y={6} />
    <P x={5} y={8} /><P x={6} y={8} />
  </svg>
);

export const IcCheck: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={9} y={2} /><P x={10} y={2} />
    <P x={8} y={3} /><P x={9} y={3} />
    <P x={7} y={4} /><P x={8} y={4} />
    <P x={6} y={5} /><P x={7} y={5} />
    <P x={2} y={6} /><P x={5} y={6} /><P x={6} y={6} />
    <P x={3} y={7} /><P x={4} y={7} /><P x={5} y={7} />
    <P x={4} y={8} />
  </svg>
);

export const IcTrash: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={4} y={1} /><P x={5} y={1} /><P x={6} y={1} /><P x={7} y={1} />
    <P x={2} y={2} /><P x={3} y={2} /><P x={4} y={2} /><P x={5} y={2} /><P x={6} y={2} /><P x={7} y={2} /><P x={8} y={2} /><P x={9} y={2} />
    <P x={3} y={3} /><P x={8} y={3} />
    <P x={3} y={4} /><P x={5} y={4} /><P x={6} y={4} /><P x={8} y={4} />
    <P x={3} y={5} /><P x={5} y={5} /><P x={6} y={5} /><P x={8} y={5} />
    <P x={3} y={6} /><P x={5} y={6} /><P x={6} y={6} /><P x={8} y={6} />
    <P x={3} y={7} /><P x={5} y={7} /><P x={6} y={7} /><P x={8} y={7} />
    <P x={3} y={8} /><P x={5} y={8} /><P x={6} y={8} /><P x={8} y={8} />
    <P x={3} y={9} /><P x={4} y={9} /><P x={5} y={9} /><P x={6} y={9} /><P x={7} y={9} /><P x={8} y={9} />
  </svg>
);

export const IcEdit: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={8} y={1} /><P x={9} y={1} />
    <P x={7} y={2} /><P x={8} y={2} /><P x={9} y={2} /><P x={10} y={2} />
    <P x={6} y={3} /><P x={7} y={3} /><P x={9} y={3} /><P x={10} y={3} />
    <P x={5} y={4} /><P x={6} y={4} /><P x={8} y={4} /><P x={9} y={4} />
    <P x={4} y={5} /><P x={5} y={5} /><P x={7} y={5} /><P x={8} y={5} />
    <P x={3} y={6} /><P x={4} y={6} /><P x={6} y={6} /><P x={7} y={6} />
    <P x={2} y={7} /><P x={3} y={7} /><P x={5} y={7} /><P x={6} y={7} />
    <P x={1} y={8} /><P x={2} y={8} /><P x={4} y={8} /><P x={5} y={8} />
    <P x={1} y={9} /><P x={2} y={9} /><P x={3} y={9} />
    <P x={1} y={10} /><P x={2} y={10} />
  </svg>
);

export const IcPlus: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={5} y={2} /><P x={6} y={2} />
    <P x={5} y={3} /><P x={6} y={3} />
    <P x={5} y={4} /><P x={6} y={4} />
    <P x={5} y={5} /><P x={6} y={5} />
    <P x={1} y={5} /><P x={2} y={5} /><P x={3} y={5} /><P x={4} y={5} /><P x={7} y={5} /><P x={8} y={5} /><P x={9} y={5} /><P x={10} y={5} />
    <P x={1} y={6} /><P x={2} y={6} /><P x={3} y={6} /><P x={4} y={6} /><P x={7} y={6} /><P x={8} y={6} /><P x={9} y={6} /><P x={10} y={6} />
    <P x={5} y={7} /><P x={6} y={7} />
    <P x={5} y={8} /><P x={6} y={8} />
    <P x={5} y={9} /><P x={6} y={9} />
    <P x={5} y={10} /><P x={6} y={10} />
  </svg>
);

export const IcStar: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={5} y={1} /><P x={6} y={1} />
    <P x={5} y={2} /><P x={6} y={2} />
    <P x={4} y={3} /><P x={5} y={3} /><P x={6} y={3} /><P x={7} y={3} />
    <P x={1} y={4} /><P x={2} y={4} /><P x={3} y={4} /><P x={4} y={4} /><P x={5} y={4} /><P x={6} y={4} /><P x={7} y={4} /><P x={8} y={4} /><P x={9} y={4} /><P x={10} y={4} />
    <P x={2} y={5} /><P x={3} y={5} /><P x={4} y={5} /><P x={5} y={5} /><P x={6} y={5} /><P x={7} y={5} /><P x={8} y={5} /><P x={9} y={5} />
    <P x={3} y={6} /><P x={4} y={6} /><P x={5} y={6} /><P x={6} y={6} /><P x={7} y={6} /><P x={8} y={6} />
    <P x={3} y={7} /><P x={4} y={7} /><P x={7} y={7} /><P x={8} y={7} />
    <P x={2} y={8} /><P x={3} y={8} /><P x={8} y={8} /><P x={9} y={8} />
  </svg>
);

export const IcHeart: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={2} y={2} /><P x={3} y={2} /><P x={4} y={2} /><P x={7} y={2} /><P x={8} y={2} /><P x={9} y={2} />
    <P x={1} y={3} /><P x={2} y={3} /><P x={3} y={3} /><P x={4} y={3} /><P x={5} y={3} /><P x={6} y={3} /><P x={7} y={3} /><P x={8} y={3} /><P x={9} y={3} /><P x={10} y={3} />
    <P x={1} y={4} /><P x={2} y={4} /><P x={3} y={4} /><P x={4} y={4} /><P x={5} y={4} /><P x={6} y={4} /><P x={7} y={4} /><P x={8} y={4} /><P x={9} y={4} /><P x={10} y={4} />
    <P x={2} y={5} /><P x={3} y={5} /><P x={4} y={5} /><P x={5} y={5} /><P x={6} y={5} /><P x={7} y={5} /><P x={8} y={5} /><P x={9} y={5} />
    <P x={3} y={6} /><P x={4} y={6} /><P x={5} y={6} /><P x={6} y={6} /><P x={7} y={6} /><P x={8} y={6} />
    <P x={4} y={7} /><P x={5} y={7} /><P x={6} y={7} /><P x={7} y={7} />
    <P x={5} y={8} /><P x={6} y={8} />
  </svg>
);

export const IcShare: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={5} y={1} /><P x={6} y={1} />
    <P x={4} y={2} /><P x={5} y={2} /><P x={6} y={2} /><P x={7} y={2} />
    <P x={3} y={3} /><P x={5} y={3} /><P x={6} y={3} /><P x={8} y={3} />
    <P x={5} y={4} /><P x={6} y={4} />
    <P x={5} y={5} /><P x={6} y={5} />
    <P x={3} y={5} /><P x={8} y={5} />
    <P x={2} y={6} /><P x={9} y={6} />
    <P x={2} y={7} /><P x={9} y={7} />
    <P x={2} y={8} /><P x={9} y={8} />
    <P x={2} y={9} /><P x={3} y={9} /><P x={4} y={9} /><P x={5} y={9} /><P x={6} y={9} /><P x={7} y={9} /><P x={8} y={9} /><P x={9} y={9} />
  </svg>
);

export const IcCopy: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <P x={3} y={1} /><P x={4} y={1} /><P x={5} y={1} /><P x={6} y={1} /><P x={7} y={1} /><P x={8} y={1} />
    <P x={3} y={2} /><P x={8} y={2} />
    <P x={3} y={3} /><P x={8} y={3} />
    <P x={3} y={4} /><P x={8} y={4} />
    <P x={3} y={5} /><P x={8} y={5} />
    <P x={3} y={6} /><P x={4} y={6} /><P x={5} y={6} /><P x={6} y={6} /><P x={7} y={6} /><P x={8} y={6} />
    <P x={1} y={4} /><P x={2} y={4} />
    <P x={1} y={5} /><P x={1} y={6} /><P x={1} y={7} /><P x={1} y={8} /><P x={1} y={9} />
    <P x={1} y={10} /><P x={2} y={10} /><P x={3} y={10} /><P x={4} y={10} /><P x={5} y={10} /><P x={6} y={10} />
    <P x={6} y={7} /><P x={6} y={8} /><P x={6} y={9} />
  </svg>
);

// ─── All icons map ──────────────────────────────────────────────

export const allIcons: Record<string, SvgIcon> = {
  'ic_translate': IcTranslate,
  'ic_account': IcAccount,
  'ic_search': IcSearch,
  'ic_email': IcEmail,
  'ic_info': IcInfo,
  'ic_minimize': IcMinimize,
  'ic_go': IcGo,
  'ic_chevron_back': IcChevronBack,
  'ic_chevron_down': IcChevronDown,
  'ic_cross': IcCross,
  'ic_more': IcMore,
  'ic_image': IcImage,
  'ic_brightness': IcBrightness,
  'ic_wifi': IcWifi,
  'ic_battery': IcBattery,
  'ic_settings': IcSettings,
  'ic_home': IcHome,
  'ic_map': IcMap,
  'ic_check': IcCheck,
  'ic_trash': IcTrash,
  'ic_edit': IcEdit,
  'ic_plus': IcPlus,
  'ic_star': IcStar,
  'ic_heart': IcHeart,
  'ic_share': IcShare,
  'ic_copy': IcCopy,
};
