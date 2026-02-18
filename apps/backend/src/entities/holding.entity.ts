import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "holdings" })
export class Holding {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ unique: true })
  symbol!: string;

  @Column({ type: "int" })
  quantity!: number;

  @Column({ type: "float" })
  avgPrice!: number;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
