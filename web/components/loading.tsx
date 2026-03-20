import { cn } from '../utils/cn';
import { useState, useEffect } from 'react';

interface LoadingProps {
  size?: number;
  className?: string;
}

/*
 * Pixel-art loading spinner — progressive cell-by-cell fill on a 4×4 grid.
 * The grid is divided into 4 quadrants (clockwise: TL, TR, BR, BL).
 * Each cell fills one at a time in quadrant order, then empties the same way.
 * 32 frames total (16 fill + 16 empty) at 50ms = ~1.6s per cycle.
 * Minimum rendered size: 8×8px (each cell = 2×2 display pixels).
 */

// Cells ordered by quadrant (clockwise: TL → TR → BR → BL).
// Within each quadrant, cells follow the clockwise direction of travel.
const fillOrder: [number, number][] = [
  // Q0: top-left (fills →↓)
  [0, 0], [0, 1], [1, 0], [1, 1],
  // Q1: top-right (fills →↓)
  [0, 2], [0, 3], [1, 2], [1, 3],
  // Q2: bottom-right (fills ←↑, reversing direction)
  [2, 3], [2, 2], [3, 3], [3, 2],
  // Q3: bottom-left (fills ←↑, reversing direction)
  [3, 1], [3, 0], [2, 1], [2, 0],
];

const TOTAL_CELLS = 16;
const TOTAL_FRAMES = TOTAL_CELLS * 2; // 16 fill + 16 empty

function Loading({ size = 24, className }: LoadingProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % TOTAL_FRAMES);
    }, 50);
    return () => clearInterval(id);
  }, []);

  // During fill phase (0-15): cell i is visible if i <= frame
  // During empty phase (16-31): cell i is visible if i > (frame - 16)
  const isFilling = frame < TOTAL_CELLS;
  const threshold = isFilling ? frame : frame - TOTAL_CELLS;

  const cellSize = 2;
  const viewSize = 8; // 4 cells × 2px each = 8

  return (
    <div
      className={cn('inline-flex items-center justify-center', className)}
      style={{ width: Math.max(size, 8), height: Math.max(size, 8) }}
    >
      <svg
        width={Math.max(size, 8)}
        height={Math.max(size, 8)}
        viewBox={`0 0 ${viewSize} ${viewSize}`}
        shapeRendering="crispEdges"
      >
        {fillOrder.map(([r, c], i) => {
          const visible = isFilling ? i <= threshold : i > threshold;
          return (
            <rect
              key={i}
              x={c * cellSize}
              y={r * cellSize}
              width={cellSize}
              height={cellSize}
              fill="currentColor"
              opacity={visible ? 1 : 0}
              style={{ transition: 'opacity 40ms ease' }}
            />
          );
        })}
      </svg>
    </div>
  );
}

export { Loading };
export type { LoadingProps };
