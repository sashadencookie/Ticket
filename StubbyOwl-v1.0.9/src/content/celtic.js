/**
 * Celtic ticket site content script (eticketing.co.uk/celtic/).
 * Runs in MAIN world at document_start.
 *
 * Flow:
 * 1. Wait for the page to fully load (detect "CHOOSE BY AREA" section)
 * 2. Check if there are results under "CHOOSE BY AREA"
 *    - If "0 Results" → signal bridge.js to start the 14.7s countdown, then reload
 *    - If results found → stop auto-refresh, proceed to step 3
 * 3. Set the Quantity using the +/- buttons
 * 4. If quantity >= 2, enable "Only show me seats together" toggle
 * 5. Select the first available area from the results list
 * 6. Wait for map-seatCard__item--price-total for "Match Adult" to appear,
 *    then use quantity-switcher__btn-value to add the quantity, proceed to step 7
 * 7. Click "Add to Basket"
 * 8. Wait for confirmation: "Your tickets has been added to basket"
 * 9. Stop monitoring and notify the user
 */

(function () {
  'use strict';

  // === Configuration ===
  const CHECK_INTERVAL_MS = 1500;
  const HUMAN_DELAY_MIN = 400;
  const HUMAN_DELAY_MAX = 900;

  // === State ===
  let isMonitoring = false;
  let settings = {};
  let taskDone = false;
  let noResultsSignalled = false; // Track whether we already told bridge to start countdown

  // Step tracking
  let pageReady = false;
  let areaAvailable = false;
  let quantitySet = false;
  let seatsTogetherSet = false;
  let areaSelected = false;
  let seatCardQtySet = false;   // Step 6: Match Adult qty via seat card
  let addToBasketClicked = false;
  let urlObserver = null;         // MutationObserver for URL changes
  let confirmationObs = null;     // MutationObserver for basket confirmation

  // === Logging ===
  function emitLog(level, message) {
    try {
      window.dispatchEvent(new CustomEvent('tf-log', {
        detail: { level, message }
      }));
    } catch (e) {}
    console.log(`[StubbyOwl] [${level.toUpperCase()}] ${message}`);
  }

  // === Utility ===
  function humanDelay(min, max) {
    min = min || HUMAN_DELAY_MIN;
    max = max || HUMAN_DELAY_MAX;
    return new Promise(resolve => setTimeout(resolve, min + Math.random() * (max - min)));
  }

  function simulateClick(el) {
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      setTimeout(() => {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        el.click();
      }, 50 + Math.random() * 100);
    }, 100 + Math.random() * 150);
  }

  function simulateInput(el, value) {
    if (!el) return;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.closest('svg')) return true;
    return el.offsetParent !== null;
  }

  function isClickable(el) {
    if (!el) return false;
    if (el.offsetParent === null && !el.closest('svg')) return false;
    if (el.disabled === true) return false;
    if (el.getAttribute('aria-disabled') === 'true') return false;
    const style = window.getComputedStyle(el);
    if (style.pointerEvents === 'none') return false;
    if (parseFloat(style.opacity) < 0.3) return false;
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
  }

  // === Wait for DOM ===
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  // =============================================
  // MAIN INITIALIZATION
  // =============================================
  onReady(() => {
    // Listen for monitoring state from bridge.js
    window.addEventListener('tf-monitoring-state', (e) => {
      const wasMonitoring = isMonitoring;
      isMonitoring = e.detail?.isMonitoring || false;
      if (isMonitoring && !wasMonitoring) {
        emitLog('info', 'Monitoring activated on page');
      }
    });

    // Listen for settings from bridge.js
    window.addEventListener('tf-settings-update', (e) => {
      settings = e.detail?.settings || {};
      emitLog('info', 'Settings received — Qty: ' + (settings.quantity || 1));
    });

    // Start the main loop
    setInterval(mainLoop, CHECK_INTERVAL_MS);

    // Watch for URL changes (SPA navigation)
    let lastUrl = window.location.href;
    urlObserver = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        emitLog('info', 'Page navigation detected: ' + lastUrl);
        resetStepState();
        checkForBasketConfirmation();
      }
    });
    if (document.body) {
      urlObserver.observe(document.body, { childList: true, subtree: true });
    }

    // Start observing for basket confirmation popup
    startConfirmationObserver();
  });

  function resetStepState() {
    pageReady = false;
    areaAvailable = false;
    quantitySet = false;
    seatsTogetherSet = false;
    areaSelected = false;
    seatCardQtySet = false;
    addToBasketClicked = false;
    noResultsSignalled = false;
  }

  // =============================================
  // MAIN LOOP
  // =============================================
  function mainLoop() {
    if (!isMonitoring || taskDone) return;

    // Step 1: Wait for page to fully load
    if (!pageReady) {
      checkPageReady();
      return;
    }

    // Step 2: Check if areas are available under "CHOOSE BY AREA"
    if (!areaAvailable) {
      checkAreaAvailability();
      return;
    }

    // Step 3: Set the quantity
    if (!quantitySet) {
      setQuantity();
      return;
    }

    // Step 4: If qty >= 2, enable "Only show me seats together"
    if (!seatsTogetherSet) {
      setSeatsTogetherToggle();
      return;
    }

    // Step 5: Select the first available area
    if (!areaSelected) {
      selectAvailableArea();
      return;
    }

    // Step 6: Wait for seat card with Match Adult, set qty, then proceed
    if (!seatCardQtySet) {
      waitForSeatCardAndSetQty();
      return;
    }

    // Step 7: Click "Add to Basket"
    if (!addToBasketClicked) {
      clickAddToBasket();
      return;
    }

    // Step 8: Wait for basket confirmation (handled by observer)
    checkForBasketConfirmation();
  }

  // =============================================
  // STEP 1: Check if page is fully loaded
  // =============================================
  function checkPageReady() {
    // The page is ready when the "CHOOSE BY AREA" section is visible
    const resultsCount = document.querySelector('.choose-areas-results__header--resultsCount');

    if (resultsCount) {
      pageReady = true;
      emitLog('info', 'Page fully loaded — "CHOOSE BY AREA" section detected');
      return;
    }

    // Check for "Your Browsing Activity Has Been Paused" (bot detection)
    const bodyText = document.body?.innerText || '';
    if (bodyText.includes('Your Browsing Activity Has Been Paused') ||
        bodyText.includes('Browsing Activity Has Been Paused')) {
      pageReady = true;
      areaAvailable = false;
      emitLog('warn', 'Bot detection triggered: "Your Browsing Activity Has Been Paused". Auto-refreshing in 5s...');
      if (!noResultsSignalled) {
        noResultsSignalled = true;
        window.dispatchEvent(new CustomEvent('tf-quick-refresh', {
          detail: { reason: 'bot_detection', delay: 5000 }
        }));
      }
      return;
    }

    // Check for "Tickets for this event are not available on general sale or have sold out"
    if (bodyText.includes('TICKETS FOR THIS EVENT ARE NOT AVAILABLE') ||
        bodyText.includes('NOT AVAILABLE ON GENERAL SALE') ||
        bodyText.includes('HAVE SOLD OUT') ||
        bodyText.includes('Tickets for this event are not available on general sale or have sold out')) {
      pageReady = true;
      areaAvailable = false;
      emitLog('warn', 'Event sold out or not on general sale. Auto-refreshing in 5s...');
      if (!noResultsSignalled) {
        noResultsSignalled = true;
        window.dispatchEvent(new CustomEvent('tf-quick-refresh', {
          detail: { reason: 'sold_out_or_unavailable', delay: 5000 }
        }));
      }
      return;
    }

    // Check for "This event is not yet available to you" — STOP monitoring and notify user
    if (bodyText.includes('This event is not yet available to you') ||
        bodyText.includes('NOT YET AVAILABLE TO YOU')) {
      pageReady = true;
      areaAvailable = false;
      emitLog('warn', 'Event not yet available to this account. Stopping monitoring and notifying user...');
      if (!noResultsSignalled) {
        noResultsSignalled = true;
        window.dispatchEvent(new CustomEvent('tf-not-available', {
          detail: { reason: 'not_yet_available', message: 'This event is not yet available to you' }
        }));
      }
      return;
    }

    // Check for other permission/restriction errors (auto-refresh in 5s)
    if (bodyText.includes('don\'t have the correct permissions')) {
      pageReady = true;
      areaAvailable = false;
      emitLog('warn', 'Permission error detected. Auto-refreshing in 5s...');
      if (!noResultsSignalled) {
        noResultsSignalled = true;
        window.dispatchEvent(new CustomEvent('tf-quick-refresh', {
          detail: { reason: 'permission_error', delay: 5000 }
        }));
      }
      return;
    }

    // Check for "This site can't be reached" — proxy connection issue
    // Switch to next proxy and refresh
    if (bodyText.includes('This site can\u2019t be reached') ||
        bodyText.includes('This site can\'t be reached') ||
        bodyText.includes('ERR_PROXY_CONNECTION_FAILED') ||
        bodyText.includes('ERR_CONNECTION_RESET') ||
        bodyText.includes('ERR_CONNECTION_TIMED_OUT') ||
        bodyText.includes('ERR_TUNNEL_CONNECTION_FAILED') ||
        document.title.includes('is not available')) {
      pageReady = true;
      areaAvailable = false;
      emitLog('warn', 'Proxy connection error: "This site can\'t be reached". Rotating to next proxy...');
      if (!noResultsSignalled) {
        noResultsSignalled = true;
        window.dispatchEvent(new CustomEvent('tf-proxy-error', {
          detail: { reason: 'site_cant_be_reached' }
        }));
      }
      return;
    }

    // Check for HTTP ERROR 407 (proxy auth failure)
    if (bodyText.includes('HTTP ERROR 407') ||
        bodyText.includes('407 Proxy Authentication Required')) {
      pageReady = true;
      areaAvailable = false;
      emitLog('warn', 'HTTP 407 Proxy Auth error. Rotating to next proxy...');
      if (!noResultsSignalled) {
        noResultsSignalled = true;
        window.dispatchEvent(new CustomEvent('tf-proxy-error', {
          detail: { reason: 'http_407' }
        }));
      }
      return;
    }

    emitLog('info', 'Waiting for page to fully load...');
  }

  // =============================================
  // STEP 2: Check area availability under "CHOOSE BY AREA"
  // =============================================
  function checkAreaAvailability() {
    const resultsCountEl = document.querySelector('.choose-areas-results__header--resultsCount');
    if (!resultsCountEl) {
      emitLog('info', 'CHOOSE BY AREA section not found, page may still be loading...');
      return;
    }

    // Get the number from the results count (e.g., "0 Results" or "5 Results")
    const countSpan = resultsCountEl.querySelector('span');
    const countText = countSpan ? countSpan.textContent.trim() : resultsCountEl.textContent.trim();
    const count = parseInt(countText, 10);

    if (isNaN(count) || count === 0) {
      // No areas available — signal bridge.js to START the 14.7s countdown
      if (!noResultsSignalled) {
        noResultsSignalled = true;
        const noResults = document.querySelector('.error-noResultsFound');
        if (noResults && isVisible(noResults)) {
          emitLog('warn', 'No areas available under "CHOOSE BY AREA" (0 Results). Starting 14.7s countdown...');
        } else {
          emitLog('info', 'CHOOSE BY AREA shows ' + countText + '. Starting 14.7s countdown...');
        }
        window.dispatchEvent(new CustomEvent('tf-start-refresh', {
          detail: { reason: 'no_results' }
        }));
      }
      // Do NOT set areaAvailable — bridge.js will reload after 14.7s
      return;
    }

    // Areas are available!
    areaAvailable = true;
    emitLog('success', 'Areas available! ' + count + ' result(s) found under "CHOOSE BY AREA". Stopping auto-refresh.');

    // Signal bridge.js to stop auto-refresh
    window.dispatchEvent(new CustomEvent('tf-stop-refresh', {
      detail: { reason: 'areas_available' }
    }));
  }

  // =============================================
  // STEP 3: Set the Quantity using +/- buttons
  // =============================================
  function setQuantity() {
    const targetQty = settings.quantity || 1;
    const qtyInput = document.querySelector('.quantity-switcher__value');

    if (!qtyInput) {
      emitLog('info', 'Quantity input not found, waiting...');
      return;
    }

    const currentQty = parseInt(qtyInput.value, 10) || 1;

    if (currentQty === targetQty) {
      quantitySet = true;
      emitLog('info', 'Quantity already set to ' + targetQty);
      return;
    }

    if (currentQty < targetQty) {
      // Click the + button
      const addBtn = document.querySelector('.tickets-quantity_add');
      if (addBtn && !addBtn.disabled) {
        emitLog('action', 'Clicking + to increase quantity (' + currentQty + ' → ' + (currentQty + 1) + ')');
        simulateClick(addBtn);
      } else {
        emitLog('warn', 'Quantity + button not found or disabled');
      }
    } else if (currentQty > targetQty) {
      // Click the - button
      const removeBtn = document.querySelector('.tickets-quantity_remove');
      if (removeBtn && !removeBtn.disabled) {
        emitLog('action', 'Clicking - to decrease quantity (' + currentQty + ' → ' + (currentQty - 1) + ')');
        simulateClick(removeBtn);
      } else {
        emitLog('warn', 'Quantity - button not found or disabled');
      }
    }

    // Re-check on next iteration to see if we reached the target
    const updatedQty = parseInt(qtyInput.value, 10) || 1;
    if (updatedQty === targetQty) {
      quantitySet = true;
      emitLog('success', 'Quantity set to ' + targetQty);
    }
  }

  // =============================================
  // STEP 4: Enable "Only show me seats together" if qty >= 2
  // =============================================
  function setSeatsTogetherToggle() {
    const targetQty = settings.quantity || 1;

    if (targetQty <= 1) {
      // No need to enable "seats together" for single ticket
      seatsTogetherSet = true;
      emitLog('info', 'Quantity is 1 — skipping "seats together" toggle');
      return;
    }

    // Find the toggle checkbox
    const toggleCheckbox = document.querySelector('#SeatsTogetherTogglerLabel');
    if (!toggleCheckbox) {
      emitLog('info', '"Only show me seats together" toggle not found, waiting...');
      return;
    }

    // Check if the toggle's parent label is still disabled
    const toggleLabel = document.querySelector('#SeatsTogetherTogglerLabel_label');
    if (toggleLabel && toggleLabel.classList.contains('disabled')) {
      emitLog('info', '"Only show me seats together" toggle is still disabled, waiting for quantity update...');
      return;
    }

    if (toggleCheckbox.checked) {
      seatsTogetherSet = true;
      emitLog('info', '"Only show me seats together" already enabled');
      return;
    }

    // Click the toggle to enable it
    emitLog('action', 'Enabling "Only show me seats together" toggle');
    simulateClick(toggleCheckbox);

    // Also try clicking the label/span in case the checkbox click doesn't work
    const toggleSpan = toggleLabel?.querySelector('.toggle');
    if (toggleSpan) {
      setTimeout(() => {
        if (!toggleCheckbox.checked) {
          simulateClick(toggleSpan);
        }
      }, 300);
    }

    // Check on next iteration
    setTimeout(() => {
      if (toggleCheckbox.checked) {
        seatsTogetherSet = true;
        emitLog('success', '"Only show me seats together" enabled');
      }
    }, 500);
  }

  // =============================================
  // STEP 5: Select the first available area
  // =============================================
  function selectAvailableArea() {
    // Click the firstLine element of the first available area in the CHOOSE BY AREA results
    const areaFirstLines = document.querySelectorAll(
      '.choose-areas-results__body--results__items--item--info--firstLine'
    );

    if (areaFirstLines.length === 0) {
      emitLog('info', 'No area items found (.choose-areas-results__body--results__items--item--info--firstLine), waiting...');
      return;
    }

    // Find the first visible and clickable area
    for (const areaEl of areaFirstLines) {
      if (isVisible(areaEl)) {
        const areaText = (areaEl.textContent || '').trim().substring(0, 80);
        emitLog('action', 'Selecting area: "' + areaText + '"');
        areaSelected = true;
        simulateClick(areaEl);
        return;
      }
    }

    emitLog('info', 'Area items found but none are visible/clickable, waiting...');
  }

  // =============================================
  // STEP 6: Wait for seat card with Match Adult price,
  //         set quantity via quantity-switcher__btn-value, then proceed
  // =============================================
  function waitForSeatCardAndSetQty() {
    const targetQty = settings.quantity || 1;

    // Look for the seat card price element for "Match Adult"
    const priceElements = document.querySelectorAll('.map-seatCard__item--price-total');

    if (priceElements.length === 0) {
      emitLog('info', 'Waiting for seat card (map-seatCard__item--price-total) to appear...');
      return;
    }

    // Find the seat card that contains "Match Adult"
    let matchAdultCard = null;
    for (const priceEl of priceElements) {
      // Walk up to the parent seat card item
      const cardItem = priceEl.closest('[class*="map-seatCard__item"]') ||
                       priceEl.parentElement?.closest('[class*="map-seatCard"]') ||
                       priceEl.parentElement;
      if (!cardItem) continue;

      const cardText = (cardItem.textContent || '').toLowerCase();
      if (cardText.includes('match adult')) {
        matchAdultCard = cardItem;
        break;
      }
    }

    // If no specific "Match Adult" card found, use the first available seat card
    if (!matchAdultCard && priceElements.length > 0) {
      matchAdultCard = priceElements[0].closest('[class*="map-seatCard__item"]') ||
                       priceElements[0].parentElement?.closest('[class*="map-seatCard"]') ||
                       priceElements[0].parentElement;
      emitLog('info', '"Match Adult" not found specifically, using first available seat card');
    }

    if (!matchAdultCard) {
      emitLog('info', 'Seat card container not found, waiting...');
      return;
    }

    emitLog('info', 'Seat card with price detected. Setting quantity...');

    // Find the + button to add Match Adult quantity.
    // The correct selector is .quantity-switcher__btn--add.tickets-quantity_add
    const seatCardContainer = matchAdultCard.closest('[class*="map-seatCard"]') || matchAdultCard;

    // Primary selector: the combined class .quantity-switcher__btn--add.tickets-quantity_add
    const qtyAddBtn = seatCardContainer.querySelector('.quantity-switcher__btn--add.tickets-quantity_add');

    // Fallback selectors if primary not found
    let addButton = qtyAddBtn;
    if (!addButton) {
      addButton = seatCardContainer.querySelector('.tickets-quantity_add') ||
                  seatCardContainer.querySelector('.quantity-switcher__btn--add') ||
                  seatCardContainer.querySelector('[class*="quantity-switcher__btn--add"]');
    }

    // Broader search if not found in immediate container
    if (!addButton) {
      const allQtyBtns = document.querySelectorAll('.quantity-switcher__btn--add.tickets-quantity_add');
      for (const btn of allQtyBtns) {
        const parentCard = btn.closest('[class*="map-seatCard"]');
        if (parentCard) {
          addButton = btn;
          break;
        }
      }
    }

    // Last resort: try any .tickets-quantity_add on the page within a seat card
    if (!addButton) {
      const allAddBtns = document.querySelectorAll('.tickets-quantity_add');
      for (const btn of allAddBtns) {
        const parentCard = btn.closest('[class*="map-seatCard"]');
        if (parentCard) {
          addButton = btn;
          break;
        }
      }
    }

    // Also look for the quantity input within the seat card
    const qtyInput = seatCardContainer.querySelector('.quantity-switcher__value') ||
                     seatCardContainer.querySelector('input[type="text"][aria-label*="Amount"]');

    // Also look for the - button to decrease quantity if needed
    let removeButton = seatCardContainer.querySelector('.quantity-switcher__btn--remove.tickets-quantity_remove');
    if (!removeButton) {
      removeButton = seatCardContainer.querySelector('.tickets-quantity_remove') ||
                     seatCardContainer.querySelector('.quantity-switcher__btn--remove') ||
                     seatCardContainer.querySelector('[class*="quantity-switcher__btn--remove"]');
    }
    // Broader search for remove button
    if (!removeButton) {
      const allRemBtns = document.querySelectorAll('.quantity-switcher__btn--remove.tickets-quantity_remove, .tickets-quantity_remove');
      for (const btn of allRemBtns) {
        const parentCard = btn.closest('[class*="map-seatCard"]');
        if (parentCard) {
          removeButton = btn;
          break;
        }
      }
    }

    if (addButton || removeButton) {
      // Check current quantity
      const nearbyInput = (addButton || removeButton).closest('.quantity-switcher')?.querySelector('.quantity-switcher__value') || qtyInput;
      const currentQty = nearbyInput ? (parseInt(nearbyInput.value, 10) || 0) : 0;

      if (currentQty === targetQty) {
        seatCardQtySet = true;
        emitLog('success', 'Match Adult quantity already at ' + currentQty + '. Proceeding to Add to Basket.');
        return;
      }

      if (currentQty < targetQty && addButton) {
        emitLog('action', 'Clicking + to increase Match Adult quantity (' + currentQty + ' → ' + (currentQty + 1) + ')');
        simulateClick(addButton);
        // Will re-check on next loop iteration until target is reached
        return;
      }

      if (currentQty > targetQty && removeButton) {
        emitLog('action', 'Clicking - to decrease Match Adult quantity (' + currentQty + ' → ' + (currentQty - 1) + ')');
        simulateClick(removeButton);
        // Will re-check on next loop iteration until target is reached
        return;
      }

      // If we have the wrong qty but no appropriate button, try direct input
      if (qtyInput) {
        emitLog('action', 'Setting Match Adult quantity input directly to ' + targetQty);
        simulateInput(qtyInput, String(targetQty));
        setTimeout(() => {
          const newVal = parseInt(qtyInput.value, 10) || 0;
          if (newVal === targetQty) {
            seatCardQtySet = true;
            emitLog('success', 'Match Adult quantity set to ' + newVal + '.');
          }
        }, 500);
        return;
      }

      emitLog('warn', 'Cannot adjust quantity: current=' + currentQty + ', target=' + targetQty + ', missing button');
      return;
    }

    if (qtyInput) {
      const currentQty = parseInt(qtyInput.value, 10) || 0;
      if (currentQty === targetQty) {
        seatCardQtySet = true;
        emitLog('success', 'Match Adult quantity set to ' + currentQty + '. Proceeding to Add to Basket.');
        return;
      }

      // Try setting the value directly
      emitLog('action', 'Setting Match Adult quantity input to ' + targetQty);
      simulateInput(qtyInput, String(targetQty));

      // Verify on next iteration
      setTimeout(() => {
        const newVal = parseInt(qtyInput.value, 10) || 0;
        if (newVal === targetQty) {
          seatCardQtySet = true;
          emitLog('success', 'Match Adult quantity set to ' + newVal + '.');
        }
      }, 500);
      return;
    }

    emitLog('info', 'Quantity controls not found in seat card, waiting...');
  }

  // =============================================
  // STEP 7: Click "Add to Basket"
  // =============================================
  function clickAddToBasket() {
    const addToBasketPatterns = [
      'add to basket',
      'add to cart',
      'add to bag',
      'add tickets',
      'add ticket',
      'add to order'
    ];

    // Search for the Add to Basket button
    const allButtons = document.querySelectorAll('button, a.btn, input[type="submit"], input[type="button"], [role="button"], .btn, .button');
    for (const btn of allButtons) {
      if (!isVisible(btn)) continue;
      const btnText = (btn.textContent || btn.value || '').toLowerCase().trim();
      if (addToBasketPatterns.some(p => btnText.includes(p))) {
        if (!isClickable(btn)) {
          emitLog('warn', '"Add to Basket" button found but not clickable. Waiting...');
          return;
        }
        emitLog('action', 'Clicking "Add to Basket" button: "' + btnText + '"');
        addToBasketClicked = true;
        simulateClick(btn);
        return;
      }
    }

    emitLog('info', '"Add to Basket" button not found yet, waiting...');
  }

  // =============================================
  // STEP 8: Detect basket confirmation
  // =============================================
  function checkForBasketConfirmation() {
    if (taskDone) return;

    const bodyText = (document.body?.innerText || '').toLowerCase();

    // Check for the specific confirmation message
    const confirmationPatterns = [
      'your tickets has been added to basket',
      'your tickets have been added to basket',
      'tickets added to basket',
      'added to basket',
      'added to your basket',
      'added to cart',
      'item added',
      'ticket added',
      'in your basket',
      'proceed to checkout',
      'seat in cart',
      'seats in cart'
    ];

    for (const pattern of confirmationPatterns) {
      if (bodyText.includes(pattern)) {
        emitLog('success', 'Basket confirmation detected: "' + pattern + '"');
        notifyTaskCompleted('Confirmation: "' + pattern + '"');
        return;
      }
    }

    // Check for basket URL navigation
    const url = window.location.href.toLowerCase();
    const basketUrlPatterns = ['/edp/basket', '/edp/checkout', '/basket', '/cart', '/checkout'];
    for (const pattern of basketUrlPatterns) {
      if (url.includes(pattern)) {
        emitLog('success', 'Navigated to basket/checkout page: ' + url);
        notifyTaskCompleted('Navigated to basket/checkout page');
        return;
      }
    }

    // Check for basket count in header
    const basketEl = document.querySelector('[class*="basket-count"], [class*="cart-count"], [hint*="cart"]');
    if (basketEl) {
      const count = parseInt(basketEl.textContent?.trim(), 10);
      if (count > 0) {
        emitLog('success', 'Basket count detected: ' + count);
        notifyTaskCompleted('Basket count: ' + count);
        return;
      }
    }
  }

  // =============================================
  // CONFIRMATION OBSERVER
  // =============================================
  function startConfirmationObserver() {
    confirmationObs = new MutationObserver((mutations) => {
      if (!isMonitoring || taskDone) return;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          const text = (node.textContent || '').toLowerCase();

          // Check for confirmation popup/notification
          if (text.includes('your tickets has been added to basket') ||
              text.includes('your tickets have been added to basket') ||
              text.includes('tickets added to basket') ||
              text.includes('added to basket') ||
              text.includes('added to cart')) {
            emitLog('success', 'Basket confirmation popup detected!');
            notifyTaskCompleted('Basket confirmation popup appeared');
            return;
          }

          // Check for basket count elements appearing
          if (node.matches?.('[class*="basket-count"], [class*="cart-count"]') ||
              node.querySelector?.('[class*="basket-count"], [class*="cart-count"]')) {
            const el = node.matches?.('[class*="basket-count"]') ? node : node.querySelector('[class*="basket-count"]');
            const count = parseInt(el?.textContent?.trim(), 10);
            if (count > 0) {
              emitLog('success', 'Basket element appeared with count: ' + count);
              notifyTaskCompleted('Basket element appeared with count: ' + count);
              return;
            }
          }
        }
      }
    });

    if (document.body) {
      confirmationObs.observe(document.body, { childList: true, subtree: true, characterData: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        confirmationObs.observe(document.body, { childList: true, subtree: true, characterData: true });
      });
    }
  }

  // =============================================
  // TASK COMPLETION
  // =============================================
  function notifyTaskCompleted(detail) {
    if (taskDone) return;
    taskDone = true;
    emitLog('success', 'Task completed: ' + detail);
    emitLog('info', 'Monitoring will now stop automatically');

    // Disconnect MutationObservers to free resources
    if (urlObserver) {
      urlObserver.disconnect();
      urlObserver = null;
      emitLog('info', 'URL observer disconnected');
    }
    if (confirmationObs) {
      confirmationObs.disconnect();
      confirmationObs = null;
      emitLog('info', 'Confirmation observer disconnected');
    }

    window.dispatchEvent(new CustomEvent('tf-task-completed', {
      detail: { message: detail, timestamp: Date.now() }
    }));
  }

})();
