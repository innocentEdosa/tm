import React from "react";

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
}

export function PageHeader({ title, subtitle }: PageHeaderProps) {
  return (
    <div className="shell-page-header">
      <h1 className="shell-page-header-title">{title}</h1>
      {subtitle && <p className="shell-page-header-subtitle">{subtitle}</p>}
    </div>
  );
}
