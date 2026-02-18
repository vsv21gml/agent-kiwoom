import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "gemini_call_logs" })
export class GeminiCallLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  model!: string;

  @Column({ type: "text" })
  inputText!: string;

  @Column({ type: "text", nullable: true })
  outputText?: string | null;

  @Column({ type: "int", nullable: true })
  promptTokenCount?: number | null;

  @Column({ type: "int", nullable: true })
  candidatesTokenCount?: number | null;

  @Column({ type: "int", nullable: true })
  totalTokenCount?: number | null;

  @Column({ default: true })
  success!: boolean;

  @Column({ type: "int", nullable: true })
  statusCode?: number | null;

  @Column({ type: "text", nullable: true })
  errorMessage?: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
