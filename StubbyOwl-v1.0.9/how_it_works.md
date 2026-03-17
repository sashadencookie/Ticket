# Stubby Owl v1.0.1: How It Works

This document provides a detailed explanation of the Stubby Owl browser extension, its architecture, and its operational flow. It is intended for developers and users who want to understand the extension's inner workings.

## 1. Architecture Overview

The extension is composed of several key components that work together to monitor ticket availability and automate the purchasing process. It uses a combination of a background service worker, content scripts, and a user interface (popup) to achieve its goals.

| Component | File(s) | Purpose |
|---|---|---|
| **Manifest** | `manifest.json` | Defines the extension's metadata, permissions, and script injection rules. |
| **Service Worker** | `src/background.js` | Manages the extension's state, alarms, and logging. |
| **Popup UI** | `src/popup/popup.html`, `popup.js`, `popup.css` | Provides the user interface for configuring and controlling the extension. |
| **Content Scripts** | `src/content/anti-detect.js`, `celtic.js`, `bridge.js` | Injected into the target website to interact with the page and bypass bot detection. |

## 2. Process Flow

The extension follows a clear, step-by-step process to find and secure tickets. This process is initiated by the user through the popup interface and is carried out by the content scripts and service worker.

### 2.1. User Configuration

1.  The user opens the extension popup and navigates to the **Event** tab.
2.  They enter the **Event URL** for the desired Celtic FC match on `eticketing.co.uk/celtic/`.
3.  They select the desired **Quantity** of tickets.
4.  Optionally, they can set a **Min Price** and **Max Price**.
5.  The user clicks **Save Settings**, which stores the configuration in `chrome.storage.local`.

### 2.2. Monitoring Initiation

1.  The user clicks **Start Monitoring**.
2.  The `popup.js` script sends a `startMonitoring` message to the `background.js` service worker.
3.  The service worker sets the `isMonitoring` state to `true` and creates a new tab with the specified Event URL.
4.  A randomized refresh alarm is set to trigger periodically as a backup refresh mechanism.

### 2.3. Page Interaction and Automation (`celtic.js`)

Once the event page is loaded, the `celtic.js` content script, running in the `MAIN` world, begins its automated process. It executes a series of steps in a loop every 1.5 seconds:

1.  **Dismiss Error Modals**: The script first scans for any error popups (e.g., "sold out," "session expired") and automatically clicks the "OK" or "Close" button to dismiss them.

2.  **Set Ticket Quantity**: It locates the quantity input field on the page and sets it to the user-configured value.

3.  **Find and Click "Choose Seats for Me"**: The script looks for a button or link with text like "Choose seats for me" or "Best available." If found and clickable, it simulates a human-like click to proceed.

4.  **Auto-Select Available Seats**: After the seat map loads, the script performs two checks:
    *   It first looks for seats that the system may have already pre-selected.
    *   If none are pre-selected, it finds the first available seat that is not marked as sold, unavailable, or restricted, and clicks it.
    *   Once a seat is selected, it dispatches a `tf-stop-refresh` event to the `bridge.js` script to halt the auto-refresh timer.

5.  **Add to Basket**: With a seat selected, the script searches for an "Add to Basket," "Select," or "Confirm" button and clicks it.

6.  **Detect Task Completion**: The script continuously monitors the page for signs that the tickets have been successfully added to the basket. It looks for:
    *   A change in the basket icon's item count.
    *   Text on the page like "added to basket" or "seat in cart."
    *   Navigation to a URL containing `/Basket` or `/Checkout`.

### 2.4. Communication and State Management

The different parts of the extension communicate through a well-defined system of messages and events:

*   **`popup.js` ↔ `background.js`**: The popup sends messages (`startMonitoring`, `stopMonitoring`) to the service worker to control the main state.
*   **`background.js` → `bridge.js`**: The service worker can send messages (`refreshPage`) to the content script as a backup.
*   **`celtic.js` (MAIN world) ↔ `bridge.js` (ISOLATED world)**: These two content scripts communicate via `window.dispatchEvent` and `window.addEventListener`. `celtic.js` sends events like `tf-log`, `tf-stop-refresh`, and `tf-task-completed`. `bridge.js` listens for these and relays them to the service worker. `bridge.js` also relays monitoring state and settings from the service worker down to `celtic.js`.

### 2.5. Anti-Bot Detection (`anti-detect.js`)

This is the most critical component for ensuring the extension can operate without being blocked. It is injected at `document_start` into the `MAIN` world, allowing it to modify the browser environment *before* the website's own scripts can run.

It implements over 30 different evasion techniques, including:

*   **Hiding `navigator.webdriver`**: Makes the browser appear as if it is not under automated control.
*   **Spoofing Plugins and MimeTypes**: Emulates a standard Chrome plugin/MimeType profile.
*   **Randomizing Fingerprints**: Adds subtle noise to Canvas and AudioContext readouts to prevent fingerprint-based tracking.
*   **Masking `chrome.runtime`**: Prevents the page from detecting the presence of the extension.
*   **Cleaning Stack Traces**: Removes any mention of `chrome-extension://` from error stack traces.
*   **Spoofing Browser Properties**: Sets properties like `navigator.vendor`, `hardwareConcurrency`, and WebGL renderer to appear as a normal user's browser.

## 3. Refresh Mechanism

To avoid detection, the extension employs a randomized refresh interval. The primary refresh logic is in `bridge.js`:

1.  Instead of a fixed `setInterval`, it uses a recursive `setTimeout`.
2.  Before each refresh, it randomly selects a delay from the array `[10.7, 16.5, 13.5, 17.3]` seconds.
3.  This creates an unpredictable, human-like refresh pattern.
4.  The `background.js` service worker also uses this randomized interval for its backup alarm, ensuring consistency.

This comprehensive, multi-layered approach allows Stubby Owl to effectively and reliably automate the ticket purchasing process while remaining undetected.
