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

  @ManyToOne(() => Account, {
    onDelete: 'CASCADE',
  })
  user: Account;

  @Column()
  title: string;

  @Column()
  body: string;

  @Column({ type: 'json', nullable: true })
  data: Record<string, any>;

  @Column({ default: false })
  isRead: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
