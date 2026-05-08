import { Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from "typeorm";
import { WasteCategory } from "./waste-category.entity";

import { ExternalPartnerMaterial } from "@src/user/entities/material/external-partner-material.entity";


@Entity('External_Partner_waste_category')
export class ExternalPartnerWasteCategory {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToOne(() => ExternalPartnerMaterial, (material) => material.wasteTypes, {
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'material_id' })
    externalPartnerMaterial: ExternalPartnerMaterial;

    @ManyToOne(() => WasteCategory, (wt) => wt.institutions, {
        nullable: true,
    })
    @JoinColumn({ name: 'waste_category_id' })
    wasteType: WasteCategory;


}