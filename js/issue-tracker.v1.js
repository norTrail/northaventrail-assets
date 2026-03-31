/* See Something, Say Something — Standalone Squarespace Script */
(() => {
    'use strict';

    // -------------------------
    // Globals & Constants
    // -------------------------
    const WORKER_URL = "https://northaventrail-gas-proxy.will-5e4.workers.dev/submit";
    const POI_API_URL = "https://assets.northaventrail.org/json/trail-poi.json";
    const TURNSTILE_SITE_KEY = "0x4AAAAAACyDAaZelhZKmNJT";

    const searchValues = [];
    let map, marker;
    const DEFAULT_MARKER_LONGITUDE = -96.82099635665163;
    const DEFAULT_MARKER_LATITUDE = 32.89603152402648;
    const DEFAULT_TRAIL_ZOOM = 12; // used by resetMapMarker()

    let turnstileWidgetId = null;
    let turnstileToken = null;

    let uploadsInProgress = 0;
    let uploadedImageNames = [];
    let imageList = [];
    let geolocationServiceActive = true;
    let currentFocus = -1;
    let uploadTimer;
    let files = [];
    let formSubmitted = false;
    let hasAutoLocated = false;
    let searchResults = [];

    // DOM Refs
    let form, submitButton, fileInput, previewContainer, errorMessage, uploadButton, usePhotoGPSButton,
        hiddenImageNames, shortDescription, longDescription, emailInput, tabs, tabContents,
        latitudeInput, longitudeInput, locationListInput, locationList, resetMapMarkerButton;

    let manualLatitudeInput, manualLongitudeInput, applyLatLngBtn, latErrorEl, lngErrorEl;
    let firstNameInput, lastNameInput, rememberContactCheckbox;

    // -------------------------
    // SVG Sprite Loader
    // -------------------------
    function loadSvgSpriteOnce() {
        if (document.getElementById("svg-sprite-inline")) return;
        fetch("https://assets.northaventrail.org/img/icons.svg", { cache: "force-cache" })
            .then(r => {
                if (!r.ok) throw new Error(`SVG sprite fetch failed: ${r.status}`);
                return r.text();
            })
            .then(svgText => {
                if (document.getElementById("svg-sprite-inline")) return; // guard re-entry
                const div = document.createElement("div");
                div.id = "svg-sprite-inline";
                div.setAttribute("aria-hidden", "true");
                div.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
                div.innerHTML = svgText;
                document.body.insertBefore(div, document.body.firstChild);
            })
            .catch(err => {
                console.warn("SVG sprite load failed:", err);
                window.logClientErrorToServer?.({ kind: "svg_load_failed", error: err?.message, stack: err?.stack });
            });
    }

    // -------------------------
    // Utilities & Helpers
    // -------------------------
    const isApple = () => /Mac|iPhone|iPad|iPod/.test(navigator.platform);

    function announce(el, msg) {
        if (!el) return;
        el.textContent = '';
        setTimeout(() => { el.textContent = msg; }, 0);
    }

    function showMessage(message) {
        const el = document.getElementById('progress');
        if (!el) return;
        if (message) {
            el.classList.remove('hidden');
            el.textContent = message;
        } else {
            el.classList.add('hidden');
            el.textContent = '';
        }
    }

    function exifRationalToNumber(value) {
        if (typeof value === 'number') return value;
        if (value && typeof value.numerator === 'number' && typeof value.denominator === 'number' && value.denominator !== 0) {
            return value.numerator / value.denominator;
        }
        const num = Number(value);
        return Number.isFinite(num) ? num : NaN;
    }

    function parseExifCoordinate(parts, ref) {
        if (!Array.isArray(parts) || parts.length < 3) return null;
        const deg = exifRationalToNumber(parts[0]);
        const min = exifRationalToNumber(parts[1]);
        const sec = exifRationalToNumber(parts[2]);
        if (![deg, min, sec].every(Number.isFinite)) return null;
        let decimal = deg + (min / 60) + (sec / 3600);
        if (/^[SW]$/i.test(String(ref || ''))) decimal *= -1;
        return Number.isFinite(decimal) ? decimal : null;
    }

    function warnExifGpsFailure() {
        errorMessage.textContent = "We couldn't read usable GPS coordinates from that photo.";
        errorMessage.classList.remove('hidden');
        announce(document.getElementById('sr-updates'), "We couldn't read usable GPS coordinates from that photo.");
    }

    function isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
    }

    function validateForm() {
        const setState = (elId, valid) => {
            const el = document.getElementById(elId);
            el?.classList.toggle('error', !valid);
            const input = elId === 'short-description' ? shortDescription :
                elId === 'email' ? emailInput : null;
            if (input) input.setAttribute('aria-invalid', String(!valid));
        };
        const setError = (id, show) => document.getElementById(id)?.classList.toggle('hidden', !show);

        let firstFocusEl = null;

        const shortOk = shortDescription.value.trim() !== '';
        setState('short-description', shortOk);
        setState('short-descriptionLabel', shortOk);
        setError('short-descriptionError', !shortOk);
        if (!shortOk) firstFocusEl = shortDescription;

        const emailVal = emailInput.value.trim();
        const emailOk = emailVal === '' || isValidEmail(emailVal);
        setState('email', emailOk);
        setState('emailLabel', emailOk);
        setError('emailError', !emailOk);
        if (!emailOk && !firstFocusEl) firstFocusEl = emailInput;

        // Coordinate Validation (if provided)
        const lat = latitudeInput.value.trim();
        const lng = longitudeInput.value.trim();
        const coordsOk = (!lat && !lng) || (lat !== "" && lng !== "" && !isNaN(lat) && !isNaN(lng));
        // We don't have a specific error UI for hidden inputs, but we can block submission
        if (!coordsOk && !firstFocusEl) {
            // This shouldn't happen with the map UI, but better safe.
            announce(document.getElementById('sr-updates'), "Invalid coordinates.");
            return false;
        }

        if (firstFocusEl) {
            firstFocusEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            firstFocusEl.focus({ preventScroll: true });
            return false;
        }
        return true;
    }

    // -------------------------
    // GAS API Bridge (Fetch)
    // -------------------------
    async function callGAS(params, isExit = false) {
        try {
            let tsToken = '';
            if (params.page === 'saveData') {
                tsToken = turnstileToken || '';
            }

            const fetchOptions = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...params,
                    _turnstile: tsToken,
                    _hp: document.querySelector('.nt-honeypot')?.value || '',
                }),
            };
            if (isExit) fetchOptions.keepalive = true;

            const response = await fetch(WORKER_URL, fetchOptions);
            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Server error (${response.status}): ${text}`);
            }
            const rawText = await response.text();
            let data;
            try {
                data = JSON.parse(rawText);
            } catch (_) {
                throw new Error(`Server returned non-JSON response: ${rawText.slice(0, 200)}`);
            }

            // Reset Turnstile after a successful form submission so it can be re-used
            if (params.page === 'saveData' && typeof turnstile !== 'undefined' && turnstileWidgetId !== null) {
                turnstile.reset(turnstileWidgetId);
                turnstileToken = null;
            }

            return { result: 'success', ...data };
        } catch (e) {
            if (!isExit) {
                console.error("GAS Call Failed:", e);
                if (typeof TrailmapError !== 'undefined' && TrailmapError.logClientErrorToServer) {
                    TrailmapError.logClientErrorToServer({
                        kind: "issue_tracker_post_error",
                        message: e.message,
                        stack: e.stack,
                        data: { params }
                    });
                }
            }
            throw e;
        }
    }

    // NOTE: Image upload via GET is limited by URL length. 
    // We use POST for file uploads as it is the standard for multi-part data.
    async function uploadImageToGAS(base64Data, fileName) {
        try {
            const payload = {
                p: 'uploadFile',
                data: base64Data,
                fileName: fileName,
                _hp: '',
            };

            const response = await fetch(WORKER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Upload failed (${response.status}): ${text}`);
            }

            return { status: 'submitted' };
        } catch (e) {
            console.error("Upload failed", e);
            throw e;
        }
    }

    function buildUniqueFilename(originalName, prefix = "report") {
        const dotIndex = originalName.lastIndexOf(".");
        const ext = dotIndex > -1 ? originalName.slice(dotIndex).toLowerCase() : ".jpg";
        const uuid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11);
        return `${prefix}-${uuid}${ext}`;
    }

    async function deleteImageFromGAS(fileName, isExit = false) {
        try {
            const params = {
                page: 'removeFile',
                fileName: fileName
            };
            callGAS(params, isExit).catch(() => { /* ignore exit errors */ });
        } catch (e) {
            if (!isExit) console.error("Delete failed", e);
        }
    }

    // -------------------------
    // Tabs & Map UI Logic
    // -------------------------
    function activateTab(tab, index) {
        // Roving tabindex: deactivate all tabs and panels
        tabs.forEach((t, i) => {
            t.classList.remove('active');
            t.setAttribute('aria-selected', 'false');
            t.setAttribute('tabindex', '-1');
            const panel = tabContents[i];
            if (panel) {
                panel.classList.remove('active');
                panel.setAttribute('tabindex', '-1');
            }
        });

        // Activate selected tab
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        tab.setAttribute('tabindex', '0');

        const activePanel = tabContents[index];
        if (activePanel) {
            activePanel.classList.add('active');
            activePanel.setAttribute('tabindex', '0');

            // Focus Management: Shift focus to the primary action in the new panel
            const firstInput = activePanel.querySelector('button, input, textarea');
            if (firstInput) {
                setTimeout(() => firstInput.focus(), 10);
            } else if (tab.id === 'tab3') {
                // For the Map tab, focus the map container
                setTimeout(() => document.getElementById('map').focus(), 10);
            }
        }

        // Enable draggable on both Drag Marker (tab3) and Photo (tab4)
        // Guard: marker may not exist yet if map hasn't initialised
        if (marker) {
            if (tab.id === 'tab3' || tab.id === 'tab4') {
                marker.setDraggable(true);
                document.getElementById('issueMarker')?.classList.remove('non-draggable');
            } else {
                marker.setDraggable(false);
                document.getElementById('issueMarker')?.classList.add('non-draggable');
            }
        }
    }

    function syncGPSTab() {
        const anyHasGPS = imageList.some(img => img.hasGPS);
        const photoTabHead = document.getElementById('tab4');

        if (anyHasGPS) {
            photoTabHead.classList.remove('hidden');
            photoTabHead.setAttribute('tabindex', '0');
        } else {
            photoTabHead.classList.add('hidden');
            photoTabHead.setAttribute('tabindex', '-1');
            // If the Photo tab was active and is now hidden, switch to Drag Marker (tab3)
            if (photoTabHead.classList.contains('active')) {
                activateTab(document.getElementById('tab3'), 2);
            }
        }
    }

    function scrollToIssueTracker() {
        const container = document.getElementById('issue-tracker-container');
        if (container) {
            const top = container.getBoundingClientRect().top + window.pageYOffset - 40; // 40px offset for iOS Dynamic Island
            window.scrollTo({ top, behavior: 'smooth' });
        }
    }

    function resetForm() {
        formSubmitted = false;
        hasAutoLocated = false;
        imageList = [];
        uploadedImageNames = [];
        uploadsInProgress = 0;

        // Reset inputs (excluding contact info as requested earlier for persistence)
        shortDescription.value = "";
        longDescription.value = "";
        if (hiddenImageNames) hiddenImageNames.value = "";
        if (fileInput) fileInput.value = "";

        // Reset visibility
        document.getElementById('thankYou').classList.add('hidden');
        document.getElementById('saving').classList.add('hidden');
        document.getElementById('submitForm').classList.remove('hidden');
        hideSpinner();

        // Reset Map & Tabs
        resetMapMarker();
        syncGPSTab();
        renderPreviews();

        // Default to GPS tab
        if (tabs && tabs[0]) activateTab(tabs[0], 0);

        scrollToIssueTracker();

        // Re-enable submit button
        submitButton.disabled = false;
        form.setAttribute('aria-busy', 'false');
    }

    function moveMarker(lat, lng, reason = "") {
        if (!lat || !lng) return;
        if (!map || !marker) return;
        marker.setLngLat([lng, lat]).addTo(map);
        map.flyTo({ center: [lng, lat], zoom: 16 });
        latitudeInput.value = lat;
        longitudeInput.value = lng;
        manualLatitudeInput.value = parseFloat(lat).toFixed(6);
        manualLongitudeInput.value = parseFloat(lng).toFixed(6);
        resetMapMarkerButton.classList.remove('hidden');
        if (reason) announce(document.getElementById('sr-updates'), `Marker moved to ${reason}.`);
    }

    // -------------------------
    // Contact Persistence
    // -------------------------
    function loadSavedContactInfo() {
        const saved = localStorage.getItem('issue_tracker_contact');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                firstNameInput.value = data.firstName || '';
                lastNameInput.value = data.lastName || '';
                emailInput.value = data.email || '';
                rememberContactCheckbox.checked = true;
            } catch (e) {
                console.error("Failed to parse saved contact info", e);
            }
        }
    }

    function saveContactInfo() {
        if (rememberContactCheckbox.checked) {
            const data = {
                firstName: firstNameInput.value,
                lastName: lastNameInput.value,
                email: emailInput.value
            };
            localStorage.setItem('issue_tracker_contact', JSON.stringify(data));
        } else {
            localStorage.removeItem('issue_tracker_contact');
        }
    }

    function resetMapMarker() {
        latitudeInput.value = "";
        longitudeInput.value = "";
        resetMapMarkerButton.classList.add('hidden');
        if (marker) marker.setLngLat([DEFAULT_MARKER_LONGITUDE, DEFAULT_MARKER_LATITUDE]);
        if (map) map.fitBounds(window.MAP_BOUNDS || [[-96.75639, 32.9154], [-96.88808, 32.87847]], { padding: 40 });

        // Close any open popups
        const popUps = document.getElementsByClassName('mapboxgl-popup');
        if (popUps[0]) popUps[0].remove();

        announce(document.getElementById('sr-updates'), "Map marker reset to default trail location.");
    }

    function showSpinner() {
        const spinner = document.getElementById('spinner');
        spinner && spinner.classList.remove('hidden');
    }

    function hideSpinner() {
        const spinner = document.getElementById('spinner');
        spinner && spinner.classList.add('hidden');
    }

    function renderPreviews() {
        if (!previewContainer) return;
        previewContainer.innerHTML = '';
        // Clear status if no images (reset case)
        if (imageList.length === 0) {
            const progressEl = document.getElementById('progress');
            if (progressEl) progressEl.textContent = "";
        }
        imageList.forEach((img, idx) => {
            const div = document.createElement('div');
            div.className = 'image-preview';
            div.innerHTML = `<img src="${img.url}" alt="Preview of uploaded image ${idx + 1}"><button type="button" aria-label="Remove image ${idx + 1}" data-idx="${idx}">X</button>`;
            div.querySelector('button').onclick = () => {
                const imgObj = imageList[idx];
                deleteImageFromGAS(imgObj.fileName, false);
                imageList.splice(idx, 1);

                if (imageList.length === 0) {
                    hasAutoLocated = false;
                } else if (imgObj.hasGPS) {
                    const stillHasGPS = imageList.some(img => img.hasGPS);
                    if (!stillHasGPS) hasAutoLocated = false;
                }

                syncGPSTab();
                renderPreviews();
                announce(document.getElementById('sr-updates'), `Image ${idx + 1} removed.`);
                uploadButton.focus();
            };
            previewContainer.appendChild(div);
        });

        // Update Upload Button State & Text
        const count = imageList.length;
        if (count >= 3) {
            uploadButton.disabled = true;
            uploadButton.textContent = "Upload Images";
            errorMessage.classList.remove('hidden');
            errorMessage.textContent = "Maximum of 3 images reached.";
        } else {
            uploadButton.disabled = false;
            errorMessage.classList.add('hidden');
            if (count === 0) {
                uploadButton.textContent = "Upload Images";
            } else if (count === 1) {
                uploadButton.textContent = "Add Other Images";
            } else if (count === 2) {
                uploadButton.textContent = "Add Other Image";
            }
        }
    }

    function updateUploadStatus() {
        const progressEl = document.getElementById('progress');
        if (!progressEl) return;

        if (uploadsInProgress > 0) {
            progressEl.classList.remove('hidden');
            progressEl.textContent = "Uploading image(s)... please wait.";
        } else if (imageList.length > 0) {
            progressEl.classList.remove('hidden');
            progressEl.textContent = "Image(s) successfully uploaded!";
            // Keep the success message for 5 seconds unless a new upload starts
            setTimeout(() => {
                if (uploadsInProgress === 0 && progressEl.textContent === "Image(s) successfully uploaded!") {
                    progressEl.textContent = "";
                }
            }, 5000);
        } else {
            progressEl.textContent = "";
        }
    }

    function initCharCounters() {
        const trackedIds = ['short-description', 'long-description', 'first-name', 'last-name'];
        trackedIds.forEach(id => {
            const input = document.getElementById(id);
            const counter = document.getElementById(`${id}-counter`);
            if (!input || !counter) return;

            const maxLength = parseInt(input.getAttribute('maxlength'));
            if (isNaN(maxLength)) return;

            const update = () => {
                const remaining = maxLength - input.value.length;
                const formatted = new Intl.NumberFormat().format(remaining);
                counter.textContent = `${formatted} characters left`;

                counter.classList.toggle('warning', remaining <= 5 && remaining > 0);
                counter.classList.toggle('danger', remaining === 0);
            };

            // Remove existing listener to prevent duplicates on reset
            input.removeEventListener('input', input._counterUpdate);
            input._counterUpdate = update;
            input.addEventListener('input', update);

            update(); // Initial call
        });
    }

    // -------------------------
    // Initialization
    // -------------------------
    function init() {
        const testForm = document.getElementById('report-form');
        if (!testForm || testForm.dataset.ntInitialized) return;

        // Found a new form instance — reset state for this DOM
        testForm.dataset.ntInitialized = "true";
        turnstileWidgetId = null;
        turnstileToken = null;

        loadSvgSpriteOnce(); // loads icons.svg sprite so fullscreen btn icons render

        // Cache Elements
        form = document.getElementById('report-form');
        submitButton = document.getElementById('submitButton');
        fileInput = document.getElementById('file');
        previewContainer = document.getElementById('image-preview-container');
        errorMessage = document.getElementById('error-message');
        uploadButton = document.getElementById('upload-button');
        usePhotoGPSButton = document.getElementById('photoGPSMessageButton');
        hiddenImageNames = document.getElementById('imageNames');
        shortDescription = document.getElementById('short-description');
        longDescription = document.getElementById('long-description');
        emailInput = document.getElementById('email');
        tabs = document.querySelectorAll('.tab-header li');
        tabContents = document.querySelectorAll('.tab-content');
        latitudeInput = document.getElementById('latitude');
        longitudeInput = document.getElementById('longitude');
        locationListInput = document.getElementById('locationListInput');
        locationList = document.getElementById('locationListbox');
        const clearSearch = document.getElementById('clearSearch');
        resetMapMarkerButton = document.getElementById('resetMapMarker');
        applyLatLngBtn = document.getElementById('applyLatLng');
        manualLatitudeInput = document.getElementById('manual-latitude');
        manualLongitudeInput = document.getElementById('manual-longitude');
        firstNameInput = document.getElementById('first-name');
        lastNameInput = document.getElementById('last-name');
        rememberContactCheckbox = document.getElementById('rememberContact');

        // Honeypot field — hidden from real users, filled by bots
        const hpField = document.createElement('input');
        hpField.type = 'text';
        hpField.name = 'website';
        hpField.className = 'nt-honeypot';
        hpField.autocomplete = 'off';
        hpField.tabIndex = -1;
        hpField.setAttribute('aria-hidden', 'true');
        form.appendChild(hpField);

        if (locationListInput) {
            locationListInput.setAttribute('role', 'combobox');
            locationListInput.setAttribute('aria-haspopup', 'listbox');
            locationListInput.setAttribute('aria-controls', 'locationListbox');
            locationListInput.setAttribute('aria-expanded', 'false');
            locationListInput.setAttribute('aria-autocomplete', 'list');
        }
        if (locationList) locationList.setAttribute('role', 'listbox');

        const issueMapEl = document.getElementById('map');
        if (issueMapEl) {
            issueMapEl.setAttribute('role', 'region');
            issueMapEl.setAttribute('aria-roledescription', 'interactive map');
        }

        function initTurnstile() {
            if (typeof turnstile !== 'undefined' && !turnstileWidgetId) {
                turnstile.ready(() => {
                    setTimeout(() => {
                        // Double check container existence
                        const container = document.getElementById('nt-turnstile-container');
                        if (!container) return;

                        turnstileWidgetId = turnstile.render(container, {
                            sitekey: TURNSTILE_SITE_KEY,
                            callback: (token) => { turnstileToken = token; },
                            'expired-callback': () => { turnstileToken = null; },
                            'error-callback': () => { turnstileToken = null; },
                        });
                    }, 500);
                });
            }
        }

        // Turnstile widget container — rendered before the submit button
        const tsContainer = document.createElement('div');
        tsContainer.id = 'nt-turnstile-container';
        submitButton.parentNode.insertBefore(tsContainer, submitButton);
        initTurnstile();

        // Load saved info
        loadSavedContactInfo();

        // Initialize Character Counters (no map dependency)
        initCharCounters();

        // Tab Logic
        tabs.forEach((tab, i) => {
            tab.addEventListener('click', () => activateTab(tab, i));
            tab.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    activateTab(tab, i);
                } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    let nextIndex = i + 1;
                    // Skip hidden tabs (like photo tab if no GPS)
                    while (nextIndex < tabs.length && tabs[nextIndex].classList.contains('hidden')) {
                        nextIndex++;
                    }
                    if (nextIndex >= tabs.length) nextIndex = 0; // Wrap around
                    tabs[nextIndex].focus();
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    let prevIndex = i - 1;
                    // Skip hidden tabs
                    while (prevIndex >= 0 && tabs[prevIndex].classList.contains('hidden')) {
                        prevIndex--;
                    }
                    if (prevIndex < 0) prevIndex = tabs.length - 1; // Wrap around
                    // Find last visible if wrapping backwards
                    if (prevIndex === tabs.length - 1) {
                        while (prevIndex >= 0 && tabs[prevIndex].classList.contains('hidden')) {
                            prevIndex--;
                        }
                    }
                    tabs[prevIndex].focus();
                }
            });
        });

        // Ensure the initial tab state is synced (sets marker draggability correctly)
        if (tabs && tabs[0]) activateTab(tabs[0], 0);

        // File Uploads
        uploadButton.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async (e) => {
            const selected = Array.from(e.target.files);

            // Filter to image files only (MIME type + extension fallback for HEIC/HEIF)
            const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
            const ALLOWED_EXTS = /\.(jpe?g|png|gif|webp|heic|heif)$/i;
            const valid = selected.filter(f => ALLOWED_TYPES.includes(f.type) || ALLOWED_EXTS.test(f.name));
            if (valid.length < selected.length) {
                errorMessage.textContent = "Only image files (JPEG, PNG, GIF, WebP, HEIC) are allowed.";
                errorMessage.classList.remove('hidden');
                if (valid.length === 0) { fileInput.value = ""; return; }
            } else {
                errorMessage.classList.add('hidden');
            }

            if (imageList.length + valid.length > 3) {
                errorMessage.textContent = "Maximum of 3 images allowed.";
                errorMessage.classList.remove('hidden');
                fileInput.value = "";
                return;
            }

            for (const file of valid) {
                const reader = new FileReader();
                reader.onload = async (event) => {
                    const uniqueFileName = buildUniqueFilename(file.name);
                    const url = event.target.result;
                    const imgData = { url, fileName: uniqueFileName, file, hasGPS: false };
                    const index = imageList.push(imgData) - 1;

                    renderPreviews();

                    // 1. EXIF Extraction (Immediate feedback)
                    if (typeof EXIF !== 'undefined') {
                        EXIF.getData(file, function () {
                            const lat = EXIF.getTag(this, "GPSLatitude");
                            const lng = EXIF.getTag(this, "GPSLongitude");
                            const latRef = EXIF.getTag(this, "GPSLatitudeRef");
                            const lngRef = EXIF.getTag(this, "GPSLongitudeRef");
                            if (lat && lng) {
                                const decLat = parseExifCoordinate(lat, latRef);
                                const decLng = parseExifCoordinate(lng, lngRef);

                                if (!Number.isFinite(decLat) || !Number.isFinite(decLng)) {
                                    warnExifGpsFailure();
                                    return;
                                }

                                imgData.hasGPS = true;
                                imgData.lat = decLat;
                                imgData.lng = decLng;

                                syncGPSTab();
                                activateTab(tabs[3], 3);

                                // Prioritize the first available GPS info
                                if (!hasAutoLocated) {
                                    moveMarker(decLat, decLng, "the location from your photo");
                                    hasAutoLocated = true;
                                }
                            }
                        });
                    }

                    // 2. Upload to GAS
                    uploadsInProgress++;
                    updateUploadStatus();
                    try {
                        // Standard GAS upload flow
                        await uploadImageToGAS(url, uniqueFileName);
                    } catch (err) {
                        console.error(err);
                    } finally {
                        uploadsInProgress--;
                        updateUploadStatus();
                    }
                };
                reader.readAsDataURL(file);
            }
            // Reset input value so the same file selection triggers change event again
            e.target.value = '';
        });



        // Photo GPS Logic
        usePhotoGPSButton.onclick = () => {
            const photoWithGPS = imageList.find(img => img.hasGPS);
            if (photoWithGPS) {
                moveMarker(photoWithGPS.lat, photoWithGPS.lng, "the location from your photo");
            } else {
                announce(document.getElementById('sr-updates'), "No GPS data found in your uploaded photos.");
            }
        };

        // Geolocation
        document.getElementById('getLocationButton').onclick = () => {
            if (navigator.geolocation) {
                announce(document.getElementById('sr-updates'), "Requesting your location...");
                navigator.geolocation.getCurrentPosition(pos => {
                    moveMarker(pos.coords.latitude, pos.coords.longitude, "your current location");
                }, err => {
                    console.warn(err);
                    announce(document.getElementById('sr-updates'), "Unable to get location: " + err.message);
                });
            }
        };

        // Manual Coordinates
        applyLatLngBtn.onclick = () => {
            const lat = parseFloat(manualLatitudeInput.value);
            const lng = parseFloat(manualLongitudeInput.value);
            if (!isNaN(lat) && !isNaN(lng)) moveMarker(lat, lng, "your manually entered coordinates");
        };

        // Reset Map Marker
        resetMapMarkerButton.onclick = () => resetMapMarker();

        // -------------------------
        // Map-ready callback (set by trailmap-init.js in ISSUE_TRACKER_MODE)
        // Handles everything that requires the map instance: marker, drag events, POI search.
        // -------------------------
        let _poiFeatures = [];
        let _searchListenersAttached = false;
        let _activeOptionIndex = -1;

        function decodeHTML_(str) {
            const txt = document.createElement('textarea');
            txt.innerHTML = str;
            return txt.value;
        }

        function selectPOIOption_(item) {
            if (!item) return;
            moveMarker(item.coords[1], item.coords[0], item.name);
            locationListInput.value = item.name;
            hideDropdown_();
            clearSearch.classList.remove('hidden');
            if (map) {
                new mapboxgl.Popup({ offset: 35 })
                    .setLngLat([item.coords[0], item.coords[1]])
                    .setHTML(`<strong>${item.name}</strong>`)
                    .addTo(map);
            }
        }

        function syncActivePOIOption_() {
            const options = locationList.querySelectorAll('.optionDropdown[role="option"]');
            options.forEach((opt, idx) => {
                const active = idx === _activeOptionIndex;
                opt.setAttribute('aria-selected', active ? 'true' : 'false');
                opt.classList.toggle('activeOption', active);
            });

            const activeEl = options[_activeOptionIndex];
            if (activeEl) {
                locationListInput.setAttribute('aria-activedescendant', activeEl.id);
                activeEl.scrollIntoView({ block: 'nearest' });
            } else {
                locationListInput.removeAttribute('aria-activedescendant');
            }
        }

        function renderPOIResult_(features) {
            locationList.innerHTML = '';
            searchResults = [];
            _activeOptionIndex = -1;
            if (features.length === 0) {
                locationList.innerHTML = '<div class="optionDropdown" role="option" aria-selected="false" id="poi-opt-empty">No matches found</div>';
                locationListInput.removeAttribute('aria-activedescendant');
                return;
            }
            features.forEach((feat, idx) => {
                const p = feat.properties || {};
                const rawName = String(p.l || p.n || '').trim();
                if (!rawName) return;
                const name = decodeHTML_(rawName);
                const coords = feat.geometry?.coordinates;
                if (!coords || coords.length !== 2) return;
                const item = { name, coords };
                searchResults.push(item);

                const opt = document.createElement('div');
                opt.className = 'optionDropdown';
                opt.setAttribute('role', 'option');
                opt.setAttribute('aria-selected', 'false');
                opt.id = `poi-opt-${searchResults.length - 1}`;
                opt.textContent = name;
                opt.dataset.idx = String(searchResults.length - 1);
                opt.addEventListener('mouseenter', () => {
                    _activeOptionIndex = Number(opt.dataset.idx);
                    syncActivePOIOption_();
                });
                opt.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    selectPOIOption_(item);
                });
                locationList.appendChild(opt);
            });
            _activeOptionIndex = searchResults.length ? 0 : -1;
            syncActivePOIOption_();
        }

        function syncDropdownWidth_() {
            locationList.style.width = locationListInput.offsetWidth + 'px';
        }

        function showDropdown_() {
            locationList.classList.remove('hidden');
            locationListInput.setAttribute('aria-expanded', 'true');
        }

        function hideDropdown_() {
            locationList.classList.add('hidden');
            locationListInput.setAttribute('aria-expanded', 'false');
            _activeOptionIndex = -1;
            locationListInput.removeAttribute('aria-activedescendant');
        }

        function attachSearchListeners_() {
            if (_searchListenersAttached) return;
            _searchListenersAttached = true;

            locationListInput.oninput = () => {
                const q = locationListInput.value.toLowerCase().trim();
                clearSearch.classList.toggle('hidden', q.length === 0);
                const filtered = _poiFeatures.filter(f => {
                    const p = f.properties || {};
                    const name = (p.l || p.n || '').toLowerCase();
                    return name.includes(q);
                });
                renderPOIResult_(filtered);
                syncDropdownWidth_();
                showDropdown_();
            };

            locationListInput.onfocus = () => {
                if (locationListInput.value.trim() === '') {
                    renderPOIResult_(_poiFeatures);
                }
                syncDropdownWidth_();
                showDropdown_();
            };

            clearSearch.onclick = () => {
                locationListInput.value = '';
                clearSearch.classList.add('hidden');
                renderPOIResult_(_poiFeatures);
                hideDropdown_();
                locationListInput.focus();
            };

            locationListInput.addEventListener('keydown', (e) => {
                const isOpen = !locationList.classList.contains('hidden');
                if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                    renderPOIResult_(locationListInput.value.trim() ? searchResults : _poiFeatures);
                    syncDropdownWidth_();
                    showDropdown_();
                }

                if (e.key === 'Escape') {
                    hideDropdown_();
                    return;
                }

                if (locationList.classList.contains('hidden') || searchResults.length === 0) return;

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    _activeOptionIndex = Math.min(_activeOptionIndex + 1, searchResults.length - 1);
                    syncActivePOIOption_();
                    return;
                }

                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    _activeOptionIndex = Math.max(_activeOptionIndex - 1, 0);
                    syncActivePOIOption_();
                    return;
                }

                if (e.key === 'Enter' && _activeOptionIndex >= 0) {
                    e.preventDefault();
                    selectPOIOption_(searchResults[_activeOptionIndex]);
                }
            });

            document.addEventListener('click', (e) => {
                if (!locationList.contains(e.target) && e.target !== locationListInput) {
                    hideDropdown_();
                }
            });
        }

        window.onIssueTrackerMapReady = (m) => {
            map = m;

            // Error logging
            if (typeof TrailmapError !== 'undefined' && TrailmapError.attachErrorLogging) {
                TrailmapError.attachErrorLogging(map, { appName: "Report Issue Page" });
            }

            // Remove stale marker from previous map instance (WebGL recovery case)
            if (marker) {
                try { marker.remove(); } catch (_) { }
            }

            // Create draggable marker
            const el = document.createElement('div');
            el.className = 'issueMarker map';
            el.id = 'issueMarker';
            el.setAttribute('role', 'img');
            el.style.touchAction = 'none';
            marker = new mapboxgl.Marker(el, { draggable: false, anchor: 'bottom' })
                .setLngLat([DEFAULT_MARKER_LONGITUDE, DEFAULT_MARKER_LATITUDE])
                .addTo(map);

            // Re-sync active tab's draggable state now that marker exists
            const activeTab = Array.from(tabs).find(t => t.getAttribute('aria-selected') === 'true');
            if (activeTab) activateTab(activeTab, Array.from(tabs).indexOf(activeTab));

            marker.on('dragstart', () => {
                document.body.style.overflow = 'hidden';
            });

            marker.on('dragend', () => {
                document.body.style.overflow = '';
                const { lat, lng } = marker.getLngLat();
                latitudeInput.value = lat;
                longitudeInput.value = lng;
                manualLatitudeInput.value = parseFloat(lat).toFixed(6);
                manualLongitudeInput.value = parseFloat(lng).toFixed(6);
                resetMapMarkerButton.classList.remove('hidden');
                announce(document.getElementById('sr-updates'), "Marker moved to the location you dragged it to.");
            });

            // Fetch POI data for the location search.
            // Note: onIssueTrackerMapReady is already called from inside map.once('idle') in
            // trailmap-init, so the map is already idle here — no need to wait for another idle.
            (async () => {
                try {
                    const res = await fetch(POI_API_URL);
                    const payload = await res.json();
                    _poiFeatures = payload.features || [];
                    renderPOIResult_(_poiFeatures);
                } catch (e) {
                    console.error("Failed to load POIs", e);
                }
            })();

            // Wire search UI listeners (only once — safe across WebGL reinits)
            attachSearchListeners_();
        };

        // Form Submission
        form.onsubmit = async (e) => {
            e.preventDefault();

            if (uploadsInProgress > 0) {
                announce(document.getElementById('sr-updates'), "Please wait for your photos to finish uploading before submitting.");
                alert("Please wait for your photos to finish uploading.");
                return;
            }

            if (!validateForm()) return;

            form.setAttribute('aria-busy', 'true');
            submitButton.disabled = true;
            document.getElementById('submitForm').classList.add('hidden');
            document.getElementById('saving').classList.remove('hidden');
            showSpinner();
            scrollToIssueTracker();
            announce(document.getElementById('sr-updates'), "Submitting report, please wait...");

            const rawParams = {
                page: 'saveData',
                Task: shortDescription.value,
                Details: longDescription.value,
                "First Name": firstNameInput?.value || "",
                "Last Name": lastNameInput?.value || "",
                "Email Address": emailInput.value,
                Coordinates: (latitudeInput.value && longitudeInput.value) ? `(${latitudeInput.value}, ${longitudeInput.value})` : "",
                Latitude: latitudeInput.value || "",
                Longitude: longitudeInput.value || "",
                Images: imageList.length > 0 ? JSON.stringify(imageList.map(img => img.fileName)) : ""
            };

            const params = {};
            for (const key in rawParams) {
                if (rawParams[key] && rawParams[key].toString().trim() !== "") {
                    params[key] = rawParams[key];
                }
            }

            try {
                // Save contact info if requested
                saveContactInfo();

                const res = await callGAS(params);
                if (res.result === 'success') {
                    formSubmitted = true;
                    hideSpinner();
                    document.getElementById('saving').classList.add('hidden');
                    document.getElementById('thankYou').classList.remove('hidden');
                    document.getElementById('thankYouTitle').focus();
                    scrollToIssueTracker();
                    announce(document.getElementById('sr-updates'), "Report submitted successfully. Thank you!");
                } else {
                    throw new Error(res.message);
                }
            } catch (err) {
                alert("Submission failed: " + err.message);
                hideSpinner();
                document.getElementById('saving').classList.add('hidden');
                document.getElementById('submitForm').classList.remove('hidden');
                announce(document.getElementById('sr-updates'), "Submission failed. Please check the form and try again.");
            } finally {
                form.setAttribute('aria-busy', 'false');
                submitButton.disabled = false;
            }
        };

        document.getElementById('buttonReload').onclick = () => {
            resetForm();
        };

    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Handle AJAX-based navigation (specifically for Squarespace)
    window.addEventListener('popstate', init);
    window.addEventListener('mercury:load', init); // Squarespace AJAX event

    window.addEventListener('pagehide', () => {
        if (!formSubmitted && imageList.length > 0) {
            imageList.forEach((img) => {
                deleteImageFromGAS(img.fileName, true);
            });
        }
    });

})();
