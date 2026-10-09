export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Sends through Resend's REST API (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendEmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<{ id: string }> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from: this.from, ...message }),
    });
    if (!response.ok) {
      throw new Error(`Resend returned ${response.status}: ${await response.text()}`);
    }
    return (await response.json()) as { id: string };
  }
}
