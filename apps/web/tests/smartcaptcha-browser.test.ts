// @vitest-environment happy-dom
/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSmartCaptchaController,
  createSmartCaptchaInitializer,
} from "../public/smartcaptcha.js";

type CaptchaRenderOptions = {
  sitekey: string;
  invisible: boolean;
  hideShield: boolean;
  callback: (token: string) => void;
};

const smartCaptchaCallbackPrefix = "uoSmartCaptchaOnload";
type SmartCaptchaCallbackName = `${typeof smartCaptchaCallbackPrefix}${string}`;
type SmartCaptchaCallbackWindow = Window & {
  [callbackName: SmartCaptchaCallbackName]: unknown;
};

function configResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as Response;
}

function createCaptchaApi() {
  const callbacks = new Map<string, () => void>();
  const api = {
    render: vi.fn((_container: HTMLElement, _options: CaptchaRenderOptions) => 17),
    execute: vi.fn(),
    reset: vi.fn(),
    subscribe: vi.fn((_widgetId: number, event: string, callback: () => void) => {
      callbacks.set(event, callback);
      return () => callbacks.delete(event);
    }),
  };

  return { api, callbacks };
}

function callbackNameFromScript(script: HTMLScriptElement): SmartCaptchaCallbackName {
  const callbackName = new URL(script.src).searchParams.get("onload");
  if (callbackName === null || !callbackName.startsWith(smartCaptchaCallbackPrefix)) {
    throw new Error("Expected SmartCaptcha onload callback in script URL");
  }
  return callbackName as SmartCaptchaCallbackName;
}

function getWindowCallback(callbackName: SmartCaptchaCallbackName): (() => void) | undefined {
  const callback = (window as unknown as SmartCaptchaCallbackWindow)[callbackName];
  return typeof callback === "function" ? (callback as () => void) : undefined;
}

function invokeWindowCallback(callbackName: SmartCaptchaCallbackName): void {
  getWindowCallback(callbackName)?.();
}

function activeSmartCaptchaCallbacks(): string[] {
  return Object.getOwnPropertyNames(window).filter((propertyName) =>
    propertyName.startsWith(smartCaptchaCallbackPrefix),
  );
}

beforeEach(() => {
  document.head.replaceChildren();
  document.body.innerHTML = '<div id="captcha-container"></div>';
  Reflect.deleteProperty(window, "smartCaptcha");
  for (const callbackName of activeSmartCaptchaCallbacks()) {
    Reflect.deleteProperty(window, callbackName);
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("browser SmartCaptcha controller", () => {
  it("не загружает внешний скрипт в отключённом режиме", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(configResponse({ required: false }));
    vi.stubGlobal("fetch", fetchMock);

    const controller = await createSmartCaptchaController();

    expect(controller).toEqual({ status: "disabled" });
    expect(fetchMock).toHaveBeenCalledWith("/api/captcha/config", {
      headers: { accept: "application/json" },
    });
    expect(document.querySelector("script")).toBeNull();
  });

  it("динамически загружает расширенный скрипт и создаёт невидимый виджет", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(configResponse({ required: true, clientKey: "test-public-client-key" }));
    vi.stubGlobal("fetch", fetchMock);
    const { api } = createCaptchaApi();
    const unrelatedCallbackName = `${smartCaptchaCallbackPrefix}Unrelated`;
    const unrelatedCallback = vi.fn();
    Reflect.set(window, unrelatedCallbackName, unrelatedCallback);
    const append = vi.spyOn(document.head, "append").mockImplementation((...nodes) => {
      const script = nodes[0] as HTMLScriptElement;
      const scriptUrl = new URL(script.src);
      const callbackName = callbackNameFromScript(script);
      expect(scriptUrl.origin).toBe("https://smartcaptcha.cloud.yandex.ru");
      expect(scriptUrl.pathname).toBe("/captcha.js");
      expect(scriptUrl.searchParams.get("render")).toBe("onload");
      expect(callbackName).toMatch(/^uoSmartCaptchaOnload\d+$/);
      Object.assign(window, { smartCaptcha: api });
      queueMicrotask(() => invokeWindowCallback(callbackName));
    });

    const controller = await createSmartCaptchaController();

    expect(controller.status).toBe("ready");
    expect(append).toHaveBeenCalledOnce();
    expect(api.render).toHaveBeenCalledOnce();
    expect(api.render).toHaveBeenCalledWith(
      document.getElementById("captcha-container"),
      expect.objectContaining({
        sitekey: "test-public-client-key",
        invisible: true,
        hideShield: true,
        callback: expect.any(Function),
      }),
    );
    expect(Object.keys(api.render.mock.calls[0]?.[1] ?? {}).sort()).toEqual([
      "callback",
      "hideShield",
      "invisible",
      "sitekey",
    ]);
    expect(getWindowCallback(unrelatedCallbackName)).toBe(unrelatedCallback);
    Reflect.deleteProperty(window, unrelatedCallbackName);
    expect(activeSmartCaptchaCallbacks()).toEqual([]);
  });

  it.each([
    ["неуспешного HTTP-ответа", configResponse({ required: false }, false)],
    ["некорректной формы", configResponse({ required: true })],
    [
      "лишнего публичного поля",
      configResponse({
        required: true,
        clientKey: "test-public-client-key",
        serverKey: "must-not-be-accepted",
      }),
    ],
  ])("применяет fail closed для %s конфигурации", async (_caseName, response) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response));

    await expect(createSmartCaptchaController()).resolves.toEqual({
      status: "unavailable",
    });
    expect(document.querySelector("script")).toBeNull();
  });

  it("применяет fail closed при ошибке загрузки внешнего скрипта", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(configResponse({ required: true, clientKey: "test-public-client-key" })),
    );
    vi.spyOn(document.head, "append").mockImplementation((...nodes) => {
      const script = nodes[0] as HTMLScriptElement;
      queueMicrotask(() => script.onerror?.(new Event("error")));
    });

    await expect(createSmartCaptchaController()).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("не принимает пустой callback-токен и сбрасывает состояние попытки", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(configResponse({ required: true, clientKey: "test-public-client-key" })),
    );
    const { api } = createCaptchaApi();
    Object.assign(window, { smartCaptcha: api });
    const controller = await createSmartCaptchaController();
    if (controller.status !== "ready") {
      throw new Error("Expected ready CAPTCHA controller");
    }
    const renderOptions = api.render.mock.calls[0]?.[1];

    const tokenPromise = controller.requestToken();
    renderOptions?.callback(" ");

    await expect(tokenPromise).rejects.toThrow("SmartCaptcha unavailable");
    expect(api.execute).toHaveBeenCalledWith(17);
    controller.reset();
    expect(api.reset).toHaveBeenCalledWith(17);
  });

  it.each([
    "network-error",
    "javascript-error",
    "token-expired",
    "challenge-hidden",
  ])("завершает активную попытку при событии %s", async (event) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(configResponse({ required: true, clientKey: "test-public-client-key" })),
    );
    const { api, callbacks } = createCaptchaApi();
    Object.assign(window, { smartCaptcha: api });
    const controller = await createSmartCaptchaController();
    if (controller.status !== "ready") {
      throw new Error("Expected ready CAPTCHA controller");
    }

    const tokenPromise = controller.requestToken();
    callbacks.get(event)?.();

    await expect(tokenPromise).rejects.toThrow("SmartCaptcha unavailable");
  });

  it("игнорирует challenge-hidden после успешного callback", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(configResponse({ required: true, clientKey: "test-public-client-key" })),
    );
    const { api, callbacks } = createCaptchaApi();
    Object.assign(window, { smartCaptcha: api });
    const controller = await createSmartCaptchaController();
    if (controller.status !== "ready") {
      throw new Error("Expected ready CAPTCHA controller");
    }
    const renderOptions = api.render.mock.calls[0]?.[1];

    const firstToken = controller.requestToken();
    renderOptions?.callback("first-token");
    await expect(firstToken).resolves.toBe("first-token");

    callbacks.get("challenge-hidden")?.();

    const secondToken = controller.requestToken();
    renderOptions?.callback("second-token");
    await expect(secondToken).resolves.toBe("second-token");
  });

  it("завершает попытку по timeout и допускает следующую попытку", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(configResponse({ required: true, clientKey: "test-public-client-key" })),
    );
    const { api } = createCaptchaApi();
    Object.assign(window, { smartCaptcha: api });
    const controller = await createSmartCaptchaController();
    if (controller.status !== "ready") {
      throw new Error("Expected ready CAPTCHA controller");
    }
    const renderOptions = api.render.mock.calls[0]?.[1];

    const firstToken = controller.requestToken();
    const firstRejection = expect(firstToken).rejects.toThrow("SmartCaptcha unavailable");
    await vi.advanceTimersByTimeAsync(120_000);
    await firstRejection;

    const secondToken = controller.requestToken();
    renderOptions?.callback("second-token");

    await expect(secondToken).resolves.toBe("second-token");
    expect(api.execute).toHaveBeenCalledTimes(2);
  });

  it("очищает timeout после callback и игнорирует поздний callback после timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(configResponse({ required: true, clientKey: "test-public-client-key" })),
    );
    const { api } = createCaptchaApi();
    Object.assign(window, { smartCaptcha: api });
    const controller = await createSmartCaptchaController();
    if (controller.status !== "ready") {
      throw new Error("Expected ready CAPTCHA controller");
    }
    const renderOptions = api.render.mock.calls[0]?.[1];

    const successfulToken = controller.requestToken();
    renderOptions?.callback("successful-token");
    await expect(successfulToken).resolves.toBe("successful-token");
    expect(vi.getTimerCount()).toBe(0);

    const expiredToken = controller.requestToken();
    const expiredRejection = expect(expiredToken).rejects.toThrow("SmartCaptcha unavailable");
    await vi.advanceTimersByTimeAsync(120_000);
    await expiredRejection;
    renderOptions?.callback("late-token");

    const nextToken = controller.requestToken();
    renderOptions?.callback("next-token");
    await expect(nextToken).resolves.toBe("next-token");
  });

  it("reset отклоняет незавершённую попытку и очищает её timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(configResponse({ required: true, clientKey: "test-public-client-key" })),
    );
    const { api } = createCaptchaApi();
    Object.assign(window, { smartCaptcha: api });
    const controller = await createSmartCaptchaController();
    if (controller.status !== "ready") {
      throw new Error("Expected ready CAPTCHA controller");
    }

    const token = controller.requestToken();
    const rejection = expect(token).rejects.toThrow("SmartCaptcha unavailable");
    controller.reset();

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
    expect(api.reset).toHaveBeenCalledWith(17);
  });
});

describe("browser SmartCaptcha initialization", () => {
  it("возвращает публичную конфигурацию", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(configResponse({ required: true, clientKey: "test-public-client-key" })),
    );
    const initializer = createSmartCaptchaInitializer();

    await expect(initializer.getPublicConfig()).resolves.toEqual({
      required: true,
      clientKey: "test-public-client-key",
    });
  });

  it("изолирует retry от запоздалого callback первой загрузки", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(configResponse({ required: true, clientKey: "test-public-client-key" })),
    );
    const scripts: HTMLScriptElement[] = [];
    vi.spyOn(document.head, "append").mockImplementation((...nodes) => {
      scripts.push(nodes[0] as HTMLScriptElement);
    });
    const initializer = createSmartCaptchaInitializer();

    const firstInitialization = initializer.getController();
    await vi.advanceTimersByTimeAsync(0);
    const firstScript = scripts[0];
    if (firstScript === undefined) {
      throw new Error("Expected first SmartCaptcha script");
    }
    const firstCallbackName = callbackNameFromScript(firstScript);
    const unrelatedCallbackName = `${smartCaptchaCallbackPrefix}Unrelated`;
    const unrelatedCallback = vi.fn();
    Reflect.set(window, unrelatedCallbackName, unrelatedCallback);

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(firstInitialization).resolves.toEqual({ status: "unavailable" });
    expect(getWindowCallback(firstCallbackName)).toBeUndefined();
    expect(getWindowCallback(unrelatedCallbackName)).toBe(unrelatedCallback);
    Reflect.deleteProperty(window, unrelatedCallbackName);

    let secondInitializationSettled = false;
    const secondInitialization = initializer.getController();
    void secondInitialization.then(() => {
      secondInitializationSettled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    const secondScript = scripts[1];
    if (secondScript === undefined) {
      throw new Error("Expected second SmartCaptcha script");
    }
    const secondCallbackName = callbackNameFromScript(secondScript);

    expect(secondCallbackName).not.toBe(firstCallbackName);
    expect(callbackNameFromScript(firstScript)).toBe(firstCallbackName);
    const { api } = createCaptchaApi();
    Object.assign(window, { smartCaptcha: api });

    invokeWindowCallback(firstCallbackName);
    firstScript.dispatchEvent(new Event("error"));
    await vi.advanceTimersByTimeAsync(0);

    expect(secondInitializationSettled).toBe(false);
    expect(api.render).not.toHaveBeenCalled();
    expect(getWindowCallback(secondCallbackName)).toEqual(expect.any(Function));

    invokeWindowCallback(secondCallbackName);

    await expect(secondInitialization).resolves.toMatchObject({ status: "ready" });
    expect(api.render).toHaveBeenCalledOnce();
    expect(scripts).toHaveLength(2);
    expect(getWindowCallback(firstCallbackName)).toBeUndefined();
    expect(getWindowCallback(secondCallbackName)).toBeUndefined();
    expect(activeSmartCaptchaCallbacks()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("повторяет запрос конфигурации после временной сетевой ошибки", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("temporary configuration failure"))
      .mockResolvedValueOnce(configResponse({ required: false }));
    vi.stubGlobal("fetch", fetchMock);
    const initializer = createSmartCaptchaInitializer();

    await expect(initializer.getController()).resolves.toEqual({ status: "unavailable" });
    await expect(initializer.getController()).resolves.toEqual({ status: "disabled" });
    await expect(initializer.getController()).resolves.toEqual({ status: "disabled" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("повторяет запрос конфигурации после некорректного ответа", async () => {
    const { api } = createCaptchaApi();
    Object.assign(window, { smartCaptcha: api });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(configResponse({ required: true }))
      .mockResolvedValueOnce(
        configResponse({ required: true, clientKey: "test-public-client-key" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const initializer = createSmartCaptchaInitializer();

    await expect(initializer.getController()).resolves.toEqual({ status: "unavailable" });
    await expect(initializer.getController()).resolves.toMatchObject({ status: "ready" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(api.render).toHaveBeenCalledOnce();
  });

  it("удаляет неуспешный script и повторяет его загрузку", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(configResponse({ required: true, clientKey: "test-public-client-key" })),
    );
    const callbackNames: SmartCaptchaCallbackName[] = [];
    const append = vi.spyOn(document.head, "append").mockImplementation((...nodes) => {
      const script = nodes[0] as HTMLScriptElement;
      callbackNames.push(callbackNameFromScript(script));
      script.removeAttribute("src");
      document.head.appendChild(script);
    });
    const initializer = createSmartCaptchaInitializer();
    const unrelatedCallbackName = `${smartCaptchaCallbackPrefix}Unrelated`;
    const unrelatedCallback = vi.fn();
    Reflect.set(window, unrelatedCallbackName, unrelatedCallback);

    const firstInitialization = initializer.getController();
    await vi.waitFor(() => expect(document.querySelector("script")).not.toBeNull());
    const failedScript = document.querySelector("script");
    const firstCallbackName = callbackNames[0];
    if (firstCallbackName === undefined) {
      throw new Error("Expected first SmartCaptcha callback");
    }
    failedScript?.dispatchEvent(new Event("error"));

    await expect(firstInitialization).resolves.toEqual({ status: "unavailable" });
    expect(failedScript?.isConnected).toBe(false);
    expect(getWindowCallback(firstCallbackName)).toBeUndefined();
    expect(getWindowCallback(unrelatedCallbackName)).toBe(unrelatedCallback);
    Reflect.deleteProperty(window, unrelatedCallbackName);

    const secondInitialization = initializer.getController();
    await vi.waitFor(() => expect(document.querySelector("script")).not.toBeNull());
    const secondCallbackName = callbackNames[1];
    if (secondCallbackName === undefined) {
      throw new Error("Expected second SmartCaptcha callback");
    }
    expect(secondCallbackName).not.toBe(firstCallbackName);

    failedScript?.dispatchEvent(new Event("error"));
    expect(getWindowCallback(secondCallbackName)).toEqual(expect.any(Function));

    const { api } = createCaptchaApi();
    Object.assign(window, { smartCaptcha: api });
    invokeWindowCallback(secondCallbackName);

    await expect(secondInitialization).resolves.toMatchObject({ status: "ready" });
    expect(append).toHaveBeenCalledTimes(2);
    expect(api.render).toHaveBeenCalledOnce();
    expect(getWindowCallback(firstCallbackName)).toBeUndefined();
    expect(getWindowCallback(secondCallbackName)).toBeUndefined();
  });

  it("переиспользует успешный контроллер", async () => {
    const { api } = createCaptchaApi();
    Object.assign(window, { smartCaptcha: api });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(configResponse({ required: true, clientKey: "test-public-client-key" }));
    vi.stubGlobal("fetch", fetchMock);
    const initializer = createSmartCaptchaInitializer();

    const firstController = await initializer.getController();
    const secondController = await initializer.getController();

    expect(secondController).toBe(firstController);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(api.render).toHaveBeenCalledOnce();
  });

  it("объединяет параллельные инициализации в один script и widget", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(configResponse({ required: true, clientKey: "test-public-client-key" })),
    );
    let callbackName: SmartCaptchaCallbackName | undefined;
    const append = vi.spyOn(document.head, "append").mockImplementation((...nodes) => {
      const script = nodes[0] as HTMLScriptElement;
      callbackName = callbackNameFromScript(script);
      script.removeAttribute("src");
      document.head.appendChild(script);
    });
    const initializer = createSmartCaptchaInitializer();

    const firstInitialization = initializer.getController();
    const secondInitialization = initializer.getController();
    await vi.waitFor(() => expect(document.querySelectorAll("script")).toHaveLength(1));
    if (callbackName === undefined) {
      throw new Error("Expected SmartCaptcha callback");
    }

    const { api } = createCaptchaApi();
    Object.assign(window, { smartCaptcha: api });
    invokeWindowCallback(callbackName);

    const [firstController, secondController] = await Promise.all([
      firstInitialization,
      secondInitialization,
    ]);
    expect(secondController).toBe(firstController);
    expect(append).toHaveBeenCalledOnce();
    expect(document.querySelectorAll("script")).toHaveLength(1);
    expect(api.render).toHaveBeenCalledOnce();
    expect(getWindowCallback(callbackName)).toBeUndefined();
  });
});
