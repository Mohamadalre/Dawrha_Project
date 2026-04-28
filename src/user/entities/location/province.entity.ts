import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    OneToMany
}from 'typeorm';

@Entity('provinces')
export class Province{
    @PrimaryGeneratedColumn('uuid')
    id:string;

    @Column({unique:true})
    name_en:string;

    @Column({unique:true})
    name_ar:string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

}