import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    OneToMany
}from 'typeorm';
import { City } from './city.entity';

@Entity('provinces')
export class Province{
    @PrimaryGeneratedColumn('uuid')
    id:string;

    @Column({unique:true})
    name_en:string;

    @Column({unique:true})
    name_ar:string;

    //todo
    // @Column()
    // code:string;
  @OneToMany(()=>City,(city)=>city.province)
  cities:City[]

  

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

}