/** The dispatch engine's durable job queue. */
export const COLLECTION_DISPATCH_QUEUE = 'collection-dispatch';

/** Job names on the dispatch queue. */
export const DISPATCH_JOB = {
  /** Run the full election for one request (queue entry, next candidate). */
  ELECT: 'ELECT',
  /** A scheduled/plan request's queue window opened (delayed job). */
  OPEN_WINDOW: 'OPEN_WINDOW',
  /** A driver became more attractive (moved, freed) — elect the oldest queued request. */
  ELECT_NEXT_FOR_DRIVER: 'ELECT_NEXT_FOR_DRIVER',
} as const;

/** Redis keys owned by the dispatch engine. */
export const DISPATCH_REDIS = {
  /** accept-window TTL: set(key) exists while the offer may still be accepted. */
  offerKey: (assignmentId: string) => `dispatch:offer:${assignmentId}`,
  /** Fast path from driver profile id -> pending offer id. */
  driverOfferKey: (driverId: string) => `dispatch:offer:driver:${driverId}`,
  /** Location-trigger throttle per driver. */
  locationThrottleKey: (driverId: string) => `dispatch:loc-throttle:${driverId}`,
  /** How long an offer stays open (seconds) — mirrors dispatch_config.accept_window_sec. */
  acceptWindowTtl: (seconds: number) => seconds,
  /** SET of active request IDs assigned to a truck (for live GPS forwarding). */
  truckRequestsKey: (truckId: string) => `dispatch:truck-requests:${truckId}`,
  /** HASH mapping requestId → truckId (for cleanup when a request completes). */
  requestTruckKey: () => 'dispatch:request-truck-map',
} as const;