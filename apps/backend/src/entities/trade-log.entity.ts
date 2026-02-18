import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "trade_logs" })
export class TradeLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  symbol!: string;

  @Column()
  side!: string;

  @Column({ type: "int" })
  quantity!: number;

  @Column({ type: "float" })
  price!: number;

  @Column({ type: "float" })
  totalAmount!: number;

  @Column({ type: "text", nullable: true })
  reason?: string | null;

  @Column()
  mode!: string;

  @Column({ type: "float", nullable: true })
  realizedPnl?: number | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
