import { z } from "zod";

const SMARTCAPTCHA_VALIDATE_URL = "https://smartcaptcha.cloud.yandex.ru/validate";
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4_096;

const smartCaptchaProviderResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    message: z.string(),
    host: z.string().trim().min(1),
  }),
  z.object({
    status: z.literal("failed"),
    message: z.string(),
  }),
]);

export type SmartCaptchaVerificationResult =
  | { status: "verified" }
  | { status: "failed" }
  | { status: "unavailable" };

type SmartCaptchaVerifierOptions = {
  serverKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

export class SmartCaptchaVerifier {
  readonly #serverKey: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;

  constructor(options: SmartCaptchaVerifierOptions) {
    this.#serverKey = options.serverKey;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  }

  async verify(input: { token: string; ip: string }): Promise<SmartCaptchaVerificationResult> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.#timeoutMs);

    try {
      const response = await this.#fetch(SMARTCAPTCHA_VALIDATE_URL, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          secret: this.#serverKey,
          token: input.token,
          ip: input.ip,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        return { status: "unavailable" };
      }

      const responseBody = await readLimitedBody(response, this.#maxResponseBytes);
      if (responseBody === undefined) {
        return { status: "unavailable" };
      }

      const providerResponse = smartCaptchaProviderResponseSchema.safeParse(
        JSON.parse(responseBody),
      );
      if (!providerResponse.success) {
        return { status: "unavailable" };
      }

      return providerResponse.data.status === "ok" ? { status: "verified" } : { status: "failed" };
    } catch {
      return { status: "unavailable" };
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readLimitedBody(
  response: Response,
  maxResponseBytes: number,
): Promise<string | undefined> {
  if (response.body === null) {
    return undefined;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }

    byteLength += chunk.value.byteLength;
    if (byteLength > maxResponseBytes) {
      await reader.cancel();
      return undefined;
    }

    chunks.push(chunk.value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}
