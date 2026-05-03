import { Column, Entity, OneToMany, PrimaryGeneratedColumn,ManyToOne,JoinColumn } from "typeorm";
import { InstitutionProfile } from "@src/user/entities/profile/institution-profile.entity";
import { WasteCategory } from "./waste-category.entity";


@Entity('institution_waste_category')
export class InstitutionWasteCategory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => InstitutionProfile, (inst) => inst, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'institution_id' })
  institution: InstitutionProfile;

  @ManyToOne(() => WasteCategory, (wt) => wt.institutions, {
    nullable: true,
  })
  @JoinColumn({ name: 'waste_category_id' })
  wasteType: WasteCategory;

  @Column({ nullable: true })
  otherText: string;
}