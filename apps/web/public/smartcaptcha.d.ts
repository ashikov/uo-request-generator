export type SmartCaptchaController =
  | { status: "disabled" }
  | { status: "generation_unavailable" }
  | { status: "unavailable" }
  | {
      status: "ready";
      requestToken(): Promise<string>;
      reset(): void;
    };

export function createSmartCaptchaController(): Promise<SmartCaptchaController>;

export type SmartCaptchaPublicConfig =
  | { generationAvailable: boolean; required: false }
  | { generationAvailable: boolean; required: true; clientKey: string };

export function createSmartCaptchaInitializer(): {
  getPublicConfig(): Promise<SmartCaptchaPublicConfig | undefined>;
  getController(): Promise<SmartCaptchaController>;
};
