import { LoggerService } from "@nestjs/common";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

type LogLevel = "log" | "error" | "warn" | "debug" | "verbose";

export class DailyFileLogger implements LoggerService {
  private currentDate = "";
  private readonly logDir: string;

  constructor(logDir?: string) {
    this.logDir = logDir ?? join(process.cwd(), "logs");
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  log(message: string, context?: string) {
    this.write("log", message, context);
  }

  error(message: string, trace?: string, context?: string) {
    const full = trace ? `${message}\n${trace}` : message;
    this.write("error", full, context);
  }

  warn(message: string, context?: string) {
    this.write("warn", message, context);
  }

  debug(message: string, context?: string) {
    this.write("debug", message, context);
  }

  verbose(message: string, context?: string) {
    this.write("verbose", message, context);
  }

  private write(level: LogLevel, message: string, context?: string) {
    const now = new Date();
    const date = this.formatDate(now);
    const time = now.toISOString();
    const ctx = context ? ` [${context}]` : "";
    const line = `${time} [${level.toUpperCase()}]${ctx} ${message}\n`;
    this.ensureDate(date);
    writeFileSync(this.logPath(date), line, { encoding: "utf-8", flag: "a" });
    // Always mirror to console
    // eslint-disable-next-line no-console
    console.log(line.trimEnd());
  }

  private ensureDate(date: string) {
    if (this.currentDate !== date) {
      this.currentDate = date;
    }
  }

  private logPath(date: string) {
    return join(this.logDir, `${date}.log`);
  }

  private formatDate(date: Date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
}
