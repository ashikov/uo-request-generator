import { afterEach, describe, expect, it, vi } from "vitest";
import { SmartCaptchaVerifier } from "../src/smartcaptcha-verifier";

const serverKey = "test-private-server-key";
const token = "test-one-time-captcha-token";
const ip = "192.0.2.40";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SmartCaptchaVerifier", () => {
  it("отправляет form-urlencoded запрос с серверным ключом, токеном и IP", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        status: "ok",
        message: "",
        host: "service.example.test",
      }),
    );
    const verifier = new SmartCaptchaVerifier({ serverKey, fetch: fetchMock });

    await expect(verifier.verify({ token, ip })).resolves.toEqual({ status: "verified" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://smartcaptcha.cloud.yandex.ru/validate");
    expect(request).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
    });
    expect(String(url)).not.toContain(serverKey);
    expect(new URLSearchParams(String(request?.body))).toEqual(
      new URLSearchParams({
        secret: serverKey,
        token,
        ip,
      }),
    );
  });

  it("классифицирует status=failed без ветвления по message", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ status: "failed", message: "arbitrary provider text" }));
    const verifier = new SmartCaptchaVerifier({ serverKey, fetch: fetchMock });

    await expect(verifier.verify({ token, ip })).resolves.toEqual({ status: "failed" });
  });

  it("повторно проверяет одноразовый токен без автоматического retry", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          message: "",
          host: "service.example.test",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "failed",
          message: "token already used",
        }),
      );
    const verifier = new SmartCaptchaVerifier({ serverKey, fetch: fetchMock });

    await expect(verifier.verify({ token, ip })).resolves.toEqual({ status: "verified" });
    await expect(verifier.verify({ token, ip })).resolves.toEqual({ status: "failed" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("возвращает unavailable по timeout без реального ожидания", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_url, request) =>
        new Promise<Response>((_resolve, reject) => {
          request?.signal?.addEventListener("abort", () => {
            reject(new Error("request aborted"));
          });
        }),
    );
    const verifier = new SmartCaptchaVerifier({
      serverKey,
      fetch: fetchMock,
      timeoutMs: 100,
    });

    const verification = verifier.verify({ token, ip });
    await vi.advanceTimersByTimeAsync(100);

    await expect(verification).resolves.toEqual({ status: "unavailable" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("возвращает unavailable при сетевой ошибке и не повторяет запрос", async () => {
    const internalDetails = `${serverKey} ${token} full-provider-response`;
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error(internalDetails));
    const verifier = new SmartCaptchaVerifier({ serverKey, fetch: fetchMock });

    await expect(verifier.verify({ token, ip })).resolves.toEqual({
      status: "unavailable",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("применяет fail closed для non-2xx", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ status: "ok", host: "service.example.test" }, 503));
    const verifier = new SmartCaptchaVerifier({ serverKey, fetch: fetchMock });

    await expect(verifier.verify({ token, ip })).resolves.toEqual({
      status: "unavailable",
    });
  });

  it.each([
    ["некорректного JSON", new Response("{", { status: 200 })],
    ["неожиданного статуса", jsonResponse({ status: "unknown", host: "service.example.test" })],
    ["отсутствующего status", jsonResponse({ host: "service.example.test" })],
    ["отсутствующего host при ok", jsonResponse({ status: "ok" })],
    ["пустого host при ok", jsonResponse({ status: "ok", host: "" })],
  ])("возвращает unavailable для %s", async (_caseName, response) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
    const verifier = new SmartCaptchaVerifier({ serverKey, fetch: fetchMock });

    await expect(verifier.verify({ token, ip })).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("останавливает чтение ответа сверх жёсткого предела", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ status: "ok", host: "x".repeat(200) })));
    const verifier = new SmartCaptchaVerifier({
      serverKey,
      fetch: fetchMock,
      maxResponseBytes: 64,
    });

    await expect(verifier.verify({ token, ip })).resolves.toEqual({
      status: "unavailable",
    });
  });
});
