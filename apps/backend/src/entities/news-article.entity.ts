import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "news_articles" })
export class NewsArticle {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  title!: string;

  @Column({ unique: true })
  url!: string;

  @Column()
  source!: string;

  @Column({ type: "timestamptz", nullable: true })
  publishedAt?: Date | null;

  @Column({ type: "text", nullable: true })
  summary?: string | null;

  @Column({ type: "text", nullable: true })
  content?: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
