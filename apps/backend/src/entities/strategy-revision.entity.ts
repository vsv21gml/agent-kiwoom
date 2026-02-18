import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "strategy_revisions" })
export class StrategyRevision {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  source!: string;

  @Column({ type: "text" })
  content!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
