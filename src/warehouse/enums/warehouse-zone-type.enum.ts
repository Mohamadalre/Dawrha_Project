/**
 * Zone types a warehouse can be divided into — mirrors the Selection on the
 * Odoo `recycle.zone` model (receiving / sorting / storage / output).
 */
export enum WarehouseZoneType {
  RECEIVING = 'receiving',
  SORTING = 'sorting',
  STORAGE = 'storage',
  OUTPUT = 'output',
}
