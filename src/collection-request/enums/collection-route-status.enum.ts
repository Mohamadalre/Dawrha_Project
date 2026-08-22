/**
 * Lifecycle of a driver's collection route.
 *
 * A route is a driver-owned run of requests ordered by `route_sequence`;
 * requests join it when assigned and leave it only when it completes or is
 * cancelled. The driver's tour for the day is "my active route, ordered".
 */
export enum CollectionRouteStatus {
  /** Empty or being assembled; the driver may still merge requests into it. */
  PLANNED = 'PLANNED',
  /** The driver started executing it; no more merging. */
  IN_PROGRESS = 'IN_PROGRESS',
  /** Every request on the route is finished. */
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export const COLLECTION_ROUTE_TRANSITIONS: Record<
  CollectionRouteStatus,
  readonly CollectionRouteStatus[]
> = {
  [CollectionRouteStatus.PLANNED]: [
    CollectionRouteStatus.IN_PROGRESS,
    CollectionRouteStatus.CANCELLED,
  ],
  [CollectionRouteStatus.IN_PROGRESS]: [
    CollectionRouteStatus.COMPLETED,
    CollectionRouteStatus.CANCELLED,
  ],
  [CollectionRouteStatus.COMPLETED]: [],
  [CollectionRouteStatus.CANCELLED]: [],
};

export const TERMINAL_COLLECTION_ROUTE_STATUSES: readonly CollectionRouteStatus[] = [
  CollectionRouteStatus.COMPLETED,
  CollectionRouteStatus.CANCELLED,
];

export function canTransitionRoute(
  from: CollectionRouteStatus,
  to: CollectionRouteStatus,
): boolean {
  return COLLECTION_ROUTE_TRANSITIONS[from].includes(to);
}
