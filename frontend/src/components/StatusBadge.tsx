import type { ReactNode } from "react";
import "./StatusBadge.css";

interface StatusBadgeProps {
  variant: "spawned" | "despawned" | "data_issue" | "ok" | "warn" | "error" | "info";
  children: ReactNode;
}

const variantMap: Record<StatusBadgeProps["variant"], string> = {
  spawned: "badge--ok",
  ok: "badge--ok",
  despawned: "badge--error",
  error: "badge--error",
  data_issue: "badge--warn",
  warn: "badge--warn",
  info: "badge--info",
};

export default function StatusBadge({ variant, children }: StatusBadgeProps) {
  return (
    <span className={`badge ${variantMap[variant]}`}>
      {children}
    </span>
  );
}
