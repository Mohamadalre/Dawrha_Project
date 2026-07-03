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

    // No inverse side: WasteCategory.institutions is the InstitutionWasteCategory
    // collection only — this external-partner link must not reuse it.
    @ManyToOne(() => WasteCategory, {
        nullable: true,
    })
    @JoinColumn({ name: 'waste_category_id' })
    wasteType: WasteCategory;


}