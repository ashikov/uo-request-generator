/**
 * Формирует текст для копирования из заголовка и тела заявки.
 * @param {string} title
 * @param {string} body
 * @returns {string}
 */
export function formatCopyText(title, body) {
  return `${title}\n\n${body}`;
}

/**
 * Копирует текст в буфер обмена.
 * @param {string} text
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function copyToClipboard(text) {
  if (typeof navigator === "undefined" || navigator.clipboard === undefined) {
    return { success: false, error: "Буфер обмена недоступен" };
  }

  try {
    await navigator.clipboard.writeText(text);
    return { success: true };
  } catch {
    return { success: false, error: "Не удалось скопировать" };
  }
}
