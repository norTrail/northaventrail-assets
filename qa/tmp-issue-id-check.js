"use strict";

const puppeteer = require("puppeteer");

const QA_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/146.0.0.0 Safari/537.36";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(QA_USER_AGENT);

    const pageErrors = [];
    const consoleMessages = [];

    page.on("pageerror", (err) => pageErrors.push(String(err && err.message || err)));
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") {
        consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
      }
    });

    await page.goto("https://northaventrail.org/report-trail-issue?id=7999478", {
      waitUntil: "networkidle2",
      timeout: 45000
    });

    await page.waitForSelector(".mapboxgl-canvas", { timeout: 30000 });
    await delay(5000);

    const result = await page.evaluate(() => {
      const input = document.getElementById("locationListInput");
      const reset = document.getElementById("resetMapMarker");
      const marker = document.getElementById("issueMarker");
      return {
        href: location.href,
        search: location.search,
        requestedId: new URLSearchParams(location.search).get("id"),
        inputValue: input ? input.value : null,
        tabs: Array.from(document.querySelectorAll(".tab-header li")).map((el) => ({
          id: el.id,
          text: (el.textContent || "").trim(),
          active: el.classList.contains("active")
        })),
        latitude: document.getElementById("latitude")?.value || "",
        longitude: document.getElementById("longitude")?.value || "",
        markerPresent: !!marker,
        markerClass: marker ? marker.className : null,
        resetVisible: reset ? !reset.classList.contains("hidden") : null
      };
    });

    console.log(JSON.stringify({ result, pageErrors, consoleMessages }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
