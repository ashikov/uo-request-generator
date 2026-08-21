const SMARTCAPTCHA_SCRIPT_BASE_URL = "https://smartcaptcha.cloud.yandex.ru/captcha.js";
const SMARTCAPTCHA_CALLBACK_PREFIX = "uoSmartCaptchaOnload";
const SMARTCAPTCHA_SCRIPT_TIMEOUT_MS = 10_000;
const SMARTCAPTCHA_ATTEMPT_TIMEOUT_MS = 120_000;
const unavailableError = new Error("SmartCaptcha unavailable");
let smartCaptchaScriptSequence = 0;

export function createSmartCaptchaController() {
  return createSmartCaptchaInitializer().getController();
}

export function createSmartCaptchaInitializer() {
  let cachedConfig;
  let inFlightConfig;
  let cachedController;
  let inFlightInitialization;

  function getPublicConfig() {
    if (cachedConfig !== undefined) {
      return Promise.resolve(cachedConfig);
    }

    if (inFlightConfig !== undefined) {
      return inFlightConfig;
    }

    const configuration = loadPublicConfig()
      .then((config) => {
        if (config !== undefined) {
          cachedConfig = config;
        }
        return config;
      })
      .finally(() => {
        if (inFlightConfig === configuration) {
          inFlightConfig = undefined;
        }
      });
    inFlightConfig = configuration;
    return configuration;
  }

  return {
    getPublicConfig,
    getController() {
      if (cachedController !== undefined) {
        return Promise.resolve(cachedController);
      }

      if (inFlightInitialization !== undefined) {
        return inFlightInitialization;
      }

      const initialization = getPublicConfig()
        .then(async (config) => {
          if (config === undefined) {
            return { status: "unavailable" };
          }

          if (!config.generationAvailable) {
            return { status: "generation_unavailable" };
          }

          if (!config.required) {
            return { status: "disabled" };
          }

          try {
            const smartCaptcha = await loadSmartCaptchaScript();
            return createReadyController(smartCaptcha, config.clientKey);
          } catch {
            return { status: "unavailable" };
          }
        })
        .then((controller) => {
          if (controller.status !== "unavailable") {
            cachedController = controller;
          }
          return controller;
        })
        .finally(() => {
          if (inFlightInitialization === initialization) {
            inFlightInitialization = undefined;
          }
        });
      inFlightInitialization = initialization;
      return initialization;
    },
  };
}

async function loadPublicConfig() {
  try {
    const response = await fetch("/api/captcha/config", {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return undefined;
    }

    const config = await response.json();
    return isPublicConfig(config) ? config : undefined;
  } catch {
    return undefined;
  }
}

function isPublicConfig(config) {
  if (
    typeof config !== "object" ||
    config === null ||
    !("generationAvailable" in config) ||
    typeof config.generationAvailable !== "boolean" ||
    !("required" in config)
  ) {
    return false;
  }

  if (config.required === false) {
    return Object.keys(config).length === 2;
  }

  return (
    config.required === true &&
    Object.keys(config).length === 3 &&
    "clientKey" in config &&
    typeof config.clientKey === "string" &&
    config.clientKey.trim().length > 0
  );
}

async function loadSmartCaptchaScript() {
  if (isSmartCaptchaApi(window.smartCaptcha)) {
    return window.smartCaptcha;
  }

  return await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const callbackName = `${SMARTCAPTCHA_CALLBACK_PREFIX}${++smartCaptchaScriptSequence}`;
    let isSettled = false;
    const timeout = setTimeout(fail, SMARTCAPTCHA_SCRIPT_TIMEOUT_MS);

    function finish(settle, removeScript) {
      if (isSettled) {
        return;
      }

      isSettled = true;
      clearTimeout(timeout);
      script.onerror = null;
      if (Reflect.get(window, callbackName) === onload) {
        Reflect.deleteProperty(window, callbackName);
      }
      if (removeScript) {
        script.remove();
      }
      settle();
    }

    function fail() {
      finish(() => reject(unavailableError), true);
    }

    function onload() {
      if (isSmartCaptchaApi(window.smartCaptcha)) {
        const smartCaptcha = window.smartCaptcha;
        finish(() => resolve(smartCaptcha), false);
      } else {
        fail();
      }
    }

    Reflect.set(window, callbackName, onload);
    const scriptUrl = new URL(SMARTCAPTCHA_SCRIPT_BASE_URL);
    scriptUrl.searchParams.set("render", "onload");
    scriptUrl.searchParams.set("onload", callbackName);
    script.src = scriptUrl.toString();
    script.async = true;
    script.onerror = fail;
    document.head.append(script);
  });
}

function isSmartCaptchaApi(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.render === "function" &&
    typeof value.execute === "function" &&
    typeof value.reset === "function" &&
    typeof value.subscribe === "function"
  );
}

function createReadyController(smartCaptcha, clientKey) {
  const container = document.getElementById("captcha-container");
  if (container === null) {
    throw unavailableError;
  }

  let pendingAttempt;
  const widgetId = smartCaptcha.render(container, {
    sitekey: clientKey,
    invisible: true,
    hideShield: true,
    callback(token) {
      const normalizedToken = typeof token === "string" ? token.trim() : "";
      if (normalizedToken === "") {
        rejectPendingAttempt();
        return;
      }

      finishPendingAttempt((attempt) => attempt.resolve(normalizedToken));
    },
  });

  function finishPendingAttempt(settle) {
    const attempt = pendingAttempt;
    if (attempt === undefined) {
      return;
    }

    pendingAttempt = undefined;
    clearTimeout(attempt.timeout);
    settle(attempt);
  }

  function rejectPendingAttempt() {
    finishPendingAttempt((attempt) => attempt.reject(unavailableError));
  }

  for (const event of ["network-error", "javascript-error", "token-expired", "challenge-hidden"]) {
    smartCaptcha.subscribe(widgetId, event, rejectPendingAttempt);
  }

  return {
    status: "ready",
    requestToken() {
      if (pendingAttempt !== undefined) {
        return Promise.reject(unavailableError);
      }

      return new Promise((resolve, reject) => {
        pendingAttempt = {
          resolve,
          reject,
          timeout: setTimeout(rejectPendingAttempt, SMARTCAPTCHA_ATTEMPT_TIMEOUT_MS),
        };
        try {
          smartCaptcha.execute(widgetId);
        } catch {
          rejectPendingAttempt();
        }
      });
    },
    reset() {
      rejectPendingAttempt();
      smartCaptcha.reset(widgetId);
    },
  };
}
