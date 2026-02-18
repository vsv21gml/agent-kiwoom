import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "portfolio_snapshots" })
export class PortfolioSnapshot {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "float" })
  cash!: number;

  @Column({ type: "float" })
  holdingsValue!: number;

  @Column({ type: "float" })
  totalAsset!: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
