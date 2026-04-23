import { Column, Index, JoinColumn, ManyToOne } from "typeorm";
import { City } from "@src/user/entities/location/city.entity";
import { Province } from "@src/user/entities/location/province.entity";
import { type Point } from "geojson";



export abstract class Location {
   @ManyToOne(() => Province)
   @JoinColumn({ name: 'province_id' })
   province: Province;


   @ManyToOne(() => City)
   @JoinColumn({ name: 'city_id' })
   city: City;

   @Index({ spatial: true })
   @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326, nullable: true })
   coordinates: Point;

   @Column({ nullable: true })
   address: string;


}