import { Column, JoinColumn, ManyToOne, Entity, PrimaryGeneratedColumn } from "typeorm";
import { Province } from "@src/user/entities/location/province.entity";
import { CitizenProfile } from "../profile/citizen-profile.entity";




@Entity('locations')
export class Location {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Province,)
  @JoinColumn({ name: 'province_id' })
  province: Province;

  @ManyToOne(() => CitizenProfile, (p) => p.locations, {
    nullable: true,
    onDelete: 'CASCADE'
  })
  cititzenProfile: CitizenProfile
  
  @Column({ nullable: true })
  DesscriptLocation?: string;

  @Column({
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable:true
  })
  coordinates: {
    type: 'Point';
    coordinates: number[];
  };

  @Column()
  address: string;



}