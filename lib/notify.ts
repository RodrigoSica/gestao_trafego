
/**
 * Entrega do aviso de publicação.
 *
 * Telegram foi escolhido por ser o único canal instantâneo que não exige
 * aprovação nem contrato: basta um bot criado pelo @BotFather. WhatsApp
 * passaria de novo pela revisão da Meta — o mesmo gargalo que este modo
 * existe para evitar.
 */

export type ChannelTarget = { kind: string; target: string };
export type DeliveryResult = { ok: true } | { ok: false; error: string };

const TELEGRAM_API = "https://api.telegram.org";

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

async function sendTelegram(chatId: string, text: string): Promise<DeliveryResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN não configurado no ambiente." };
  }

  try {
    const response = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Texto puro: o conteúdo vem do usuário e escaparia mal em HTML/Markdown.
      // O Telegram já transforma URLs em links automaticamente.
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { ok: false, error: `Telegram ${response.status}: ${detail.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Falha de rede ao chamar o Telegram: ${String(error).slice(0, 200)}` };
  }
}

async function sendWebhook(url: string, payload: unknown): Promise<DeliveryResult> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return { ok: false, error: `Webhook respondeu ${response.status}.` };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Falha de rede no webhook: ${String(error).slice(0, 200)}` };
  }
}

export async function deliver(
  channel: ChannelTarget,
  message: string,
  payload: unknown
): Promise<DeliveryResult> {
  if (channel.kind === "telegram") return sendTelegram(channel.target, message);
  if (channel.kind === "webhook") return sendWebhook(channel.target, payload);
  return { ok: false, error: `Canal desconhecido: ${channel.kind}` };
}
