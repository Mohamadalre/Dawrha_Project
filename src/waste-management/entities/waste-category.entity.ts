import { Column, Entity, OneToMany, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from "typeorm";
import { InstitutionWasteCategory } from "./institution-waste-category.entity";



@Entity('waste_categories')
export class WasteCategory {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    name: string;

    @Column()
    imageCategoryURL: string;

    @OneToMany(() => InstitutionWasteCategory, (iwt) => iwt.wasteType)
    institutions: InstitutionWasteCategory[];

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}