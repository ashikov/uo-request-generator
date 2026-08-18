import { copyToClipboard, formatCopyText } from "./copy-utils.js";
import { createSmartCaptchaInitializer } from "./smartcaptcha.js";

const smartCaptchaInitializer = createSmartCaptchaInitializer();

export function initializeCaptcha() {
  return smartCaptchaInitializer.getController().then(() => undefined);
}

(() => {
  const form = document.querySelector("#request-form");
  const description = document.querySelector("#description");
  const location = document.querySelector("#location");
  const consequences = document.querySelector("#consequences");
  const desiredActions = document.querySelector("#desired-actions");
  const confirmedProblemSubject = document.querySelector("#confirmed-problem-subject");
  const confirmedProblemSubjectContext = document.querySelector(
    "#confirmed-problem-subject-context",
  );
  const descriptionCount = document.querySelector("#description-count");
  const locationCount = document.querySelector("#location-count");
  const consequencesCount = document.querySelector("#consequences-count");
  const desiredActionsCount = document.querySelector("#desired-actions-count");
  const submitButton = document.querySelector("#submit-button");
  const captchaNotice = document.querySelector("#captcha-notice");
  const errorArea = document.querySelector("#error-area");
  const resultArea = document.querySelector("#result-area");
  const resultTitle = document.querySelector("#result-title");
  const resultPlaceholder = document.querySelector("#result-placeholder");
  const descriptionDescribedBy = description.getAttribute("aria-describedby");

  const apiErrorCodes = new Set([
    "captcha_failed",
    "captcha_unavailable",
    "generation_unavailable",
    "generation_provider_unavailable",
    "internal_error",
    "multiple_issues",
    "rate_limit_exceeded",
    "request_too_large",
    "validation_error",
  ]);
  const generationResultLimits = {
    title: 120,
    body: 2500,
    warnings: 5,
    warning: 200,
  };

  let currentResult = null;
  let copyOperationId = 0;
  let isSubmitting = false;

  function updateCharacterCount(field, count) {
    count.textContent = `${field.value.length} / ${field.maxLength}`;
  }

  function updateConfirmedProblemSubjectContext() {
    const subjectHint =
      confirmedProblemSubject.options.item(confirmedProblemSubject.selectedIndex)?.dataset
        .subjectHint ?? "";
    confirmedProblemSubjectContext.textContent = subjectHint;
    confirmedProblemSubjectContext.toggleAttribute("hidden", subjectHint === "");
  }

  function readForm() {
    const normalizedLocation = location.value.trim();
    const normalizedConsequences = consequences.value.trim();
    const normalizedDesiredActions = desiredActions.value.trim();
    const normalizedConfirmedProblemSubject =
      confirmedProblemSubject.value === "" ? undefined : confirmedProblemSubject.value;

    return {
      description: description.value,
      ...(normalizedLocation === "" ? {} : { location: normalizedLocation }),
      ...(normalizedConsequences === "" ? {} : { consequences: normalizedConsequences }),
      ...(normalizedDesiredActions === "" ? {} : { desiredActions: normalizedDesiredActions }),
      ...(normalizedConfirmedProblemSubject === undefined
        ? {}
        : { confirmedProblemSubject: normalizedConfirmedProblemSubject }),
    };
  }

  function validateForm(input) {
    if (input.description.length < description.minLength) {
      return `Описание должно содержать не менее ${description.minLength} символов`;
    }

    if (input.description.length > description.maxLength) {
      return `Описание должно содержать не более ${description.maxLength} символов`;
    }

    if (input.location !== undefined && input.location.length > location.maxLength) {
      return `Место должно содержать не более ${location.maxLength} символов`;
    }

    if (input.consequences !== undefined && input.consequences.length > consequences.maxLength) {
      return `Последствия должны содержать не более ${consequences.maxLength} символов`;
    }

    if (
      input.desiredActions !== undefined &&
      input.desiredActions.length > desiredActions.maxLength
    ) {
      return `Желаемые действия должны содержать не более ${desiredActions.maxLength} символов`;
    }

    return undefined;
  }

  function submitRequest(input) {
    return fetch("/api/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
  }

  function readApiError(payload) {
    if (
      typeof payload !== "object" ||
      payload === null ||
      Object.keys(payload).length !== 1 ||
      !("error" in payload)
    ) {
      return undefined;
    }

    const error = payload.error;
    if (
      typeof error !== "object" ||
      error === null ||
      Object.keys(error).length !== 3 ||
      !("code" in error) ||
      !("message" in error) ||
      !("requestId" in error) ||
      !apiErrorCodes.has(error.code) ||
      typeof error.message !== "string" ||
      error.message.length === 0 ||
      typeof error.requestId !== "string" ||
      error.requestId.length === 0
    ) {
      return undefined;
    }

    return { message: error.message, requestId: error.requestId };
  }

  function isGenerationResult(payload) {
    return (
      typeof payload === "object" &&
      payload !== null &&
      Object.keys(payload).length === 3 &&
      "title" in payload &&
      typeof payload.title === "string" &&
      payload.title.length > 0 &&
      payload.title.length <= generationResultLimits.title &&
      "body" in payload &&
      typeof payload.body === "string" &&
      payload.body.length > 0 &&
      payload.body.length <= generationResultLimits.body &&
      "warnings" in payload &&
      Array.isArray(payload.warnings) &&
      payload.warnings.length <= generationResultLimits.warnings &&
      payload.warnings.every(
        (warning) =>
          typeof warning === "string" &&
          warning.length > 0 &&
          warning.length <= generationResultLimits.warning,
      )
    );
  }

  function setDescriptionValidationError() {
    description.setAttribute("aria-invalid", "true");
    description.classList.add("is-invalid");
    description.setAttribute(
      "aria-describedby",
      `${descriptionDescribedBy ?? ""} error-area`.trim(),
    );
  }

  function clearDescriptionValidationError() {
    description.removeAttribute("aria-invalid");
    description.classList.remove("is-invalid");
    if (descriptionDescribedBy === null) {
      description.removeAttribute("aria-describedby");
      return;
    }

    description.setAttribute("aria-describedby", descriptionDescribedBy);
  }

  function renderError(message, hasDescriptionValidationError = false, requestId) {
    clearDescriptionValidationError();
    if (hasDescriptionValidationError) {
      setDescriptionValidationError();
    }
    errorArea.textContent = message;
    if (requestId !== undefined) {
      const requestIdElement = document.createElement("div");
      requestIdElement.className = "mt-1 small";
      requestIdElement.textContent = `Код запроса: ${requestId}`;
      errorArea.append(requestIdElement);
    }
    errorArea.hidden = false;
    errorArea.focus();
  }

  function clearError() {
    clearDescriptionValidationError();
    errorArea.textContent = "";
    errorArea.hidden = true;
  }

  function showCopyStatus(type, message) {
    const existing = resultArea.querySelector(".copy-status");
    if (existing !== null) {
      existing.remove();
    }

    const status = document.createElement("div");
    status.className = `copy-status alert ${type === "success" ? "alert-success" : "alert-danger"} mt-3 mb-0 py-2`;
    status.role = "status";
    status.textContent = message;
    resultArea.append(status);
  }

  function handleCopy() {
    if (currentResult === null) return;

    const operationId = copyOperationId;
    const text = formatCopyText(currentResult.title, currentResult.body);
    copyToClipboard(text).then(({ success }) => {
      if (operationId !== copyOperationId) return;

      if (success) {
        showCopyStatus("success", "Скопировано");
      } else {
        showCopyStatus("error", "Не удалось скопировать. Попробуйте выделить текст вручную");
      }
    });
  }

  function renderResult(result) {
    currentResult = result;

    const title = document.createElement("h3");
    title.className = "h4 mt-3 mb-0 text-break";
    title.textContent = result.title;

    const body = document.createElement("p");
    body.className = "mt-3 mb-0 text-break";
    body.textContent = result.body;

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "btn btn-outline-primary w-100 mt-4";
    copyButton.textContent = "Скопировать заявку";
    copyButton.addEventListener("click", handleCopy);

    resultArea.replaceChildren(resultTitle, title, body, copyButton);

    if (result.warnings.length > 0) {
      const warnings = document.createElement("ul");
      warnings.className = "alert alert-warning mt-4 mb-0 ps-5";
      for (const warning of result.warnings) {
        const item = document.createElement("li");
        item.textContent = warning;
        warnings.append(item);
      }
      resultArea.append(warnings);
    }
  }

  function resetResult() {
    currentResult = null;
    copyOperationId++;
    resultArea.replaceChildren(resultTitle, resultPlaceholder);
  }

  function setSubmitting(nextIsSubmitting) {
    isSubmitting = nextIsSubmitting;
    form.setAttribute("aria-busy", String(nextIsSubmitting));
    submitButton.disabled = nextIsSubmitting;
    submitButton.textContent = nextIsSubmitting ? "Составляем…" : "Составить заявку";
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (isSubmitting) return;

    const input = readForm();
    const validationMessage = validateForm(input);
    if (validationMessage !== undefined) {
      const hasDescriptionValidationError =
        input.description.length < description.minLength ||
        input.description.length > description.maxLength;
      renderError(validationMessage, hasDescriptionValidationError);
      return;
    }

    clearError();
    resetResult();
    setSubmitting(true);

    try {
      try {
        const captchaController = await smartCaptchaInitializer.getController();
        if (captchaController.status === "unavailable") {
          renderError("Проверка временно недоступна. Попробуйте позже");
          return;
        }

        let requestInput = input;
        try {
          if (captchaController.status === "ready") {
            const captchaToken = await captchaController.requestToken();
            requestInput = { ...input, captchaToken };
          }

          let response;
          try {
            response = await submitRequest(requestInput);
          } catch {
            renderError("Не удалось связаться с сервисом. Попробуйте позже");
            return;
          }

          let payload;
          try {
            payload = await response.json();
          } catch {
            renderError("Сервис вернул некорректный ответ. Попробуйте позже");
            return;
          }

          if (!response.ok) {
            const apiError = readApiError(payload);
            renderError(
              apiError?.message ?? "Не удалось составить заявку",
              false,
              apiError?.requestId,
            );
            return;
          }

          if (!isGenerationResult(payload)) {
            renderError("Сервис вернул некорректный результат");
            return;
          }

          renderResult(payload);
        } catch {
          renderError("Проверка временно недоступна. Попробуйте позже");
          return;
        } finally {
          if (captchaController.status === "ready") {
            captchaController.reset();
          }
        }
      } catch {
        renderError("Проверка временно недоступна. Попробуйте позже");
        return;
      }
    } finally {
      setSubmitting(false);
    }
  }

  description.addEventListener("input", () => {
    clearDescriptionValidationError();
    updateCharacterCount(description, descriptionCount);
  });
  location.addEventListener("input", () => updateCharacterCount(location, locationCount));
  consequences.addEventListener("input", () =>
    updateCharacterCount(consequences, consequencesCount),
  );
  desiredActions.addEventListener("input", () =>
    updateCharacterCount(desiredActions, desiredActionsCount),
  );
  confirmedProblemSubject.addEventListener("change", updateConfirmedProblemSubjectContext);
  updateCharacterCount(description, descriptionCount);
  updateCharacterCount(location, locationCount);
  updateCharacterCount(consequences, consequencesCount);
  updateCharacterCount(desiredActions, desiredActionsCount);
  updateConfirmedProblemSubjectContext();
  setSubmitting(false);
  if (captchaNotice !== null) {
    void smartCaptchaInitializer.getPublicConfig().then((config) => {
      captchaNotice.toggleAttribute("hidden", config?.required !== true);
    });
  }
  form.addEventListener("submit", handleSubmit);
})();
