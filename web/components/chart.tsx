import * as React from 'react';
import { cn } from '../utils/cn';

// ─── Shared helpers ─────────────────────────────────────────────

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

function scaleLinear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  return (v: number) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
}

// ─── Sparkline ──────────────────────────────────────────────────

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

function Sparkline({ data, width = 80, height = 24, color, className }: SparklineProps) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const yScale = scaleLinear([min, max || 1], [height - 2, 2]);
  const xStep = (width - 4) / (data.length - 1);

  const points = data.map((v, i) => `${2 + i * xStep},${yScale(v)}`).join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
    >
      <polyline
        points={points}
        fill="none"
        stroke={color ?? 'var(--color-accent)'}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── LineChart ───────────────────────────────────────────────────

interface LineChartPoint { x: number; y: number; label?: string; }

interface LineChartProps {
  data: LineChartPoint[];
  width?: number;
  height?: number;
  color?: string;
  showGrid?: boolean;
  showLabels?: boolean;
  showArea?: boolean;
  animated?: boolean;
  className?: string;
}

function LineChart({
  data, width = 300, height = 200, color,
  showGrid = true, showLabels = true, showArea = false,
  animated = false, className,
}: LineChartProps) {
  if (data.length < 2) return null;

  const pad = { top: 10, right: 10, bottom: showLabels ? 24 : 10, left: showLabels ? 40 : 10 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;

  const xs = data.map((d) => d.x);
  const ys = data.map((d) => d.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xScale = scaleLinear([xMin, xMax], [0, w]);
  const yScale = scaleLinear([yMin, yMax || 1], [h, 0]);

  const linePoints = data.map((d) => `${pad.left + xScale(d.x)},${pad.top + yScale(d.y)}`).join(' ');
  const areaPoints = linePoints + ` ${pad.left + w},${pad.top + h} ${pad.left},${pad.top + h}`;

  const gradientId = React.useId();
  const accentColor = color ?? 'var(--color-accent)';

  // Grid lines (5 horizontal)
  const gridLines = showGrid ? Array.from({ length: 5 }, (_, i) => {
    const y = pad.top + (h / 4) * i;
    const val = lerp(yMax, yMin, i / 4);
    return { y, val };
  }) : [];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn('w-full', className)}>
      {showArea && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accentColor} stopOpacity={0.2} />
            <stop offset="100%" stopColor={accentColor} stopOpacity={0} />
          </linearGradient>
        </defs>
      )}

      {/* Grid */}
      {gridLines.map((g, i) => (
        <g key={i}>
          <line x1={pad.left} y1={g.y} x2={pad.left + w} y2={g.y} stroke="var(--color-border)" strokeDasharray="4 4" strokeWidth={0.5} />
          {showLabels && (
            <text x={pad.left - 6} y={g.y + 3} textAnchor="end" className="text-[11px] tracking-[-0.11px]" fill="var(--color-text-dim)">{Math.round(g.val)}</text>
          )}
        </g>
      ))}

      {/* Area fill */}
      {showArea && <polygon points={areaPoints} fill={`url(#${gradientId})`} />}

      {/* Line */}
      <polyline
        points={linePoints}
        fill="none"
        stroke={accentColor}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={animated ? 'animate-draw-line' : ''}
      />

      {/* Dots */}
      {data.map((d, i) => (
        <circle
          key={i}
          cx={pad.left + xScale(d.x)}
          cy={pad.top + yScale(d.y)}
          r={3}
          fill={accentColor}
        />
      ))}
    </svg>
  );
}

// ─── BarChart ───────────────────────────────────────────────────

interface BarChartItem { label: string; value: number; color?: string; }

interface BarChartProps {
  data: BarChartItem[];
  width?: number;
  height?: number;
  color?: string;
  horizontal?: boolean;
  showLabels?: boolean;
  className?: string;
}

function BarChart({
  data, width = 300, height = 200, color,
  horizontal = false, showLabels = true, className,
}: BarChartProps) {
  if (data.length === 0) return null;

  const pad = { top: 10, right: 10, bottom: showLabels ? 28 : 10, left: showLabels ? 40 : 10 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const barWidth = w / data.length * 0.7;
  const gap = w / data.length * 0.3;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn('w-full', className)}>
      {data.map((item, i) => {
        const barH = (item.value / maxVal) * h;
        const x = pad.left + (w / data.length) * i + gap / 2;
        const y = pad.top + h - barH;
        const fillColor = item.color ?? color ?? 'var(--color-accent)';
        return (
          <g key={i}>
            <rect x={x} y={y} width={barWidth} height={barH} rx={3} fill={fillColor} />
            {showLabels && (
              <text
                x={x + barWidth / 2}
                y={height - 6}
                textAnchor="middle"
                className="text-[11px] tracking-[-0.11px]"
                fill="var(--color-text-dim)"
              >
                {item.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── PieChart ───────────────────────────────────────────────────

interface PieChartItem { label: string; value: number; color?: string; }

interface PieChartProps {
  data: PieChartItem[];
  size?: number;
  donut?: boolean;
  centerLabel?: string;
  className?: string;
}

const PIE_COLORS = [
  'var(--color-accent)',
  'var(--color-positive)',
  'var(--color-negative)',
  'var(--color-accent-warning)',
  'var(--color-text-dim)',
  'var(--color-surface-lighter)',
];

function PieChart({ data, size = 160, donut = false, centerLabel, className }: PieChartProps) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = size / 2 - 4;
  const strokeWidth = donut ? r * 0.4 : r;
  const radius = r - strokeWidth / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;

  return (
    <div className={cn('flex items-start gap-4 flex-wrap', className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="-rotate-90">
          {data.map((item, i) => {
            const pct = item.value / total;
            const dash = pct * circumference;
            const currentOffset = offset;
            offset += dash;
            return (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={item.color ?? PIE_COLORS[i % PIE_COLORS.length]}
                strokeWidth={strokeWidth}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-currentOffset}
              />
            );
          })}
        </svg>
        {donut && centerLabel && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[17px] tracking-[-0.17px] font-normal">{centerLabel}</span>
          </div>
        )}
      </div>
      {/* Legend */}
      <div className="flex flex-col gap-1.5 py-2">
        {data.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color ?? PIE_COLORS[i % PIE_COLORS.length] }} />
            <span className="text-[13px] tracking-[-0.13px] text-text">{item.label}</span>
            <span className="text-[11px] tracking-[-0.11px] text-text-dim ml-auto tabular-nums">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── StatCard ───────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string | number;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
  sparklineData?: number[];
  className?: string;
}

function StatCard({ label, value, change, trend, sparklineData, className }: StatCardProps) {
  return (
    <div className={cn('bg-surface rounded-[6px] p-4', className)}>
      <div className="text-[13px] tracking-[-0.13px] text-text-dim mb-1">{label}</div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="text-[24px] tracking-[-0.72px] font-normal tabular-nums">{value}</div>
          {change && (
            <span className={cn(
              'text-[13px] tracking-[-0.13px]',
              trend === 'up' && 'text-positive',
              trend === 'down' && 'text-negative',
              trend === 'neutral' && 'text-text-dim',
            )}>
              {trend === 'up' && '↑'}{trend === 'down' && '↓'} {change}
            </span>
          )}
        </div>
        {sparklineData && sparklineData.length > 1 && (
          <Sparkline
            data={sparklineData}
            width={64}
            height={24}
            color={trend === 'up' ? 'var(--color-positive)' : trend === 'down' ? 'var(--color-negative)' : undefined}
          />
        )}
      </div>
    </div>
  );
}

export { Sparkline, LineChart, BarChart, PieChart, StatCard };
export type { SparklineProps, LineChartProps, LineChartPoint, BarChartProps, BarChartItem, PieChartProps, PieChartItem, StatCardProps };
