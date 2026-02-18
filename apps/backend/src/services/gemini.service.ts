import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { GeminiCallLog } from "../entities";

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly defaultModel = "gemini-3.0-flash";
  private readonly fallbackModels = ["gemini-2.0-flash", "gemini-1.5-flash"];
  private readonly modelUnavailableUntil = new Map<string, number>();
  private quotaBlockedUntil = 0;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @InjectRepository(GeminiCallLog) private readonly geminiCallLogRepository: Repository<GeminiCallLog>,
  ) {}

  async generateJson<T>(prompt: string, fallback: T): Promise<T> {
    const text = await this.generateText(prompt);
    if (!text) {
      return fallback;
    }

    try {
      const normalized = text
        .replace(/^```json/gm, "")
        .replace(/^```/gm, "")
        .trim();
      return JSON.parse(normalized) as T;
    } catch (error) {
      this.logger.warn(`Failed to parse Gemini JSON response: ${String(error)}`);
      return fallback;
    }
  }

  async generateText(prompt: string): Promise<string> {
    if (Date.now() < this.quotaBlockedUntil) {
      return "";
    }

    const apiKey = this.config.get<string>("GEMINI_API_KEY");
    if (!apiKey) {
      this.logger.warn("GEMINI_API_KEY is missing. Skipping Gemini call.");
      return "";
    }

    const configuredModel = this.config.get<string>("GEMINI_MODEL") ?? this.defaultModel;
    const modelsToTry = [configuredModel, ...this.fallbackModels.filter((model) => model !== configuredModel)].filter(
      (model) => Date.now() >= (this.modelUnavailableUntil.get(model) ?? 0),
    );

    for (const model of modelsToTry) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        await this.logGeminiCall({
          model,
          inputText: prompt,
          outputText: null,
          promptTokenCount: null,
          candidatesTokenCount: null,
          totalTokenCount: null,
          success: false,
          statusCode: response.status,
          errorMessage: errorText,
        });
        this.logger.warn(`Gemini request failed: status=${response.status}, model=${model}, body=${errorText.slice(0, 300)}`);
        if (response.status === 404) {
          this.modelUnavailableUntil.set(model, Date.now() + 24 * 60 * 60 * 1000);
          continue;
        }
        if (response.status === 429) {
          this.quotaBlockedUntil = Date.now() + 15 * 60 * 1000;
          this.logger.warn("Gemini quota exceeded (429). Gemini calls are paused for 15 minutes.");
        }
        return "";
      }

      const payload = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      };
      const outputText = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      await this.logGeminiCall({
        model,
        inputText: prompt,
        outputText,
        promptTokenCount: payload.usageMetadata?.promptTokenCount ?? null,
        candidatesTokenCount: payload.usageMetadata?.candidatesTokenCount ?? null,
        totalTokenCount: payload.usageMetadata?.totalTokenCount ?? null,
        success: true,
        statusCode: response.status,
        errorMessage: null,
      });

      if (model !== configuredModel) {
        this.logger.warn(`Gemini model fallback in use: configured=${configuredModel}, active=${model}`);
      }

      this.quotaBlockedUntil = 0;
      return outputText;
    }
    return "";
  }

  private async logGeminiCall(input: {
    model: string;
    inputText: string;
    outputText: string | null;
    promptTokenCount: number | null;
    candidatesTokenCount: number | null;
    totalTokenCount: number | null;
    success: boolean;
    statusCode: number | null;
    errorMessage: string | null;
  }) {
    try {
      await this.geminiCallLogRepository.save(input);
    } catch (error) {
      this.logger.warn(`Failed to save Gemini call log: ${String(error)}`);
    }
  }
}
