import type { ReactNode } from 'react';

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel-padded flex flex-col items-center justify-center text-center py-16 gap-2">
      <div className="text-noc-text-dim">{title}</div>
      {hint && <div className="text-noc-text-mute text-sm max-w-md">{hint}</div>}
      {action}
    </div>
  );
}
