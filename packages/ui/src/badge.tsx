import React from "react";

export interface BadgeProps {
  variant?: "success" | "warning" | "neutral" | "accent" | "danger";
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = "neutral", children, className = "" }: BadgeProps) {
  return <span className={`badge badge-${variant} ${className}`.trim()}>{children}</span>;
}
