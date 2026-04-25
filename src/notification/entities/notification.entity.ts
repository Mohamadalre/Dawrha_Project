import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    ManyToOne,
} from "typeorm";
import { Account } from "@src/user/entities/account.entity";

@Entity("notifications")
export class Notification {

    @PrimaryGeneratedColumn("uuid")
    id: string;


    @ManyToOne(() => Account, (user) => user.id, {
        onDelete: "CASCADE",
    })
    user: Account;

    @Column()
    title: string;

    @Column()
    message: string;


    @CreateDateColumn()
    createdAt: Date;
}
