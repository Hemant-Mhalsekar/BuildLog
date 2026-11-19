import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../utils/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-[#B8F34A] text-[#090B09] font-semibold hover:bg-[#C8F76C] active:bg-[#A6E238] border border-transparent shadow-[0_0_20px_rgba(184,243,74,0.18)] hover:shadow-[0_0_24px_rgba(184,243,74,0.3)]',
  secondary:
    'bg-[#181B18] text-[#F3F5EF] font-medium border border-[#252D24] hover:border-[#394637] hover:bg-[#1E231E]',
  ghost:
    'bg-transparent text-[#929B90] font-medium border border-transparent hover:text-[#F3F5EF] hover:bg-[#181B18]',
  danger:
    'bg-red-950/50 text-red-200 font-medium border border-red-800/60 hover:bg-red-900/60 hover:border-red-600/80',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'min-h-[36px] px-3.5 py-1.5 text-xs rounded-lg gap-1.5',
  md: 'min-h-[40px] px-4 py-2 text-sm rounded-lg gap-2',
  lg: 'min-h-[44px] px-5 py-2.5 text-sm rounded-lg gap-2',
};

export function getButtonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string
): string {
  return cn(
    'inline-flex items-center justify-center whitespace-nowrap shrink-0 transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B8F34A] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  children,
  className,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={getButtonClasses(variant, size, className)}
      {...props}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
      ) : icon ? (
        <span className="shrink-0 inline-flex items-center" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
}
