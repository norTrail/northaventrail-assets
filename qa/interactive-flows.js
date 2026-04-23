"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const puppeteer = require("puppeteer");

const QA_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/146.0.0.0 Safari/537.36";
const QA_MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) " +
  "Version/17.0 Mobile/15E148 Safari/604.1";
const TRAILMAP_LIVE_URL = pathToFileURL(path.join(__dirname, "..", "trailmap-live.html")).href;
const TRAILMAP_POI_MANIFEST = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "json", "trail-poi.latest.json"), "utf8")
);
const TRAILMAP_POI_DATA_URL = String(TRAILMAP_POI_MANIFEST.current || "").trim();
const TRAILMAP_POI_DATA = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "json", path.basename(TRAILMAP_POI_DATA_URL)), "utf8")
);

async function goto(page, url) {
  await page.setUserAgent(page.__qaUserAgent || QA_USER_AGENT);
  const response = await page.goto(url, {
    waitUntil: "networkidle2",
    timeout: 45000
  });
  const status = response && response.status();
  if (url.startsWith("file://")) {
    assert.ok(response === null || status === 0 || status === 200, `Expected local file to load for ${url}, got ${status}`);
    return;
  }
  assert.ok(status === 200 || status === 304, `Expected 200/304 for ${url}, got ${status}`);
}

async function waitForMap(page) {
  try {
    await page.waitForFunction(
      () => {
        const isVisible = (selector) => {
          const el = document.querySelector(selector);
          if (!el) return false;
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0;
        };

        const trailmapSearchReady = (() => {
          try {
            return typeof SEARCH_READY !== "undefined" && SEARCH_READY === true;
          } catch (_err) {
            return false;
          }
        })();

        const hasPoiData = (() => {
          try {
            return Array.isArray(poiData?.features) && poiData.features.length > 0;
          } catch (_err) {
            return Array.isArray(window.poiData?.features) && window.poiData.features.length > 0;
          }
        })();
        const hasCanvas = isVisible(".mapboxgl-canvas");
        const hasSearchUi = isVisible("#searchButton") || isVisible("#locationListInput");
        const hasIssueTrackerUi = isVisible("#tab2") || isVisible(".issueListPanel");
        const hasTailsUi = isVisible("#status-pill") || isVisible(".sheep-marker") || isVisible("#controls");
        const hasValentineUi = isVisible("#valentine-carousel") || isVisible(".popUpClingImage");

        return hasCanvas ||
          (trailmapSearchReady && hasPoiData && hasSearchUi) ||
          hasIssueTrackerUi ||
          hasTailsUi ||
          hasValentineUi;
      },
      { timeout: 30000 }
    );
  } catch (err) {
    const diagnostics = await page.evaluate(() => {
      const visible = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0;
      };

      let searchReady = null;
      try {
        searchReady = typeof SEARCH_READY !== "undefined" ? SEARCH_READY : null;
      } catch (_innerErr) {
        searchReady = "error";
      }

      return {
        hasCanvas: visible(".mapboxgl-canvas"),
        hasSearchButton: visible("#searchButton"),
        hasSearchInput: visible("#locationListInput"),
        hasIssueTrackerTab: visible("#tab2"),
        hasStatusPill: visible("#status-pill"),
        hasValentineCarousel: visible("#valentine-carousel"),
        hasPoiData: (() => {
          try {
            return Array.isArray(poiData?.features) ? poiData.features.length : 0;
          } catch (_innerErr) {
            return Array.isArray(window.poiData?.features) ? window.poiData.features.length : 0;
          }
        })(),
        searchReady,
        overlayPresent: !!document.getElementById("map-loading-overlay"),
        title: document.title
      };
    }).catch(() => null);

    const detail = diagnostics ? ` ${JSON.stringify(diagnostics)}` : "";
    throw new Error(`Map never reached an interactive ready state.${detail}`);
  }
}

async function waitForPoiData(page, timeout = 60000) {
  await page.waitForFunction(
    () => {
      try {
        return Array.isArray(poiData?.features) && poiData.features.length > 0;
      } catch (_err) {
        return Array.isArray(window.poiData?.features) && window.poiData.features.length > 0;
      }
    },
    { timeout }
  );
}

async function waitForTrailmapDetails(page, options = {}) {
  const { mobile = false } = options;
  const selector = mobile
    ? "#nc-bottom-sheet .nc-sheet-body .nc-name"
    : ".nc-desktop-card:not([hidden]) .nc-name";

  await page.waitForSelector(selector, {
    visible: true,
    timeout: 15000
  });
}

function launchBrowser(options = {}) {
  const {
    viewport = { width: 1440, height: 960 },
    userAgent = QA_USER_AGENT
  } = options;

  return puppeteer.launch({
    headless: true,
    defaultViewport: viewport,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  }).then(async (browser) => {
    browser.__qaUserAgent = userAgent;
    return browser;
  });
}

async function newPage(browser) {
  const page = await browser.newPage();
  page.__qaUserAgent = browser.__qaUserAgent || QA_USER_AGENT;
  await page.setUserAgent(page.__qaUserAgent);
  return page;
}

async function installTrailmapPoiFixture(page) {
  await page.evaluateOnNewDocument(
    ({ manifestUrl, manifest, dataUrl, data }) => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = function patchedFetch(resource, init) {
        const url = typeof resource === "string" ? resource : resource?.url || "";
        if (url === manifestUrl) {
          return Promise.resolve(
            new Response(JSON.stringify(manifest), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            })
          );
        }
        if (url === dataUrl) {
          return Promise.resolve(
            new Response(JSON.stringify(data), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            })
          );
        }
        return originalFetch(resource, init);
      };
    },
    {
      manifestUrl: "https://assets.northaventrail.org/json/trail-poi.latest.json",
      manifest: TRAILMAP_POI_MANIFEST,
      dataUrl: TRAILMAP_POI_DATA_URL,
      data: TRAILMAP_POI_DATA
    }
  );
}

function assertHeadersAllowMapillaryViewer() {
  const headersPath = path.join(__dirname, "..", "_headers");
  const headersText = fs.readFileSync(headersPath, "utf8");
  const cspLines = headersText
    .split("\n")
    .filter((line) => line.includes("Content-Security-Policy:"));

  assert.ok(cspLines.length >= 2, "Expected both scoped and global CSP header rules");
  assert.ok(cspLines.some((line) => /script-src[^;]*'unsafe-eval'/.test(line)), "CSP should allow unsafe-eval for MapillaryJS");
  for (const line of cspLines) {
    assert.match(line, /script-src[^;]*https:\/\/unpkg\.com/, "CSP should allow Mapillary JS from unpkg.com");
    assert.match(line, /style-src[^;]*https:\/\/unpkg\.com/, "CSP should allow Mapillary CSS from unpkg.com");
    assert.match(line, /connect-src[^;]*https:\/\/graph\.mapillary\.com/, "CSP should allow Mapillary API requests");
    assert.match(line, /connect-src[^;]*https:\/\/unpkg\.com/, "CSP should allow Mapillary sourcemap requests from unpkg.com");
    assert.match(line, /connect-src[^;]*https:\/\/\*\.fbcdn\.net/, "CSP should allow Mapillary image buffer requests from fbcdn.net");
  }

  console.log("headers mapillary csp: pass");
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

  const resolvedButtonSelector = await page.waitForFunction(
    (sel) => {
      const buttons = Array.from(document.querySelectorAll(sel));
      const visible = buttons.find((el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0;
      });
      if (!visible) return null;
      if (!visible.id) return sel;
      return `#${CSS.escape(visible.id)}`;
    },
    { timeout: 30000 },
    buttonSelector
  ).then((handle) => handle.jsonValue());

  await page.$eval(resolvedButtonSelector, (el) => {
    el.scrollIntoView({ block: "center" });
    el.click();
  });

  await waitForMenuState_(page, resolvedButtonSelector, menuSelector, true);

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
  }, resolvedButtonSelector, menuSelector);

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

  await page.$eval(resolvedButtonSelector, (el) => el.click());
  await waitForMenuState_(page, resolvedButtonSelector, menuSelector, false);

  await page.$eval(resolvedButtonSelector, (el) => el.click());
  await waitForMenuState_(page, resolvedButtonSelector, menuSelector, true);

  await page.keyboard.press("Escape");
  await waitForMenuState_(page, resolvedButtonSelector, menuSelector, false);

  await page.focus(resolvedButtonSelector);
  await page.keyboard.press("Enter");
  await waitForMenuState_(page, resolvedButtonSelector, menuSelector, true);

  const keyboardState = await page.evaluate((btnSel) => {
    const btn = document.querySelector(btnSel);
    const row = btn?.closest("tr");
    return {
      rowActive: row?.classList.contains("active") || false,
      rowIsActive: row?.classList.contains("is-active") || false
    };
  }, resolvedButtonSelector);

  assert.equal(keyboardState.rowActive, true, `${label} keyboard open should keep row active`);
  assert.equal(keyboardState.rowIsActive, true, `${label} keyboard open should keep row is-active`);

  await page.keyboard.press("Escape");
  await waitForMenuState_(page, resolvedButtonSelector, menuSelector, false);
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

async function closeTrailmapDetails(page, options = {}) {
  const { mobile = false } = options;
  if (mobile) {
    await page.waitForSelector("#nc-bottom-sheet .nc-close-btn", {
      visible: true,
      timeout: 10000
    });
    await page.click("#nc-bottom-sheet .nc-close-btn");
    await page.waitForFunction(() => {
      const card = window.NorthavenCard;
      return !card || !card.isSheetVisible || card.isSheetVisible() === false;
    }, { timeout: 10000 });
    return;
  }

  await page.keyboard.press("Escape");
  try {
    await page.waitForFunction(() => !document.querySelector(".nc-desktop-card:not([hidden])"), {
      timeout: 3000
    });
  } catch (_err) {
    const closeButton = await page.$(".nc-desktop-card:not([hidden]) .nc-close-btn");
    if (closeButton) await closeButton.click();
    await page.waitForFunction(() => !document.querySelector(".nc-desktop-card:not([hidden])"), {
      timeout: 10000
    });
  }
}

async function trailmapPopupLightboxFlow(browser) {
  const page = await newPage(browser);
  try {
    await installTrailmapPoiFixture(page);
    await goto(page, TRAILMAP_LIVE_URL);
    await waitForMap(page);
    // "mural" matches "Mural on Northaven Trail Bridge" which has a Drive image
    await openTrailmapSearch(page, "mural");
    await waitForTrailmapDetails(page);

    const triggerState = await page.evaluate(() => {
      const trigger = document.querySelector(".nc-desktop-card .nc-thumb-wrap[data-hires]");
      return {
        exists: !!trigger,
        dataUrl: trigger ? (trigger.getAttribute("data-hires") || "") : ""
      };
    });

    assert.equal(triggerState.exists, true, "Sidecar with image should have a high-resolution thumbnail trigger");
    assert.ok(triggerState.dataUrl.startsWith("https://"), "Sidecar image trigger should have a valid https data-hires URL");

    await page.$eval(".nc-desktop-card .nc-thumb-wrap[data-hires]", (el) => el.click());

    await page.waitForFunction(() => {
      const legacyLightbox = document.getElementById("lightbox-map");
      const modernLightbox = document.querySelector(".nc-lightbox");
      return Boolean(
        (legacyLightbox && legacyLightbox.style.display === "flex") ||
        modernLightbox
      );
    }, { timeout: 10000 });

    const lightboxState = await page.evaluate(() => {
      const legacyLightbox = document.getElementById("lightbox-map");
      const modernLightbox = document.querySelector(".nc-lightbox");
      const img = legacyLightbox?.querySelector(".lightbox-image") ||
        modernLightbox?.querySelector(".nc-lightbox-img");
      return {
        hasImage: !!img,
        imgSrc: img ? img.getAttribute("src") : ""
      };
    });

    assert.equal(lightboxState.hasImage, true, "Lightbox should contain an image");
    assert.ok(lightboxState.imgSrc.length > 0, "Lightbox image should have a src");

    // Regression: escape handler checked display === "block" but lightbox uses flex,
    // so the guard was always falsy — Escape closed the popup while lightbox was open.
    // Fix (e4f2f8f): check display !== "none" instead.
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => {
      const legacyLightbox = document.getElementById("lightbox-map");
      const modernLightbox = document.querySelector(".nc-lightbox");
      const legacyClosed = !legacyLightbox || !legacyLightbox.style.display || legacyLightbox.style.display === "none";
      return legacyClosed && !modernLightbox;
    }, { timeout: 10000 });

    const sidecarStillOpen = await page.evaluate(() => !!document.querySelector(".nc-desktop-card:not([hidden])"));
    assert.equal(sidecarStillOpen, true, "Escape while lightbox open should close lightbox but keep the sidecar open");

    await closeTrailmapDetails(page);

    console.log("trailmap sidecar lightbox: pass");
  } finally {
    await page.close();
  }
}

async function trailmapMapillaryModalFlow(browser) {
  const page = await newPage(browser);
  try {
    await installTrailmapPoiFixture(page);
    await goto(page, TRAILMAP_LIVE_URL);
    await waitForMap(page);
    const opened = await page.evaluate((fixtureData) => {
      if (typeof createPopUp !== "function" || !Array.isArray(fixtureData?.features)) return false;
      window.poiData = fixtureData;
      const feature = fixtureData.features.find((item) => {
        const mid = String(item?.properties?.m_id || "").trim();
        return /^\d+$/.test(mid) && Array.isArray(item?.geometry?.coordinates) && item.geometry.coordinates.length === 2;
      });
      if (!feature) return false;
      createPopUp(feature);
      return true;
    }, TRAILMAP_POI_DATA);

    assert.equal(opened, true, "trailmap-live should be able to open details for a Mapillary-backed POI");
    await page.waitForSelector(".nc-desktop-card .nc-hero-link[data-mid]", { visible: true, timeout: 15000 });
    await page.$eval(".nc-desktop-card .nc-hero-link[data-mid]", (el) => el.click());

    await page.waitForFunction(() => {
      const modal = document.getElementById("nc-mapillary-modal");
      return modal && !modal.hidden && document.body.classList.contains("nc-mapillary-open");
    }, { timeout: 15000 });

    const modalState = await page.evaluate(() => {
      const modal = document.getElementById("nc-mapillary-modal");
      return {
        hasModal: !!modal,
        hasViewerMount: !!document.getElementById("nc-mapillary-viewer"),
        hasScript: !!document.querySelector('script[data-nc-ext-script*="mapillary-js"]'),
        hasStylesheet: !!document.querySelector('link[data-nc-ext-style*="mapillary-js"]'),
        linkHref: modal?.querySelector(".nc-mapillary-link")?.getAttribute("href") || "",
        closeFocused: document.activeElement?.classList?.contains("nc-mapillary-close") || false
      };
    });

    assert.equal(modalState.hasModal, true, "Mapillary modal should exist");
    assert.equal(modalState.hasViewerMount, true, "Mapillary modal should include a viewer mount");
    assert.equal(modalState.hasScript, true, "Mapillary modal should lazy-load the Mapillary JS asset");
    assert.equal(modalState.hasStylesheet, true, "Mapillary modal should lazy-load the Mapillary stylesheet");
    assert.ok(modalState.linkHref.includes("mapillary.com/app/?pKey="), "Mapillary modal should provide a direct fallback link");
    assert.equal(modalState.closeFocused, true, "Mapillary modal should move focus to the close button");

    await page.keyboard.press("Escape");
    await page.waitForFunction(() => {
      const modal = document.getElementById("nc-mapillary-modal");
      return modal && modal.hidden && !document.body.classList.contains("nc-mapillary-open");
    }, { timeout: 10000 });

    console.log("trailmap mapillary modal: pass");
  } finally {
    await page.close();
  }
}

async function trailmapSearchFlow(browser) {
  const page = await newPage(browser);
  try {
    await installTrailmapPoiFixture(page);
    await goto(page, TRAILMAP_LIVE_URL);
    await waitForMap(page);
    await openTrailmapSearch(page, "royal");
    await page.waitForFunction(() => window.location.search.includes("loc="), { timeout: 15000 });

    await waitForTrailmapDetails(page);

    await closeTrailmapDetails(page);

    // Regression: search used a single includes(query) check, so "mural bridge" failed to
    // match "Mural on Northaven Trail Bridge" because the substring isn't contiguous.
    // Fix (410699c): split query into tokens and require all tokens to match individually.
    await openTrailmapSearch(page, "mural bridge");
    const hasMultiWordPanel = await page.waitForSelector(".nc-desktop-card:not([hidden])", {
      visible: true,
      timeout: 15000
    }).then(() => true).catch(() => false);
    assert.equal(hasMultiWordPanel, true, "Multi-word search 'mural bridge' should open the sidecar (both tokens must match independently)");

    console.log("trailmap-live search: pass");
  } finally {
    await page.close();
  }
}

async function trailmapMobileCardFlow(browser) {
  const page = await newPage(browser);
  try {
    await installTrailmapPoiFixture(page);
    await goto(page, TRAILMAP_LIVE_URL);
    await waitForMap(page);

    await openTrailmapSearch(page, "royal");
    await page.waitForFunction(() => window.location.search.includes("loc="), { timeout: 15000 });
    await waitForTrailmapDetails(page, { mobile: true });

    const firstState = await page.evaluate(() => ({
      activeFeatureId: String(window.NorthavenCard?.getActiveFeatureId?.() || ""),
      visible: Boolean(window.NorthavenCard?.isSheetVisible?.()),
      title: document.querySelector("#nc-bottom-sheet .nc-name")?.textContent?.trim() || "",
      hasShareButton: !!document.querySelector("#nc-bottom-sheet .nc-share-btn"),
      hasCloseButton: !!document.querySelector("#nc-bottom-sheet .nc-close-btn")
    }));

    assert.equal(firstState.visible, true, "Mobile trailmap search should open the bottom sheet");
    assert.ok(firstState.activeFeatureId.length > 0, "Mobile trailmap bottom sheet should have an active feature id");
    assert.ok(firstState.title.length > 0, "Mobile trailmap bottom sheet should show a title");
    assert.equal(firstState.hasShareButton, true, "Mobile trailmap bottom sheet should include a share button");
    assert.equal(firstState.hasCloseButton, true, "Mobile trailmap bottom sheet should include a close button");

    await openTrailmapSearch(page, "mural bridge");
    await waitForTrailmapDetails(page, { mobile: true });

    const secondState = await page.evaluate(() => ({
      activeFeatureId: String(window.NorthavenCard?.getActiveFeatureId?.() || ""),
      visible: Boolean(window.NorthavenCard?.isSheetVisible?.()),
      title: document.querySelector("#nc-bottom-sheet .nc-name")?.textContent?.trim() || ""
    }));

    assert.equal(secondState.visible, true, "A second mobile trailmap search should keep the bottom sheet visible");
    assert.ok(secondState.activeFeatureId.length > 0, "A second mobile trailmap search should keep an active feature id");
    assert.notEqual(
      secondState.activeFeatureId,
      firstState.activeFeatureId,
      "A second mobile trailmap search should update the bottom sheet to a different feature"
    );
    assert.notEqual(
      secondState.title,
      firstState.title,
      "A second mobile trailmap search should update the bottom sheet title"
    );

    await closeTrailmapDetails(page, { mobile: true });
    console.log("trailmap mobile card: pass");
  } finally {
    await page.close();
  }
}

async function mapsMenuPageFlow(browser, url, label) {
  const page = await newPage(browser);
  try {
    await goto(page, url);
    await assertMapsMenuToggle(page, { label });
    console.log(`${label}: pass`);
  } finally {
    await page.close();
  }
}

async function issueTrackerSearchFlow(browser) {
  const page = await newPage(browser);
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
  const page = await newPage(browser);
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
  const page = await newPage(browser);
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

    // Regression (13def5e): popup image was a raw <img role="button"> with src_large attr;
    // showModal(img) now reads data-src-large from the button wrapper, so passing the img
    // produced a blank modal. Fix: wrapped in <button class="popUpClingImageButton"> with
    // data-src-large / data-alt. Test must click the button (not call showModal on the img).
    await page.waitForSelector(".popUpClingImageButton", { visible: true, timeout: 15000 });
    await page.$eval(".popUpClingImageButton", (el) => el.click());
    await page.waitForFunction(() => {
      const modal = document.getElementById("myModal");
      return modal && modal.getAttribute("aria-hidden") === "false";
    }, { timeout: 10000 });

    const modalState = await page.evaluate(() => {
      const modal = document.getElementById("myModal");
      const img = modal?.querySelector("#img01");
      return {
        activeIsClose: document.activeElement?.classList?.contains("close") || false,
        modalVisible: modal?.getAttribute("aria-hidden") === "false",
        modalImgSrc: img ? img.getAttribute("src") || "" : ""
      };
    });

    assert.equal(modalState.modalVisible, true, "Valentine modal should be visible");
    assert.equal(modalState.activeIsClose, true, "Valentine modal should move focus to close button");
    assert.ok(modalState.modalImgSrc.length > 0, "Valentine modal image should have a non-empty src (regression: showModal(img) instead of showModal(button) produced a blank image)");

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
  assertHeadersAllowMapillaryViewer();
  const browser = await launchBrowser();
  const mobileBrowser = await launchBrowser({
    viewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
    userAgent: QA_MOBILE_USER_AGENT
  });
  try {
    await trailmapPopupLightboxFlow(browser);
    await trailmapMapillaryModalFlow(browser);
    await trailmapSearchFlow(browser);
    await trailmapMobileCardFlow(mobileBrowser);
    await mapsMenuPageFlow(browser, "https://northaventrail.org/map-points-of-interest", "listing maps menu");
    await mapsMenuPageFlow(browser, "https://northaventrail.org/hawk-lights", "hawk lights maps menu");
    await issueTrackerSearchFlow(browser);
    await tailsMarkerFlow(browser);
    await valentineModalFlow(browser);
  } finally {
    await browser.close();
    await mobileBrowser.close();
  }
}

main().catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
