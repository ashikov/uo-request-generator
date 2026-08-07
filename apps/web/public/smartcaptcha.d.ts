export type SmartCaptchaController =
  | { status: "disabled" }
  | { status: "unavailable" }
  | {
      status: "ready";
      requestToken(): Promise<string>;
      reset(): void;
    };

export function createSmartCaptchaController(): Promise<SmartCaptchaController>;

export type SmartCaptchaPublicConfig = { required: false } | { required: true; clientKey: string };

export function createSmartCaptchaInitializer(): {
  getPublicConfig(): Promise<SmartCaptchaPublicConfig | undefined>;
  getController(): Promise<SmartCaptchaController>;
};
