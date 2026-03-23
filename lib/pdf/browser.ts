import puppeteer from "puppeteer-core";

export async function generatePDF(html: string): Promise<Buffer> {
  const isLocal = process.env.NODE_ENV === "development";

  let browser;

  if (isLocal) {
    browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      executablePath:
        process.platform === "darwin"
          ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
          : "/usr/bin/google-chrome",
      headless: true,
    });
  } else {
    const chromium = await import("@sparticuz/chromium");
    chromium.default.setGraphicsMode = false;

    browser = await puppeteer.launch({
      args: [
        ...chromium.default.args,
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
        "--no-zygote",
      ],
      defaultViewport: chromium.default.defaultViewport,
      executablePath: await chromium.default.executablePath(
        "https://github.com/Sparticuz/chromium/releases/download/v110.0.1/chromium-v110.0.1-pack.tar"
      ),
      headless: true,
    });
  }

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
