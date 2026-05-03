import { InstitutionProfile } from "@src/user/entities/profile/institution-profile.entity";
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn,OneToOne } from "typeorm";

@Entity('institution_types')
export class InstitutionType {
    @PrimaryGeneratedColumn('uuid')
    id: string;
    @OneToOne(() => InstitutionProfile, (profile) => profile.institutionType, { cascade: true, nullable: true })
    institutionProfile: InstitutionProfile;

    @Column({ unique: true })
    name: string;

    @Column({ nullable: true })
    otherText: string;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}