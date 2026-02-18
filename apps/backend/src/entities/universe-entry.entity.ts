import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "universe_entries" })
export class UniverseEntryEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column()
  symbol!: string;

  @Column({ type: "text", nullable: true })
  name?: string | null;

  @Column({ type: "float", nullable: true })
  marketCap?: number | null;

  @Column({ type: "text", nullable: true })
  marketCode?: string | null;

  @Column({ type: "text", nullable: true })
  marketName?: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
