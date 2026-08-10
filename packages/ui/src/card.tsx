import React from "react";

export interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "className"> {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className = "", ...rest }: CardProps) {
  return (
    <div className={`surface-card ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}
