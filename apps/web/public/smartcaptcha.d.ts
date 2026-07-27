export type SmartCaptchaController =
  | { status: "disabled" }
  | { status: "unavailable" }
  | {
      status: "ready";
      requestToken(): Promise<string>;
      reset(): void;
    };

export function createSmartCaptchaController(): Promise<SmartCaptchaController>;

export function createSmartCaptchaInitializer(): {
  getController(): Promise<SmartCaptchaController>;
};
