# Waste-Management Marketplace (Home Screen APIs)

This implements the home-screen / marketplace APIs (categories, products,
offers, cart, suggestions, admin catalogue, pricing, warehouses) described in the
project brief, built **on top of** the existing permission system at
`src/permission` (which is used, never modified).

## Module layout

Each folder is a self-contained NestJS module. Shared domain entities/enums stay
centralised (they are referenced across the project); the app layer is split by
bounded context:

```
waste-management/
├── entities/                    # shared domain entities (referenced project-wide)
├── enums/                       # shared domain enums
├── common/                      # WasteCommonModule — domain kernel
│   ├── constants/permissions.ts #   permission keys + role map
│   ├── dto/pagination.dto.ts    #   shared pagination
│   └── providers/               #   AuditService, AssignedCategoryProvider, PermissionSeeder
├── catalog/                     # CatalogModule — categories/products/search/offers/home
├── cart/                        # CartModule — cart + per-role limits
├── suggestions/                 # SuggestionsModule — product suggestions
├── admin/                       # WasteAdminModule — admin CRUD + pricing/
└── waste-management.module.ts   # legacy waste-category endpoints (image upload)
```

- **`WasteCommonModule`** exports `AuditService` + `AssignedCategoryProvider` and
  seeds permissions on boot; imported by the feature modules that need them.
- **`CatalogModule`**, **`CartModule`**, **`SuggestionsModule`**, **`WasteAdminModule`**
  each own their controllers/services/DTOs and register only the entities they use.

Warehouse read/sync lives in `src/warehouse`; Odoo jobs in `src/odoo-sync`;
cleanup cron in `src/maintenance`.

## Role mapping (brief → this codebase)

| Brief role      | Project role (`Role` enum) | Pricing tier |
| --------------- | -------------------------- | ------------ |
| Individual      | `CITIZEN`                  | INDIVIDUAL   |
| Company         | `INSTITUTIONS`             | COMPANY      |
| Factory         | `FACTORY`                  | FACTORY      |
| Free Facility   | `EXTERNAL_PARTNER`         | FACTORY      |
| Admin           | `ADMIN`                    | —            |

Company / Factory / Free-Facility callers are **automatically restricted** to the
waste categories assigned to them at registration (resolved by
`AssignedCategoryProvider`). This is why the canonical endpoints below serve every
buyer role — the separate `/company` variants in the brief are not needed because
filtering is role-driven.

## Permissions

Permission keys live in `constants/permissions.ts` and are seeded into the
`permissions` / `role_permissions` tables on boot by `PermissionSeederService`
(idempotent). Every endpoint is protected with
`@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@Permissions('...')`.

## Endpoints (all under `/api/v1`)

Buyer (CITIZEN / INSTITUTIONS / FACTORY / EXTERNAL_PARTNER):
- `GET    /waste/home`
- `GET    /waste/categories`
- `GET    /waste/categories/:categoryId/products`
- `GET    /waste/search`
- `GET    /waste/products/by-price`
- `GET    /waste/offers`
- `GET    /waste/offers/search`
- `POST   /waste/products/suggest`
- `GET    /cart` · `POST /cart/items` · `PUT /cart/items/:itemId` · `DELETE /cart/items/:itemId` · `POST /cart/offers`

Admin:
- `GET/POST /admin/waste/categories` · `PUT/DELETE /admin/waste/categories/:categoryId`
- `GET/POST /admin/waste/products` · `PUT/DELETE /admin/waste/products/:productId`
- `POST   /admin/waste/products/:productId/pricing`
- `GET    /admin/warehouses` · `GET /admin/warehouses/:warehouseId/inventory`
- `POST   /admin/warehouses/import-odoo` (pull warehouses + managers FROM Odoo)
- `POST   /admin/warehouses/:warehouseId/sync-odoo` (pull that warehouse's inventory)

> Warehouses and their managers are **created inside Odoo**, never via this
> backend. The backend only mirrors them locally via `import-odoo` and then syncs
> inventory. There is no warehouse/manager creation endpoint.

## Odoo sync (Bull queue, never direct from request)

All Odoo writes go through the `waste-odoo-sync` BullMQ queue (`src/odoo-sync`).
Jobs use per-job retry/backoff and the processor performs **compensation**: if a
category/product fails to sync to Odoo after all retries, the local record is
deleted and admins are notified. Warehouse inventory is pulled from Odoo via the
`sync-warehouse-from-odoo` job.

## Maintenance cron (`src/maintenance`)

Daily/periodic cleanup of expired notifications, ghost accounts, expired carts and
stale suggestions. Set `MAINTENANCE_WORKER=false` on API instances and run a single
worker process with it unset/true so cleanup runs in one place only.

## ⚠️ Database migration required

The app runs with `synchronize: false` and `migrationsRun: true`. After pulling
these changes, generate and apply a migration for the new tables/columns
(`products`, `product_pricing`, `offers`, `carts`, `cart_items`,
`product_suggestions`, `audit_logs`, `warehouse_inventory`, plus new columns on
`waste_categories` and `warehouses`):

```bash
npm run migration:generate -- db/migrations/MarketplaceMigration
npm run migration:run
```
