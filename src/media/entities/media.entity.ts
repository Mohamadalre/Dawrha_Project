
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn ,UpdateDateColumn} from 'typeorm';

export enum MediaType {
    INDUSTRIAL_REG = 'INDUSTRIAL_REG',
    LICENSE = 'LICENSE',
    ID_CARD_FRONT = 'ID_CARD_FRONT',
    ID_CARD_BACK = 'ID_CARD_BACK'
}

export enum OwnerType {
    COLLECTOR = 'COLLECTOR',
    INSTITUTIONS = 'INSTITUTIONS',
    FACTORY = 'FACTORY',
}
export enum statusMedia {
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
}
/**
 * Media Entity - Stores image metadata
 *
 * Database Fields:
 * - url: Cloudinary CDN URL (secure_url from Cloudinary response)
 * - publicId: Cloudinary public identifier (used for deletion/updates)
 * - fileType: Type of file (ID_CARD, LICENSE, etc.)
 * - ownerId: Reference to owner (User, Institution, Factory)
 * - ownerType: Type of owner
 * - status: Approval status (PENDING, APPROVED, REJECTED)
 *
 * Design Pattern:
 * - Only stores URL and publicId from Cloudinary
 * - No file content stored in database
 * - publicId enables atomic deletion operations
 * - url provides direct CDN access
 *
 * Indexes:
 * - (ownerId, fileType): Fast lookup for owner documents
 * - (ownerId, ownerType): Fast lookup for owner records
 * - status: Fast filtering for approval workflow
 */
@Entity('media')
export class Media {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    /**
     * Cloudinary CDN URL (secure_url)
     * Direct link to serve image files
     * Example: https://res.cloudinary.com/cloud_name/image/upload/v123/collectors/uuid/ID_CARD.jpg
     */
    @Column()
    url: string;

    /**
     * Cloudinary public ID (unique identifier)
     * Used to delete or update images in Cloudinary
     * Example: collectors/uuid/ID_CARD/timestamp
     */
    @Column()
    publicId: string;

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