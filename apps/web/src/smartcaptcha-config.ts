import { z } from "zod";

export type SmartCaptchaConfig =
  | {
      mode: "disabled";
    }
  | {
      mode: "required";
      clientKey: string;
      serverKey: string;
    };

export type PublicSmartCaptchaConfig =
  | {
      required: false;
    }
  | {
      required: true;
      clientKey: string;
    };

type CreateSmartCaptchaConfigOptions = {
  allowImplicitDisabled?: boolean;
};

const smartCaptchaEnvironmentSchema = z
  .object({
    SMARTCAPTCHA_MODE: z.enum(["disabled", "required"]),
    SMARTCAPTCHA_CLIENT_KEY: z.string().trim().min(1).optional(),
    SMARTCAPTCHA_SERVER_KEY: z.string().trim().min(1).optional(),
  })
  .superRefine((environment, context) => {
    if (environment.SMARTCAPTCHA_MODE !== "required") {
      return;
    }

    if (environment.SMARTCAPTCHA_CLIENT_KEY === undefined) {
      context.addIssue({
        code: "custom",
        path: ["SMARTCAPTCHA_CLIENT_KEY"],
        message: "Client key is required",
      });
    }

    if (environment.SMARTCAPTCHA_SERVER_KEY === undefined) {
      context.addIssue({
        code: "custom",
        path: ["SMARTCAPTCHA_SERVER_KEY"],
        message: "Server key is required",
      });
    }
  });

export function createSmartCaptchaConfig(
  environment: NodeJS.ProcessEnv,
  options: CreateSmartCaptchaConfigOptions = {},
): SmartCaptchaConfig {
  if (environment.SMARTCAPTCHA_MODE === undefined && options.allowImplicitDisabled === true) {
    return { mode: "disabled" };
  }

  const validation = smartCaptchaEnvironmentSchema.safeParse(environment);
  if (!validation.success) {
    throw new Error("Invalid SmartCaptcha configuration");
  }

  if (validation.data.SMARTCAPTCHA_MODE === "disabled") {
    return { mode: "disabled" };
  }

  const { SMARTCAPTCHA_CLIENT_KEY, SMARTCAPTCHA_SERVER_KEY } = validation.data;
  if (SMARTCAPTCHA_CLIENT_KEY === undefined || SMARTCAPTCHA_SERVER_KEY === undefined) {
    throw new Error("Invalid SmartCaptcha configuration");
  }

  return {
    mode: "required",
    clientKey: SMARTCAPTCHA_CLIENT_KEY,
    serverKey: SMARTCAPTCHA_SERVER_KEY,
  };
}

export function toPublicSmartCaptchaConfig(config: SmartCaptchaConfig): PublicSmartCaptchaConfig {
  if (config.mode === "disabled") {
    return { required: false };
  }

  return {
    required: true,
    clientKey: config.clientKey,
  };
}
