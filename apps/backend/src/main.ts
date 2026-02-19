import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { DailyFileLogger } from "./logger/daily-file-logger";

async function bootstrap() {
  const logger = new DailyFileLogger(process.env.LOG_DIR);
  const app = await NestFactory.create(AppModule, { logger });
  app.setGlobalPrefix("api");
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidUnknownValues: false,
    }),
  );

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
}

bootstrap();

process.on("unhandledRejection", (reason) => {
  const logger = new DailyFileLogger(process.env.LOG_DIR);
  logger.error(`unhandledRejection ${String(reason)}`, undefined, "Process");
});

process.on("uncaughtException", (error) => {
  const logger = new DailyFileLogger(process.env.LOG_DIR);
  logger.error(`uncaughtException ${error.message}`, error.stack, "Process");
});
