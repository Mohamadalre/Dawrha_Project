import { Column, JoinColumn, ManyToOne } from "typeorm";
import { Province } from "@src/user/entities/location/province.entity";





export  class LocationBase {

  @ManyToOne(() => Province,)
  @JoinColumn({ name: 'province_id', })
  province: Province;

  
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

  @Column({nullable:true})
  address: string;



}