import { Column, Entity, OneToMany, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from "typeorm";
import { WasteCategory } from "./waste-category.entity";
import { FactoryProfile } from "@src/user/entities/profile/factory-profile.entity";


@Entity('factory_waste_category')
export class FactoryWasteCategory {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToOne(() => FactoryProfile, (fac) => fac, {
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'factory_id' })
    factory: FactoryProfile;

    @ManyToOne(() => WasteCategory, (wt) => wt.institutions, {
        nullable: true,
    })
    @JoinColumn({ name: 'waste_category_id' })
    wasteType: WasteCategory;

    @Column({ nullable: true })
    otherText: string;
}