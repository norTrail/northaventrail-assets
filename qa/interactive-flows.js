"use strict";

const assert = require("node:assert/strict");
const puppeteer = require("puppeteer");

async function goto(page, url) {
  const response = await page.goto(url, {
    waitUntil: "networkidle2",
    timeout: 45000
  });
  assert.equal(response && response.status(), 200, `Expected 200 for ${url}`);
}

async function waitForMap(page) {
  await page.waitForSelector(".mapboxgl-canvas", {
    visible: true,
    timeout: 30000
  });
}

async function trailmapSearchFlow(browser) {
  const page = await browser.newPage();
  try {
    await goto(page, "https://northaventrail.org/trailmap");
    await waitForMap(page);
    await page.waitForSelector("#searchButton", { visible: true, timeout: 15000 });
    await page.click("#searchButton");
    await page.waitForSelector("#locationListInput", { visible: true, timeout: 15000 });
    await page.waitForFunction(() => {
      try {
        return typeof SEARCH_READY !== "undefined" && SEARCH_READY === true;
      } catch (_err) {
        return false;
      }
    }, { timeout: 30000 });

    await page.click("#locationListInput", { clickCount: 3 });
    await page.type("#locationListInput", "royal", { delay: 40 });
    await page.waitForFunction(() => {
      const opts = document.querySelectorAll(".searchOption[role='option']");
      return opts.length > 0;
    }, { timeout: 30000 });

    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.location.search.includes("loc="), { timeout: 15000 });

    const hasPopup = await page.waitForSelector(".mapboxgl-popup", {
      visible: true,
      timeout: 15000
    }).then(() => true).catch(() => false);

    assert.equal(hasPopup, true, "Trailmap search should open a popup");
    console.log("trailmap search: pass");
  } finally {
    await page.close();
  }
}

async function listingMapsMenuFlow(browser) {
  const page = await browser.newPage();
  try {
    await goto(page, "https://northaventrail.org/map-points-of-interest");
    await page.waitForFunction(() => document.querySelectorAll(".mapsBtn").length > 0, {
      timeout: 30000
    });

    await page.$eval(".mapsBtn", (el) => {
      el.scrollIntoView({ block: "center" });
      el.click();
    });
    await page.waitForFunction(() => {
      const btn = document.querySelector(".mapsBtn");
      const menu = document.querySelector(".mapsMenu");
      return btn?.getAttribute("aria-expanded") === "true" && menu && !menu.hidden;
    }, { timeout: 10000 });

    const menuState = await page.evaluate(() => {
      const menu = document.querySelector(".mapsMenu:not([hidden])");
      const items = menu ? Array.from(menu.querySelectorAll(".mapsMenuItem")).map((el) => ({
        text: (el.textContent || "").trim(),
        href: el.getAttribute("href") || ""
      })) : [];
      return {
        expanded: document.querySelector(".mapsBtn")?.getAttribute("aria-expanded"),
        items
      };
    });

    assert.equal(menuState.expanded, "true", "Maps button should be expanded");
    assert.ok(menuState.items.some((item) => /Trail Map/i.test(item.text)), "Maps menu should include Trail Map");
    assert.ok(menuState.items.some((item) => /Google Maps/i.test(item.text)), "Maps menu should include Google Maps");
    assert.ok(menuState.items.some((item) => /Apple Maps/i.test(item.text)), "Maps menu should include Apple Maps");

    await page.keyboard.press("Escape");
    await page.waitForFunction(() => {
      const btn = document.querySelector(".mapsBtn");
      const menu = document.querySelector(".mapsMenu");
      return btn?.getAttribute("aria-expanded") === "false" && !!menu?.hidden;
    }, { timeout: 10000 });

    console.log("listing maps menu: pass");
  } finally {
    await page.close();
  }
}

async function issueTrackerSearchFlow(browser) {
  const page = await browser.newPage();
  try {
    await goto(page, "https://northaventrail.org/report-trail-issue");
    await waitForMap(page);
    await page.waitForSelector("#tab2", { visible: true, timeout: 15000 });
    await page.click("#tab2");
    await page.waitForSelector("#locationListInput", { visible: true, timeout: 15000 });

    await page.click("#locationListInput", { clickCount: 3 });
    await page.type("#locationListInput", "royal", { delay: 40 });
    await page.waitForSelector(".optionDropdown[role='option']", { visible: true, timeout: 15000 });

    await page.keyboard.press("Enter");
    await page.waitForSelector(".mapboxgl-popup", { visible: true, timeout: 15000 });

    const state = await page.evaluate(() => ({
      value: document.getElementById("locationListInput")?.value || "",
      popupText: document.querySelector(".mapboxgl-popup")?.textContent || ""
    }));

    assert.ok(state.value.length > 0, "Issue tracker search should fill input with selected location");
    assert.ok(state.popupText.trim().length > 0, "Issue tracker popup should contain text");

    console.log("issue tracker search: pass");
  } finally {
    await page.close();
  }
}

async function tailsMarkerFlow(browser) {
  const page = await browser.newPage();
  try {
    await goto(page, "https://northaventrail.org/tails-2026");
    await waitForMap(page);
    await page.waitForSelector(".sheep-marker", { visible: true, timeout: 30000 });

    await page.click(".sheep-marker");
    await page.waitForSelector(".mapboxgl-popup", { visible: true, timeout: 15000 });

    const popupHeading = await page.$eval(".mapboxgl-popup h3", (el) => (el.textContent || "").trim());
    assert.ok(popupHeading.length > 0, "TAILS popup should have a heading");

    console.log("tails marker popup: pass");
  } finally {
    await page.close();
  }
}

async function valentineModalFlow(browser) {
  const page = await browser.newPage();
  try {
    await goto(page, "https://northaventrail.org/valentine-cling-map-2027");
    await waitForMap(page);

    const opened = await page.evaluate(() => {
      try {
        if (typeof map === "undefined" || !map) return false;
        if (typeof currentClingByLocationID === "undefined" || !currentClingByLocationID?.size) return false;
        const feature = Array.from(currentClingByLocationID.values())[0];
        const coords = feature?.geometry?.coordinates;
        if (!feature || !Array.isArray(coords) || coords.length !== 2) return false;
        if (typeof openPopupForFeature !== "function") return false;
        openPopupForFeature(feature, coords, "no");
        return true;
      } catch (_err) {
        return false;
      }
    });

    assert.equal(opened, true, "Valentine page should be able to open a cling popup");

    await page.waitForSelector(".popUpClingImage", { visible: true, timeout: 15000 });
    await page.$eval(".popUpClingImage", (el) => {
      if (typeof showModal === "function") {
        showModal(el);
      } else {
        el.click();
      }
    });
    await page.waitForFunction(() => {
      const modal = document.getElementById("myModal");
      return modal && modal.getAttribute("aria-hidden") === "false";
    }, { timeout: 10000 });

    const modalState = await page.evaluate(() => ({
      activeIsClose: document.activeElement?.classList?.contains("close") || false,
      modalVisible: document.getElementById("myModal")?.getAttribute("aria-hidden") === "false"
    }));

    assert.equal(modalState.modalVisible, true, "Valentine modal should be visible");
    assert.equal(modalState.activeIsClose, true, "Valentine modal should move focus to close button");

    await page.keyboard.press("Escape");
    const closedState = await page.waitForFunction(() => {
      const modal = document.getElementById("myModal");
      return modal &&
        modal.getAttribute("aria-hidden") === "true" &&
        document.body.style.position === "";
    }, { timeout: 10000 });

    assert.equal(await closedState.jsonValue(), true, "Valentine modal should close cleanly on Escape");
    console.log("valentine modal: pass");
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  try {
    await trailmapSearchFlow(browser);
    await listingMapsMenuFlow(browser);
    await issueTrackerSearchFlow(browser);
    await tailsMarkerFlow(browser);
    await valentineModalFlow(browser);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
