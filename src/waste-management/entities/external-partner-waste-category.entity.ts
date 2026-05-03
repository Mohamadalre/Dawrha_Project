import { Column, Entity, OneToMany, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from "typeorm";
import { WasteCategory } from "./waste-category.entity";

import { ExternalPartnerProfile } from "@src/user/entities/profile/external-partner-profile.entity";


@Entity('External_Partner_waste_category')
export class ExternalPartnerWasteCategory {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToOne(() => ExternalPartnerProfile, (extpar) => extpar, {
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'External_partner_id' })
    externalPartner: ExternalPartnerProfile;

    @ManyToOne(() => WasteCategory, (wt) => wt.institutions, {
        nullable: true,
    })
    @JoinColumn({ name: 'waste_category_id' })
    wasteType: WasteCategory;

    @Column({ nullable: true })
    otherText: string;
}