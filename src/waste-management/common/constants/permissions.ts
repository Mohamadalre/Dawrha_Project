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
} as const;

export type WastePermissionKey = keyof typeof WASTE_PERMISSIONS;

/** Permissions granted to every commercial buyer role (citizen/company/factory/partner). */
const BUYER_PERMISSIONS: WastePermissionKey[] = [
  'waste.categories.view',
  'waste.products.view',
  'waste.offers.view',
  'waste.products.suggest',
  'cart.view',
  'cart.manage',
];

/** Extra permission only institutions hold (they alone are category-restricted). */
const INSTITUTION_EXTRA: WastePermissionKey[] = ['waste.categories.request'];

const ADMIN_PERMISSIONS = Object.keys(WASTE_PERMISSIONS) as WastePermissionKey[];

/**
 * Maps each platform role to the waste permission keys it should hold.
 * The prompt's roles map to this project's roles as:
 *   Individual -> CITIZEN, Company -> INSTITUTIONS,
 *   Factory -> FACTORY, Free Facility -> EXTERNAL_PARTNER.
 */
export const ROLE_PERMISSIONS_MAP: Partial<Record<Role, WastePermissionKey[]>> = {
  [Role.CITIZEN]: BUYER_PERMISSIONS,
  [Role.INSTITUTIONS]: [...BUYER_PERMISSIONS, ...INSTITUTION_EXTRA],
  [Role.FACTORY]: BUYER_PERMISSIONS,
  [Role.EXTERNAL_PARTNER]: BUYER_PERMISSIONS,
  [Role.ADMIN]: ADMIN_PERMISSIONS,
};
