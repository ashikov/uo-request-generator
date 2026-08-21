import type { FastifyInstance } from "fastify";
import { type SmartCaptchaConfig, toPublicSmartCaptchaConfig } from "../smartcaptcha-config.js";

export function registerCaptchaConfigRoute(
  app: FastifyInstance,
  config: SmartCaptchaConfig,
  generationAvailable: boolean,
): void {
  app.get("/api/captcha/config", async () =>
    toPublicSmartCaptchaConfig(config, generationAvailable),
  );
}
