import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "universe_revisions" })
export class UniverseRevision {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  source!: string;

  @Column({ type: "int" })
  entryCount!: number;

  @Column({ type: "text", nullable: true })
  note?: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
