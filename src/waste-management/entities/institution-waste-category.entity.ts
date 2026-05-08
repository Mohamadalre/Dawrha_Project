import {  Entity, PrimaryGeneratedColumn,ManyToOne,JoinColumn } from "typeorm";
import { InstitutionMaterial } from "@src/user/entities/material/institution-material.entity";
import { WasteCategory } from "./waste-category.entity";


@Entity('institution_waste_category')
export class InstitutionWasteCategory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => InstitutionMaterial, (inputs) => inputs.wasteTypes, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'material_inputs_id' })
  institution: InstitutionMaterial;

  @ManyToOne(() => WasteCategory, (wt) => wt.institutions, {
    nullable: true,
  })
  @JoinColumn({ name: 'waste_category_id' })
  wasteType: WasteCategory;


}