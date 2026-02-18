import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "api_call_logs" })
export class ApiCallLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  provider!: string;

  @Column()
  endpoint!: string;

  @Column()
  method!: string;

  @Column({ type: "jsonb", nullable: true })
  requestBody?: Record<string, unknown> | null;

  @Column({ type: "jsonb", nullable: true })
  responseBody?: Record<string, unknown> | null;

  @Column({ type: "int", nullable: true })
  statusCode?: number | null;

  @Column({ default: true })
  success!: boolean;

  @Column({ type: "text", nullable: true })
  errorMessage?: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
