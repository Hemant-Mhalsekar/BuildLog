import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidthClass?: string;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  maxWidthClass = 'max-w-xl',
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={cn(
          'w-full rounded-2xl border border-[#252D24] bg-[#121512] text-[#F3F5EF] shadow-[0_24px_64px_rgba(0,0,0,0.65)] max-h-[90vh] flex flex-col overflow-hidden',
          maxWidthClass
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#252D24] bg-[#0D0F0D] px-6 py-4">
          <div className="min-w-0">
            <h2 id="modal-title" className="text-base font-display font-semibold text-[#FCFFEC]">
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-xs text-[#929B90]">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-[#929B90] hover:text-[#F3F5EF] hover:bg-[#181B18] transition-colors shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
