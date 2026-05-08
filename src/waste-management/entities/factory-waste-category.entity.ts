import {  Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from "typeorm";
import { WasteCategory } from "./waste-category.entity";
import { FactoryMaterial } from "@src/user/entities/material/factory-material.entity";


@Entity('factory_waste_category')
export class FactoryWasteCategory {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToOne(() => FactoryMaterial, (material) => material.wasteTypes, {
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'material_id' })
    factoryMaterial: FactoryMaterial;

    @ManyToOne(() => WasteCategory, (wt) => wt.institutions, {
        nullable: true,
    })
    @JoinColumn({ name: 'waste_category_id' })
    wasteType: WasteCategory;


}