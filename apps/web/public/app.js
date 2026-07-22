import { formatCopyText, copyToClipboard } from "./copy-utils.js";

(() => {
  const form = document.querySelector("#request-form");
  const description = document.querySelector("#description");
  const location = document.querySelector("#location");
  const descriptionCount = document.querySelector("#description-count");
  const submitButton = document.querySelector("#submit-button");
  const errorArea = document.querySelector("#error-area");
  const resultArea = document.querySelector("#result-area");
  const resultTitle = document.querySelector("#result-title");
  const resultPlaceholder = document.querySelector("#result-placeholder");

  const apiErrorCodes = new Set([
    "generation_provider_unavailable",
    "internal_error",
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

  function updateCharacterCount() {
    descriptionCount.textContent = `${description.value.length} / ${description.maxLength}`;
  }

  function readForm() {
    const normalizedLocation = location.value.trim();

    return {
      description: description.value,
      ...(normalizedLocation === "" ? {} : { location: normalizedLocation }),
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

  function readErrorMessage(payload) {
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

    return error.message;
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

  function renderError(message) {
    errorArea.textContent = message;
    errorArea.hidden = false;
    errorArea.focus();
  }

  function clearError() {
    errorArea.textContent = "";
    errorArea.hidden = true;
  }

  function showCopyStatus(type, message) {
    const existing = resultArea.querySelector(".copy-status");
    if (existing !== null) {
      existing.remove();
    }

    const status = document.createElement("span");
    status.className = `copy-status copy-status--${type}`;
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
    title.textContent = result.title;

    const body = document.createElement("p");
    body.textContent = result.body;

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "copy-button";
    copyButton.textContent = "Скопировать заявку";
    copyButton.addEventListener("click", handleCopy);

    resultArea.replaceChildren(resultTitle, title, body, copyButton);

    if (result.warnings.length > 0) {
      const warnings = document.createElement("ul");
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

  function setSubmitting(isSubmitting) {
    submitButton.disabled = isSubmitting;
    submitButton.textContent = isSubmitting ? "Составляем…" : "Составить заявку";
  }

  async function handleSubmit(event) {
    event.preventDefault();
    clearError();
    resetResult();

    const input = readForm();
    const validationMessage = validateForm(input);
    if (validationMessage !== undefined) {
      renderError(validationMessage);
      return;
    }

    setSubmitting(true);

    try {
      let response;
      try {
        response = await submitRequest(input);
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
        renderError(readErrorMessage(payload) ?? "Не удалось составить заявку");
        return;
      }

      if (!isGenerationResult(payload)) {
        renderError("Сервис вернул некорректный результат");
        return;
      }

      renderResult(payload);
    } finally {
      setSubmitting(false);
    }
  }

  description.addEventListener("input", updateCharacterCount);
  form.addEventListener("submit", handleSubmit);
})();
