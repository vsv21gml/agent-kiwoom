import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "news_scrape_runs" })
export class NewsScrapeRun {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  source!: string;

  @Column({ type: "text", nullable: true })
  query?: string | null;

  @Column({ type: "int" })
  itemCount!: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
