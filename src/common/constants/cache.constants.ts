/**
 * Redis keys for global reference data cached outside the per-account and
 * catalogue caches.
 *
 * Provinces (governorates) are the same list for every account and change only
 * when an administrator edits them, so they are cached ONCE globally rather
 * than per-account. The version counter is bumped by the province-admin
 * create/update/delete paths; every cached page embeds the current version, so
 * a bump makes all old pages unreachable in O(1) (no SCAN) and they expire on
 * their TTL. Shared here so the reader (user app) and the writer (province
 * admin) cannot drift apart on the key string.
 */
export const PROVINCES_CACHE_VERSION_KEY = 'geo:ver:provinces';
export const provincesCacheKey = (version: string, parts: string): string =>
  `geo:provinces:v${version}:${parts}`;
export const PROVINCES_CACHE_TTL_SECONDS = 24 * 60 * 60; // 24h
