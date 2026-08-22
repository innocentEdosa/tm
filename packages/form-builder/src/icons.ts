import {
  TrendingUp,
  Settings,
  Monitor,
  Users,
  Target,
  ClipboardList,
  AlertTriangle,
  BookOpen,
  Briefcase,
  GraduationCap,
  Layers,
  Zap,
  Shield,
  Flag,
  Star,
  CheckCircle,
  Clock,
  MapPin,
  MessageSquare,
  FileText,
  type LucideIcon,
} from "lucide-react";

/** A small, curated icon set a Super Admin can attach to a form section (or, via a field's own
 * `validation.optionIcons` map, to an individual select/multiselect/radio option) — purely
 * presentational, resolved client-side from a stored name (never a component reference, which
 * can't cross the server/client boundary or survive a JSON round-trip through the API). Mirrors
 * `@tm/ui`'s own `ICONS` registry pattern (`app-shell.tsx`) for nav icons — kept as this
 * package's own registry rather than importing that one, since the icon *set* relevant to form
 * content (growth, gaps, people, priority, …) is a different vocabulary than app navigation. */
export const FORM_ICONS = {
  trendingUp: TrendingUp,
  settings: Settings,
  monitor: Monitor,
  users: Users,
  target: Target,
  clipboardList: ClipboardList,
  alertTriangle: AlertTriangle,
  bookOpen: BookOpen,
  briefcase: Briefcase,
  graduationCap: GraduationCap,
  layers: Layers,
  zap: Zap,
  shield: Shield,
  flag: Flag,
  star: Star,
  checkCircle: CheckCircle,
  clock: Clock,
  mapPin: MapPin,
  messageSquare: MessageSquare,
  fileText: FileText,
} satisfies Record<string, LucideIcon>;

export type FormIconName = keyof typeof FORM_ICONS;

export function isFormIconName(value: string): value is FormIconName {
  return value in FORM_ICONS;
}

/** Resolves a stored icon name to its component, or `null` for an unset/unrecognized name (e.g.
 * a name from a future registry version this build predates) — callers render nothing rather
 * than throwing, matching this field's fully-optional, purely-presentational role. */
export function resolveFormIcon(name: string | null | undefined): LucideIcon | null {
  if (!name || !isFormIconName(name)) return null;
  return FORM_ICONS[name];
}
