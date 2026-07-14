(() => {
  const limits = {
    description: { min: 10, max: 2000 },
    location: { max: 120 },
  };

  const form = document.querySelector("#request-form");
  const description = document.querySelector("#description");
  const location = document.querySelector("#location");
  const descriptionCount = document.querySelector("#description-count");
  const submitButton = document.querySelector("#submit-button");
  const errorArea = document.querySelector("#error-area");
  const resultArea = document.querySelector("#result-area");
  const resultTitle = document.querySelector("#result-title");
  const resultPlaceholder = document.querySelector("#result-placeholder");

  function updateCharacterCount() {
    descriptionCount.textContent = `${description.value.length} / ${limits.description.max}`;
  }

  function readForm() {
    const normalizedLocation = location.value.trim();

    return {
      description: description.value,
      ...(normalizedLocation === "" ? {} : { location: normalizedLocation }),
    };
  }

  function validateForm(input) {
    if (input.description.length < limits.description.min) {
      return `Описание должно содержать не менее ${limits.description.min} символов`;
    }

    if (input.description.length > limits.description.max) {
      return `Описание должно содержать не более ${limits.description.max} символов`;
    }

    if (input.location !== undefined && input.location.length > limits.location.max) {
      return `Место должно содержать не более ${limits.location.max} символов`;
    }

    return undefined;
  }

  async function submitRequest(input) {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
    const payload = await response.json();

    return { payload, response };
  }

  function readErrorMessage(payload) {
    if (typeof payload !== "object" || payload === null || !("error" in payload)) {
      return undefined;
    }

    const error = payload.error;
    if (typeof error !== "object" || error === null || !("message" in error)) {
      return undefined;
    }

    return typeof error.message === "string" ? error.message : undefined;
  }

  function isGenerationResult(payload) {
    return (
      typeof payload === "object" &&
      payload !== null &&
      "title" in payload &&
      typeof payload.title === "string" &&
      "body" in payload &&
      typeof payload.body === "string" &&
      "warnings" in payload &&
      Array.isArray(payload.warnings) &&
      payload.warnings.every((warning) => typeof warning === "string")
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

  function renderResult(result) {
    const title = document.createElement("h3");
    title.textContent = result.title;

    const body = document.createElement("p");
    body.textContent = result.body;

    resultArea.replaceChildren(resultTitle, title, body);

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
      const { payload, response } = await submitRequest(input);
      if (!response.ok) {
        renderError(readErrorMessage(payload) ?? "Не удалось составить заявку");
        return;
      }

      if (!isGenerationResult(payload)) {
        renderError("Сервис вернул некорректный результат");
        return;
      }

      renderResult(payload);
    } catch {
      renderError("Не удалось связаться с сервисом. Попробуйте позже");
    } finally {
      setSubmitting(false);
    }
  }

  description.addEventListener("input", updateCharacterCount);
  form.addEventListener("submit", handleSubmit);
})();
