import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    JoinColumn
}from 'typeorm';
import { Province } from './province.entity';

@Entity('cities')
export class City{
    @PrimaryGeneratedColumn('uuid')
    id:string;

    @Column({unique:true})
    name_en:string;

    @Column({unique:true})
    name_ar:string;

    //todo
    // @Column()
    // code:string;

  @ManyToOne(()=>Province,(province)=>province.cities)
  @JoinColumn({name:'province_id'})
  province:Province

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

}