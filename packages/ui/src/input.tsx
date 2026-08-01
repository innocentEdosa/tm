import React from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, id, className = "", ...props }, ref) => {
    const inputId = id ?? props.name;
    return (
      <div>
        {label && (
          <label htmlFor={inputId} className="field-label">
            {label}
            {props.required && <span className="text-red-600"> *</span>}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`field-input ${className}`.trim()}
          aria-invalid={error ? true : undefined}
          {...props}
        />
        {error && <p className="field-error">{error}</p>}
        {!error && hint && <p className="field-hint">{hint}</p>}
      </div>
    );
  },
);
Input.displayName = "Input";
