/**
 * Reusable skeleton blocks for page loading states.
 * Used by route-level loading.tsx files to give instant visual feedback
 * while async page data resolves on the server.
 */

/** A single shimmering bar */
function Bar({ w = 'w-full', h = 'h-4' }: { w?: string; h?: string }) {
  return (
    <div
      className={`${w} ${h} rounded bg-ink-100/30 animate-pulse`}
    />
  );
}

/** Page header skeleton (title + deck) */
export function HeaderSkeleton() {
  return (
    <div className="col-span-12 border-b border-ink-100 pb-10 space-y-4">
      <Bar w="w-2/5" h="h-10" />
      <Bar w="w-3/5" h="h-5" />
    </div>
  );
}

/** A table-like skeleton with N rows */
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="col-span-12 space-y-3 mt-2">
      {/* header row */}
      <div className="flex gap-6 border-b border-ink-100 pb-2">
        <Bar w="w-16" h="h-3" />
        <Bar w="w-24" h="h-3" />
        <Bar w="w-20" h="h-3" />
        <Bar w="w-20" h="h-3" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-6 py-1">
          <Bar w="w-16" h="h-4" />
          <Bar w="w-32" h="h-4" />
          <Bar w="w-20" h="h-4" />
          <Bar w="w-20" h="h-4" />
        </div>
      ))}
    </div>
  );
}

/** Cards grid skeleton */
export function CardsSkeleton({ n = 6 }: { n?: number }) {
  return (
    <div className="col-span-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-2">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="border border-ink-100 rounded p-5 space-y-3">
          <Bar w="w-1/3" h="h-3" />
          <Bar w="w-1/2" h="h-6" />
          <Bar w="w-2/3" h="h-3" />
          <Bar w="w-full" h="h-3" />
        </div>
      ))}
    </div>
  );
}

/** Full page skeleton — header + table */
export function PageSkeleton({ variant = 'table' }: { variant?: 'table' | 'cards' }) {
  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-12">
      <HeaderSkeleton />
      {variant === 'cards' ? <CardsSkeleton /> : <TableSkeleton />}
    </div>
  );
}
