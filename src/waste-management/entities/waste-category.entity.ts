import { Column, Entity, OneToMany, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from "typeorm";
import { InstitutionWasteCategory } from "./institution-waste-category.entity";
import { Product } from "./product.entity";
import { OdooSyncStatus } from "../enums/odoo-sync-status.enum";



@Entity('waste_categories')
export class WasteCategory {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    name: string;

    @Column({ type: 'text', nullable: true })
    description?: string;

    @Column()
    imageCategoryURL: string;

    @Column({ default: true })
    isActive: boolean;

    @Column({ type: 'int', nullable: true })
    odooCategoryId?: number;

    @Column({ type: 'enum', enum: OdooSyncStatus, default: OdooSyncStatus.PENDING })
    odooSyncStatus: OdooSyncStatus;

    @OneToMany(() => InstitutionWasteCategory, (iwt) => iwt.wasteType)
    institutions: InstitutionWasteCategory[];

    @OneToMany(() => Product, (product) => product.category)
    products: Product[];

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
