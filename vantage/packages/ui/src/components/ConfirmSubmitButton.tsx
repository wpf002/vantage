'use client';

import { useState } from 'react';

/**
 * Two-step confirm-then-submit button for irreversible owner actions
 * (delete, unpublish where appropriate). First click reveals a confirm
 * affordance inline; second click submits the surrounding form.
 */
export function ConfirmSubmitButton({
  label,
  confirmLabel = 'Click again to confirm',
  className,
}: {
  label: string;
  confirmLabel?: string;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type={armed ? 'submit' : 'button'}
      onClick={armed ? undefined : () => setArmed(true)}
      className={className ?? 'font-sans text-sm text-ink-700 hover:text-editorial'}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
