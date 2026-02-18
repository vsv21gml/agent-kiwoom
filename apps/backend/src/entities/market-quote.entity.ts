import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "market_quotes" })
export class MarketQuote {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  symbol!: string;

  @Column({ type: "float" })
  price!: number;

  @Column({ type: "float" })
  changeRate!: number;

  @Column({ type: "float" })
  volume!: number;

  @Column({ type: "timestamptz" })
  asOf!: Date;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
