export async function generatePDF(html: string): Promise<Buffer> {
  const apiKey = process.env.BROWSERLESS_API_KEY;

  if (!apiKey) {
    throw new Error("BROWSERLESS_API_KEY is not set");
  }

  const response = await fetch(
    `https://chrome.browserless.io/pdf?token=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        html,
        options: {
          format: "Letter",
          printBackground: true,
          margin: {
            top: "0.5in",
            right: "0.5in",
            bottom: "0.5in",
            left: "0.5in",
          },
        },
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Browserless error: ${response.status} — ${text}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
