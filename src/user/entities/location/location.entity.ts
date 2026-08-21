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

  /**
   * A human label the citizen gives the place — "Home", "Work". It is what they
   * pick from when choosing where an order is collected, so it is the location's
   * identity to THEM, not a globally unique key: two people may both have a
   * "Home", but ONE person may not (a partial unique index enforces that per
   * profile, case-insensitively). Nullable so onboarding's first location, and
   * every location created before this, stays valid without one.
   */
  @Column({ nullable: true })
  name?: string;

  @Column({ nullable: true })
  DesscriptLocation?: string;


  @Column({
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,

  })
  coordinates: {
    type: 'Point';
    coordinates: number[];
  };

  
  @Column({nullable:true})
  address: string;



}