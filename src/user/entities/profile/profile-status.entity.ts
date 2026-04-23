import { Column } from "typeorm";

 
 export class ProfileStatus{
   @Column({default:false})
   addProfileData:boolean;

   @Column({default:false})
   addLocation:boolean;
 }