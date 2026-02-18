import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { GeminiCallLog } from "../entities";

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly defaultModel = "gemini-3.0-flash";
  private readonly fallbackModels = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-1.5-flash"];
  private readonly modelUnavailableUntil = new Map<string, number>();
  private quotaBlockedUntil = 0;
  private availableModelsCache: { models: string[]; fetchedAt: number } | null = null;
  private readonly availableModelsTtlMs = 5 * 60 * 1000;

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
    return this.generateTextWithModel(prompt, undefined);
  }

  async generateTextWithModel(prompt: string, modelOverride?: string): Promise<string> {
    if (Date.now() < this.quotaBlockedUntil) {
      return "";
    }

    const apiKey = this.config.get<string>("GEMINI_API_KEY");
    if (!apiKey) {
      this.logger.warn("GEMINI_API_KEY is missing. Skipping Gemini call.");
      return "";
    }

    const configuredModel = modelOverride ?? this.config.get<string>("GEMINI_MODEL") ?? this.defaultModel;
    const configuredFallbacks = (this.config.get<string>("GEMINI_MODEL_FALLBACKS") ?? "")
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean);
    const preferredModels = [configuredModel, ...configuredFallbacks, ...this.fallbackModels]
      .filter((model, index, array) => array.indexOf(model) === index);

    const availableModels = await this.getAvailableModels(apiKey);
    let modelsToTry = preferredModels;
    if (availableModels.length > 0) {
      const filtered = preferredModels.filter((model) => availableModels.includes(model));
      if (filtered.length > 0) {
        modelsToTry = filtered;
      } else {
        this.logger.warn(
          `Gemini model list does not include any preferred models. Using configured list anyway. preferred=${preferredModels.join(",")}`,
        );
      }
    }

    modelsToTry = modelsToTry.filter((model) => Date.now() >= (this.modelUnavailableUntil.get(model) ?? 0));

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
          this.modelUnavailableUntil.set(model, Date.now() + 2 * 60 * 1000);
          this.logger.warn(`Gemini 429 on model=${model}. Trying fallback model.`);
          continue;
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

    if (modelsToTry.length > 0) {
      this.quotaBlockedUntil = Date.now() + 2 * 60 * 1000;
      this.logger.warn("All Gemini models failed or are rate-limited. Pausing Gemini calls for 2 minutes.");
    }
    return "";
  }

  private async getAvailableModels(apiKey: string): Promise<string[]> {
    if (this.availableModelsCache && Date.now() - this.availableModelsCache.fetchedAt < this.availableModelsTtlMs) {
      return this.availableModelsCache.models;
    }

    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
      const response = await fetch(endpoint, { method: "GET" });
      if (!response.ok) {
        this.logger.warn(`Failed to list Gemini models: status=${response.status}`);
        return [];
      }

      const payload = (await response.json()) as {
        models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
      };

      const models =
        payload.models
          ?.filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
          .map((model) => model.name?.replace(/^models\//, ""))
          .filter((name): name is string => Boolean(name)) ?? [];

      this.availableModelsCache = { models, fetchedAt: Date.now() };
      if (models.length > 0) {
        this.logger.log(`Gemini available models: ${models.join(",")}`);
      }
      return models;
    } catch (error) {
      this.logger.warn(`Failed to list Gemini models: ${String(error)}`);
      return [];
    }
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
