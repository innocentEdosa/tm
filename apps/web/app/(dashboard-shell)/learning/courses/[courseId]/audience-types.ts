/** Shared shapes between `settings-tab.tsx` (the Audience Builder orchestrator) and
 * `audience-builder-panel.tsx` (the "Specific people" tabs). */

export interface UserSearchResult {
  id: string;
  fullName: string;
  email: string;
}

/** Two distinct, independent dates every assignment target can carry: `startsAt` is when access
 * *begins* (`null` = immediately); `completionDeadline` is when the course is *due* (`null` = no due
 * date). Neither implies the other. */
export interface AssignmentDates {
  startsAt: string | null;
  completionDeadline: string | null;
}

/** An individually-assigned user carries their own dates, independent of any department/role they
 * may also belong to. */
export interface SelectedUser extends UserSearchResult, AssignmentDates {}

/** A department/role as shown in the picker list — `memberCount` comes from the existing
 * `GET /tenant/departments` / `GET /tenant/roles` endpoints, which already compute it. */
export interface CatalogEntry {
  id: string;
  name: string;
  memberCount: number;
}

/** A selected department/role, with the one pair of dates shared by everyone reached through it. */
export interface SelectedGroup extends AssignmentDates {
  id: string;
  name: string;
}
