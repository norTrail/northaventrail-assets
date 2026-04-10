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

function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
}

async function waitForMenuState_(page, btnSel, menuSel, open) {
  await page.waitForFunction(
    (b, m, o) => {
      const btn = document.querySelector(b);
      const menu = document.querySelector(m);
      return btn?.getAttribute("aria-expanded") === (o ? "true" : "false") &&
             menu && (o ? !menu.hidden : !!menu.hidden);
    },
    { timeout: 10000 },
    btnSel, menuSel, open
  );
}

async function assertMapsMenuToggle(page, options = {}) {
  const {
    buttonSelector = ".mapsBtn",
    menuSelector = ".mapsMenu",
    label = "Maps menu"
  } = options;

  await page.waitForSelector(buttonSelector, { visible: true, timeout: 30000 });
  await page.$eval(buttonSelector, (el) => {
    el.scrollIntoView({ block: "center" });
    el.click();
  });

  await waitForMenuState_(page, buttonSelector, menuSelector, true);

  const menuState = await page.evaluate((btnSel, menuSel) => {
    const btn = document.querySelector(btnSel);
    const menu = document.querySelector(`${menuSel}:not([hidden])`) || document.querySelector(menuSel);
    const row = btn?.closest("tr");
    const items = menu ? Array.from(menu.querySelectorAll(".mapsMenuItem")).map((el) => ({
      text: (el.textContent || "").trim(),
      href: el.getAttribute("href") || "",
      target: el.getAttribute("target") || ""
    })) : [];
    return {
      expanded: btn?.getAttribute("aria-expanded"),
      rowActive: row?.classList.contains("active") || false,
      rowIsActive: row?.classList.contains("is-active") || false,
      items
    };
  }, buttonSelector, menuSelector);

  assert.equal(menuState.expanded, "true", `${label} button should be expanded`);
  assert.equal(menuState.rowActive, true, `${label} button should mark its row active`);
  assert.equal(menuState.rowIsActive, true, `${label} button should mark its row is-active`);
  assert.ok(menuState.items.some((item) => /Trail Map/i.test(item.text)), `${label} should include Trail Map`);
  assert.ok(menuState.items.some((item) => /Google Maps/i.test(item.text)), `${label} should include Google Maps`);
  assert.ok(menuState.items.some((item) => /Apple Maps/i.test(item.text)), `${label} should include Apple Maps`);
  assert.ok(
    menuState.items.some((item) => /Google Maps/i.test(item.text) && item.href.includes("google") && item.target === "_blank"),
    `${label} Google Maps item should open in a new tab`
  );
  assert.ok(
    menuState.items.some((item) => /Apple Maps/i.test(item.text) && item.href.includes("apple") && item.target === "_blank"),
    `${label} Apple Maps item should open in a new tab`
  );

  await page.$eval(buttonSelector, (el) => el.click());
  await waitForMenuState_(page, buttonSelector, menuSelector, false);

  await page.$eval(buttonSelector, (el) => el.click());
  await waitForMenuState_(page, buttonSelector, menuSelector, true);

  await page.keyboard.press("Escape");
  await waitForMenuState_(page, buttonSelector, menuSelector, false);

  await page.focus(buttonSelector);
  await page.keyboard.press("Enter");
  await waitForMenuState_(page, buttonSelector, menuSelector, true);

  const keyboardState = await page.evaluate((btnSel) => {
    const btn = document.querySelector(btnSel);
    const row = btn?.closest("tr");
    return {
      rowActive: row?.classList.contains("active") || false,
      rowIsActive: row?.classList.contains("is-active") || false
    };
  }, buttonSelector);

  assert.equal(keyboardState.rowActive, true, `${label} keyboard open should keep row active`);
  assert.equal(keyboardState.rowIsActive, true, `${label} keyboard open should keep row is-active`);

  await page.keyboard.press("Escape");
  await waitForMenuState_(page, buttonSelector, menuSelector, false);
}

async function openTrailmapSearch(page, term) {
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
  await page.type("#locationListInput", term, { delay: 40 });
  await page.waitForFunction(() => {
    const opts = document.querySelectorAll(".searchOption[role='option']");
    return opts.length > 0;
  }, { timeout: 30000 });
  await page.keyboard.press("Enter");
}

async function trailmapPopupLightboxFlow(browser) {
  const page = await browser.newPage();
  try {
    await goto(page, "https://northaventrail.org/trailmap");
    await waitForMap(page);
    // "mural" matches "Mural on Northaven Trail Bridge" which has a Drive image
    await openTrailmapSearch(page, "mural");
    await page.waitForSelector(".mapboxgl-popup", { visible: true, timeout: 15000 });

    const triggerState = await page.evaluate(() => {
      const trigger = document.querySelector(".mapboxgl-popup .map-popup-image-trigger");
      return {
        exists: !!trigger,
        dataUrl: trigger ? (trigger.getAttribute("data-image-url") || "") : ""
      };
    });

    assert.equal(triggerState.exists, true, "Popup with image should have .map-popup-image-trigger button");
    assert.ok(triggerState.dataUrl.startsWith("https://"), "Popup image trigger should have a valid https data-image-url");

    await page.$eval(".mapboxgl-popup .map-popup-image-trigger", (el) => el.click());

    await page.waitForFunction(() => {
      const lightbox = document.getElementById("lightbox-map");
      return lightbox && lightbox.style.display === "flex";
    }, { timeout: 10000 });

    const lightboxState = await page.evaluate(() => {
      const lightbox = document.getElementById("lightbox-map");
      const img = lightbox ? lightbox.querySelector(".lightbox-image") : null;
      return {
        hasImage: !!img,
        imgSrc: img ? img.getAttribute("src") : ""
      };
    });

    assert.equal(lightboxState.hasImage, true, "Lightbox should contain an image");
    assert.ok(lightboxState.imgSrc.length > 0, "Lightbox image should have a src");

    console.log("trailmap popup lightbox: pass");
  } finally {
    await page.close();
  }
}

async function trailmapSearchFlow(browser) {
  const page = await browser.newPage();
  try {
    await goto(page, "https://northaventrail.org/trailmap");
    await waitForMap(page);
    await openTrailmapSearch(page, "royal");
    await page.waitForFunction(() => window.location.search.includes("loc="), { timeout: 15000 });

    const hasPopup = await page.waitForSelector(".mapboxgl-popup", {
      visible: true,
      timeout: 15000
    }).then(() => true).catch(() => false);

    assert.equal(hasPopup, true, "Trailmap search should open a popup");

    const popupLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".mapboxgl-popup .popupIconLink[href]")).map((el) => ({
        label: el.getAttribute("aria-label") || "",
        target: el.getAttribute("target") || "",
        rel: el.getAttribute("rel") || ""
      }))
    );

    assert.ok(
      popupLinks.some((link) => /Google Maps/i.test(link.label) && link.target === "_blank"),
      "Trailmap popup Google Maps link should open in a new tab"
    );
    assert.ok(
      popupLinks.some((link) => /Apple Maps/i.test(link.label) && link.target === "_blank"),
      "Trailmap popup Apple Maps link should open in a new tab"
    );

    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".mapboxgl-popup"), { timeout: 10000 });

    console.log("trailmap search: pass");
  } finally {
    await page.close();
  }
}

async function mapsMenuPageFlow(browser, url, label) {
  const page = await browser.newPage();
  try {
    await goto(page, url);
    await assertMapsMenuToggle(page, { label });
    console.log(`${label}: pass`);
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

    // Detect whether the herd is currently active (markers visible) or pre-launch ("coming" state)
    const overlayState = await page.evaluate(() => {
      const pill = document.getElementById("status-pill");
      return pill ? pill.dataset.state : null;
    });

    if (overlayState === "coming" || overlayState === "sleeping" || overlayState === "history") {
      // Pre-launch / off-hours: verify the status pill and overlay banner are shown
      await page.waitForFunction(() => {
        const pill = document.getElementById("status-pill");
        return pill && pill.offsetParent !== null;
      }, { timeout: 15000 });
      const pillText = await page.$eval("#status-pill", (el) => el.innerText.trim());
      assert.ok(pillText.length > 0, "TAILS status pill should have text when not active");
      console.log(`tails status ui (${overlayState}): pass`);
    } else {
      // Active: verify a sheep marker is present and opens a popup
      await page.waitForSelector(".sheep-marker", { visible: true, timeout: 30000 });
      await page.click(".sheep-marker");
      await page.waitForSelector(".mapboxgl-popup", { visible: true, timeout: 15000 });
      const popupHeading = await page.$eval(".mapboxgl-popup h3", (el) => (el.textContent || "").trim());
      assert.ok(popupHeading.length > 0, "TAILS popup should have a heading");
      console.log("tails marker popup: pass");
    }
  } finally {
    await page.close();
  }
}

async function valentineModalFlow(browser) {
  const page = await browser.newPage();
  try {
    await goto(page, "https://northaventrail.org/valentine-cling-map-2027");
    await waitForMap(page);
    await page.waitForFunction(() => {
      try {
        return typeof currentClingByLocationID !== "undefined" && currentClingByLocationID !== null && currentClingByLocationID.size > 0;
      } catch (_err) {
        return false;
      }
    }, { timeout: 30000 });

    // Carousel mount must have role="region" (set in loadWindow — regression guard for fc8cfd5)
    const carouselRole = await page.evaluate(() => {
      const el = document.getElementById("valentine-carousel");
      return el ? el.getAttribute("role") : null;
    });
    assert.equal(carouselRole, "region", "Valentine carousel mount (#valentine-carousel) should have role='region'");

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
  const browser = await launchBrowser();
  try {
    await trailmapPopupLightboxFlow(browser);
    await trailmapSearchFlow(browser);
    await mapsMenuPageFlow(browser, "https://northaventrail.org/map-points-of-interest", "listing maps menu");
    await mapsMenuPageFlow(browser, "https://northaventrail.org/hawk-lights", "hawk lights maps menu");
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
