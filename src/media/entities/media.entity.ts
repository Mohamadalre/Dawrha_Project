
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn ,UpdateDateColumn} from 'typeorm';

export enum MediaType {
    INDUSTRIAL_REG = 'INDUSTRIAL_REG',
    LICENSE = 'LICENSE',
    ID_CARD_FRONT = 'ID_CARD_FRONT',
    ID_CARD_BACK = 'ID_CARD_BACK'
}

export enum OwnerType {
    COLLECTOR = 'COLLECTOR',
    INSITUTIONS = 'INSITUTIONS',
    FACTORY = 'FACTORY',
}
export enum statusMedia {
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
}
@Entity('media')
export class Media {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    url: string;

    @Column({ type: 'enum', enum: MediaType })
    fileType: MediaType;

    @Column()
    ownerId: string;

    @Column({ type: 'enum', enum: OwnerType })
    ownerType: OwnerType;

    @Column({ type: 'enum', enum: statusMedia, default: statusMedia.PENDING })
    status: statusMedia;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}