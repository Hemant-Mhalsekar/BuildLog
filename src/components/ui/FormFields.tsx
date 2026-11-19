import React, { useId } from 'react';
import { cn } from '../../utils/cn';

interface BaseFieldProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement>, BaseFieldProps {}

export function Input({
  label,
  error,
  hint,
  required,
  id,
  className,
  ...props
}: InputProps) {
  const autoId = useId();
  const fieldId = id || autoId;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-medium text-[#F3F5EF] flex items-center gap-1">
        <span>{label}</span>
        {required && <span className="text-[#B8F34A]" aria-hidden="true">*</span>}
      </label>
      <input
        id={fieldId}
        required={required}
        aria-invalid={Boolean(error)}
        className={cn(
          'min-h-[42px] w-full rounded-lg border bg-[#080908] px-3.5 py-2 text-sm text-[#F3F5EF] placeholder:text-[#929B90]/60 transition-colors duration-150 focus:outline-none focus:border-[#B8F34A] focus:ring-1 focus:ring-[#B8F34A]/30',
          error ? 'border-red-500/70' : 'border-[#252D24] hover:border-[#344032]',
          className
        )}
        {...props}
      />
      {error ? (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-[#929B90]">{hint}</p>
      ) : null}
    </div>
  );
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement>, BaseFieldProps {}

export function Textarea({
  label,
  error,
  hint,
  required,
  id,
  className,
  rows = 3,
  ...props
}: TextareaProps) {
  const autoId = useId();
  const fieldId = id || autoId;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-medium text-[#F3F5EF] flex items-center gap-1">
        <span>{label}</span>
        {required && <span className="text-[#B8F34A]" aria-hidden="true">*</span>}
      </label>
      <textarea
        id={fieldId}
        rows={rows}
        required={required}
        aria-invalid={Boolean(error)}
        className={cn(
          'w-full rounded-lg border bg-[#080908] px-3.5 py-2.5 text-sm text-[#F3F5EF] placeholder:text-[#929B90]/60 transition-colors duration-150 focus:outline-none focus:border-[#B8F34A] focus:ring-1 focus:ring-[#B8F34A]/30 resize-y',
          error ? 'border-red-500/70' : 'border-[#252D24] hover:border-[#344032]',
          className
        )}
        {...props}
      />
      {error ? (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-[#929B90]">{hint}</p>
      ) : null}
    </div>
  );
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement>, BaseFieldProps {}

export function Select({
  label,
  error,
  hint,
  required,
  id,
  className,
  children,
  ...props
}: SelectProps) {
  const autoId = useId();
  const fieldId = id || autoId;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-medium text-[#F3F5EF] flex items-center gap-1">
        <span>{label}</span>
        {required && <span className="text-[#B8F34A]" aria-hidden="true">*</span>}
      </label>
      <select
        id={fieldId}
        required={required}
        aria-invalid={Boolean(error)}
        className={cn(
          'min-h-[42px] w-full rounded-lg border bg-[#080908] px-3.5 py-2 text-sm text-[#F3F5EF] transition-colors duration-150 focus:outline-none focus:border-[#B8F34A] focus:ring-1 focus:ring-[#B8F34A]/30',
          error ? 'border-red-500/70' : 'border-[#252D24] hover:border-[#344032]',
          className
        )}
        {...props}
      >
        {children}
      </select>
      {error ? (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-[#929B90]">{hint}</p>
      ) : null}
    </div>
  );
}
