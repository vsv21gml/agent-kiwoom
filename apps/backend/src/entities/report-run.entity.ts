import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "report_runs" })
export class ReportRun {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  runId!: string;

  @Column({ type: "float" })
  totalAsset!: number;

  @Column({ type: "float" })
  holdingsValue!: number;

  @Column({ type: "float", default: 0 })
  assetDelta!: number;

  @Column({ type: "float" })
  cash!: number;

  @Column({ type: "int" })
  buyCount!: number;

  @Column({ type: "int" })
  sellCount!: number;

  @Column({ type: "int" })
  tradeCount!: number;

  @Column({ type: "int" })
  decisionCount!: number;

  @Column({ type: "int" })
  universeSize!: number;

  @Column({ type: "text" })
  reportText!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
