import React from 'react';
import { Button } from './Button';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#252D24] bg-[#121512] px-6 py-14 text-center flex flex-col items-center justify-center">
      <div
        className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-48 w-72 rounded-full bg-[#B8F34A]/[0.06] blur-[80px]"
        aria-hidden="true"
      />
      {icon && (
        <div className="relative mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-[#252D24] bg-[#181B18] text-[#B8F34A]">
          {icon}
        </div>
      )}
      <h3 className="relative text-base font-display font-semibold text-[#FCFFEC]">{title}</h3>
      <p className="relative mt-2 max-w-md text-sm text-[#929B90] leading-relaxed">{description}</p>
      {actionLabel && onAction && (
        <div className="relative mt-6">
          <Button variant="primary" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
