import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "portfolio_states" })
export class PortfolioState {
  @PrimaryColumn({ default: "default" })
  id!: string;

  @Column({ type: "float" })
  initialCapital!: number;

  @Column({ type: "float" })
  cash!: number;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
