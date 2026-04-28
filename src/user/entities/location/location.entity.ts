import { Column, Index, JoinColumn, ManyToOne, Entity, CreateDateColumn, UpdateDateColumn ,PrimaryGeneratedColumn} from "typeorm";
import { Province } from "@src/user/entities/location/province.entity";
import { type Point } from "geojson";



@Entity('locations')
export class Location {
   
    @PrimaryGeneratedColumn('uuid')
    id:string;

   @ManyToOne(() => Province,)
   @JoinColumn({ name: 'province_id' })
   province: Province;

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

   @Column()
   address: string;
   
   @CreateDateColumn()
   createdAt: Date;

   @UpdateDateColumn()
   updatedAt: Date;

}