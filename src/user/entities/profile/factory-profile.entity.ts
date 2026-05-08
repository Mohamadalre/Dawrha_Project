import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Account } from '../account.entity';
import { LocationBase } from '@src/common/entities/location-base.entity';
import { FactoryMaterial } from '../material/factory-material.entity';



@Entity('factory_profiles')
export class FactoryProfile extends LocationBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Account, (account) => account.factoryProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @OneToOne(() => FactoryMaterial, (material) => material.factoryProfile, { cascade: true })
  @JoinColumn({ name: 'material_id' })
  factoryMaterial: FactoryMaterial;

  
  @Column()
  factoryName: string;



  @Column({  nullable: false, unique:true })
  factoryPhone: string;

  @Column({  nullable: false , unique:true })
  commercialRecord: string;

  @Column({  nullable: false,unique:true })
  industrialRecord: string;

  @Column({ nullable: true })
  taxNumber?: string;

  @Column({nullable:true})
  factorySlogo?: string;


  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
