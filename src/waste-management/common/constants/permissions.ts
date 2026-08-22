import { Role } from '@src/user/enums/role.enum';

/**
 * Catalogue of permission keys used by the waste-management / marketplace APIs.
 * These keys are consumed by the existing PermissionsGuard (@src/permission) via
 * the @Permissions() decorator. We never modify the permission module itself —
 * we only register these keys and their role mappings in the database
 * (see PermissionSeederService).
 */
export const WASTE_PERMISSIONS = {
  'waste.categories.view': 'View product categories',
  'waste.products.view': 'View products',
  'waste.products.suggest': 'Suggest new products',
  'waste.products.availability': 'View per-warehouse product availability',
  'waste.products.popular': 'View the most-ordered materials',
  'waste.materials.view': 'View products under the categories selected in onboarding',
  'waste.offers.view': 'View offers',
  'waste.categories.request': 'Request additional assigned categories',
  'cart.view': 'View cart',
  'cart.manage': 'Manage cart (add, update, remove)',
  'admin.categories.request.manage': 'Review category-add requests',
  'admin.waste.manage': 'Full waste management',
  'admin.waste.create': 'Create categories/products',
  'admin.waste.update': 'Update categories/products',
  'admin.waste.delete': 'Delete categories/products',
  'admin.pricing.manage': 'Set product pricing',
  'admin.warehouse.view': 'View warehouse data',
  'admin.warehouse.manage': 'Create and manage warehouses',
  'admin.warehouse.sync': 'Sync warehouse with Odoo',
  'admin.reports.view': 'View reports and statistics',
  'admin.accounts.view': 'View accounts and onboarding profiles',
  'admin.accounts.manage': 'Manage account status and media moderation',
  'admin.trucks.view': 'View trucks and live tracking',
  'admin.trucks.manage': 'Create and manage trucks',
  'admin.shifts.manage': 'Edit work shift times',
  'admin.delivery.rate.view': 'View the per-kilometre delivery rate',
  'admin.delivery.rate.manage': 'Set the per-kilometre delivery rate',
  'collection.requests.create': 'Create collection requests (citizens and institutions)',
  'collection.requests.view': 'View own collection requests',
  'collection.requests.cancel': 'Cancel own collection requests',
  'collection.plans.view': 'View own collection plan',
  'collection.plans.manage': 'Manage own collection plan',
  'collection.driver.view': 'View assigned collection requests (driver)',
  'collection.driver.manage': 'Execute collection stops (driver)',
  'collection.admin.view': 'View all collection requests and plans (admin)',
  'collection.admin.manage': 'Assign and cancel collection requests (admin)',
  'collection.coverage.manage': 'Manage coverage points (admin)',
  'collection.dispatch.manage': 'Manage dispatch configuration (admin)',
} as const;

export type WastePermissionKey = keyof typeof WASTE_PERMISSIONS;

/** Permissions granted to every commercial buyer role (citizen/company/factory/partner). */
const BUYER_PERMISSIONS: WastePermissionKey[] = [
  'waste.categories.view',
  'waste.products.view',
  'waste.offers.view',
  'waste.products.suggest',
  // Held by EVERY buyer role. The list is ranked globally and then filtered to
  // what the reader's tier can actually buy, so it is safe for all of them and
  // useful to all of them.
  'waste.products.popular',
  'cart.view',
  'cart.manage',
];

/** Extra permission only institutions hold (they alone are category-restricted). */
const INSTITUTION_EXTRA: WastePermissionKey[] = ['waste.categories.request'];

/** Per-warehouse stock visibility: factories & free facilities only. */
const AVAILABILITY_EXTRA: WastePermissionKey[] = ['waste.products.availability'];

/** "My materials" (onboarding-selected categories): the three commercial roles. */
const MATERIALS_EXTRA: WastePermissionKey[] = ['waste.materials.view'];

/** All collection-related permissions — granted to every role EXCEPT plans. */
const ALL_COLLECTION_PERMISSIONS: WastePermissionKey[] = [
  'collection.requests.create',
  'collection.requests.view',
  'collection.requests.cancel',
  'collection.driver.view',
  'collection.driver.manage',
  'collection.admin.view',
  'collection.admin.manage',
  'collection.coverage.manage',
  'collection.dispatch.manage',
];

const ADMIN_PERMISSIONS = Object.keys(WASTE_PERMISSIONS) as WastePermissionKey[];

/**
 * Maps each platform role to the waste permission keys it should hold.
 * The prompt's roles map to this project's roles as:
 *   Individual -> CITIZEN, Company -> INSTITUTIONS,
 *   Factory -> FACTORY, Free Facility -> EXTERNAL_PARTNER.
 */
export const ROLE_PERMISSIONS_MAP: Partial<Record<Role, WastePermissionKey[]>> = {
  [Role.CITIZEN]: [...BUYER_PERMISSIONS, ...ALL_COLLECTION_PERMISSIONS],
  [Role.INSTITUTIONS]: [
    ...BUYER_PERMISSIONS,
    ...INSTITUTION_EXTRA,
    ...MATERIALS_EXTRA,
    ...ALL_COLLECTION_PERMISSIONS,
    'collection.plans.view',
    'collection.plans.manage',
  ],
  [Role.FACTORY]: [...BUYER_PERMISSIONS, ...AVAILABILITY_EXTRA, ...MATERIALS_EXTRA, ...ALL_COLLECTION_PERMISSIONS],
  [Role.EXTERNAL_PARTNER]: [...BUYER_PERMISSIONS, ...AVAILABILITY_EXTRA, ...MATERIALS_EXTRA, ...ALL_COLLECTION_PERMISSIONS],
  [Role.COLLECTOR]: ALL_COLLECTION_PERMISSIONS,
  [Role.ADMIN]: ADMIN_PERMISSIONS,
};
