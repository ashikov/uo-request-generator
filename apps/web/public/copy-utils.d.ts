export function formatCopyText(title: string, body: string): string;
export function copyToClipboard(text: string): Promise<{ success: boolean; error?: string }>;
