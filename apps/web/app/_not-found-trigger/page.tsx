import { notFound } from "next/navigation";

// middleware.ts's rewrite target for reserved/not_found/multi-label/malformed-Host/root-only-path
// cases (spec 004 FR-003, FR-006, FR-007, FR-013). Calling notFound() renders the nearest
// not-found.tsx boundary with a real 404 status — never reachable directly by a normal navigation,
// only via a middleware rewrite.
export default function NotFoundTrigger(): never {
  notFound();
}
