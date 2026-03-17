/**
 * Anti-detection measures for Stubby Owl.
 * Injected at document_start in MAIN world to intercept before page scripts run.
 *
 * Comprehensive stealth evasions based on puppeteer-extra-plugin-stealth,
 * adapted for Chrome extension context targeting eticketing.co.uk.
 */

(function () {
  'use strict';

  // =========================================================================
  // UTILITY: Native toString masking
  // All overridden functions must appear native to detection scripts.
  // =========================================================================
  const nativeToString = Function.prototype.toString;
  const overriddenFns = new Map();

  function patchToString(fn, nativeStr) {
    overriddenFns.set(fn, nativeStr);
  }

  const originalToString = Function.prototype.toString;
  Function.prototype.toString = function () {
    if (overriddenFns.has(this)) {
      return overriddenFns.get(this);
    }
    return nativeToString.call(this);
  };
  patchToString(Function.prototype.toString, nativeToString.call(originalToString));

  /**
   * Helper: Define a property on an object and mask its getter toString.
   */
  function definePropertyMasked(obj, prop, getter) {
    const origDesc = Object.getOwnPropertyDescriptor(obj, prop);
    const origGetter = origDesc && origDesc.get;
    Object.defineProperty(obj, prop, {
      get: getter,
      configurable: true,
      enumerable: origDesc ? origDesc.enumerable : true
    });
    if (origGetter) {
      patchToString(getter, nativeToString.call(origGetter));
    }
  }

  /**
   * Helper: Override a method on a prototype and mask its toString.
   */
  function overrideMethod(obj, method, replacement) {
    const original = obj[method];
    obj[method] = replacement;
    if (original) {
      patchToString(replacement, nativeToString.call(original));
    }
    return original;
  }

  // =========================================================================
  // 1. NAVIGATOR.WEBDRIVER — Hide the webdriver flag
  // =========================================================================
  definePropertyMasked(navigator, 'webdriver', () => false);

  // Also delete the property if it exists as own property
  try {
    if ('webdriver' in navigator) {
      delete Object.getPrototypeOf(navigator).webdriver;
    }
  } catch (e) {}

  // =========================================================================
  // 2. NAVIGATOR.PLUGINS — Full PluginArray/Plugin/MimeType emulation
  // =========================================================================
  (function spoofPlugins() {
    const pluginData = [
      {
        name: 'Chrome PDF Plugin',
        description: 'Portable Document Format',
        filename: 'internal-pdf-viewer',
        mimeTypes: [
          { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' }
        ]
      },
      {
        name: 'Chrome PDF Viewer',
        description: '',
        filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
        mimeTypes: [
          { type: 'application/pdf', suffixes: 'pdf', description: '' }
        ]
      },
      {
        name: 'Native Client',
        description: '',
        filename: 'internal-nacl-plugin',
        mimeTypes: [
          { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable' },
          { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client Executable' }
        ]
      }
    ];

    // Build proper MimeType and Plugin objects
    const mimeTypes = [];
    const plugins = [];

    for (const pd of pluginData) {
      const plugin = Object.create(Plugin.prototype);
      Object.defineProperties(plugin, {
        name: { value: pd.name, enumerable: true },
        description: { value: pd.description, enumerable: true },
        filename: { value: pd.filename, enumerable: true },
        length: { value: pd.mimeTypes.length, enumerable: true }
      });

      for (let i = 0; i < pd.mimeTypes.length; i++) {
        const mt = Object.create(MimeType.prototype);
        Object.defineProperties(mt, {
          type: { value: pd.mimeTypes[i].type, enumerable: true },
          suffixes: { value: pd.mimeTypes[i].suffixes, enumerable: true },
          description: { value: pd.mimeTypes[i].description, enumerable: true },
          enabledPlugin: { value: plugin, enumerable: true }
        });
        Object.defineProperty(plugin, i, { value: mt, enumerable: false });
        Object.defineProperty(plugin, pd.mimeTypes[i].type, { value: mt, enumerable: false });
        mimeTypes.push(mt);
      }

      plugins.push(plugin);
    }

    // Create PluginArray-like object
    const pluginArray = Object.create(PluginArray.prototype);
    for (let i = 0; i < plugins.length; i++) {
      Object.defineProperty(pluginArray, i, { value: plugins[i], enumerable: true });
      Object.defineProperty(pluginArray, plugins[i].name, { value: plugins[i], enumerable: false });
    }
    Object.defineProperty(pluginArray, 'length', { value: plugins.length, enumerable: true });

    // Override item() and namedItem()
    pluginArray.item = function (index) { return this[index] || null; };
    pluginArray.namedItem = function (name) { return this[name] || null; };
    pluginArray.refresh = function () {};
    patchToString(pluginArray.item, 'function item() { [native code] }');
    patchToString(pluginArray.namedItem, 'function namedItem() { [native code] }');
    patchToString(pluginArray.refresh, 'function refresh() { [native code] }');

    // Make iterable
    pluginArray[Symbol.iterator] = function* () {
      for (let i = 0; i < this.length; i++) yield this[i];
    };

    definePropertyMasked(navigator, 'plugins', () => pluginArray);

    // MimeTypeArray
    const mimeTypeArray = Object.create(MimeTypeArray.prototype);
    for (let i = 0; i < mimeTypes.length; i++) {
      Object.defineProperty(mimeTypeArray, i, { value: mimeTypes[i], enumerable: true });
      Object.defineProperty(mimeTypeArray, mimeTypes[i].type, { value: mimeTypes[i], enumerable: false });
    }
    Object.defineProperty(mimeTypeArray, 'length', { value: mimeTypes.length, enumerable: true });
    mimeTypeArray.item = function (index) { return this[index] || null; };
    mimeTypeArray.namedItem = function (name) { return this[name] || null; };
    patchToString(mimeTypeArray.item, 'function item() { [native code] }');
    patchToString(mimeTypeArray.namedItem, 'function namedItem() { [native code] }');
    mimeTypeArray[Symbol.iterator] = function* () {
      for (let i = 0; i < this.length; i++) yield this[i];
    };

    definePropertyMasked(navigator, 'mimeTypes', () => mimeTypeArray);
  })();

  // =========================================================================
  // 3. NAVIGATOR.LANGUAGES — Spoof to UK English
  // =========================================================================
  definePropertyMasked(navigator, 'languages', () => Object.freeze(['en-GB', 'en-US', 'en']));
  definePropertyMasked(navigator, 'language', () => 'en-GB');

  // =========================================================================
  // 4. NAVIGATOR.VENDOR — Must be "Google Inc." for Chrome
  // =========================================================================
  definePropertyMasked(navigator, 'vendor', () => 'Google Inc.');

  // =========================================================================
  // 5. NAVIGATOR.HARDWARECONCURRENCY — Realistic value
  // =========================================================================
  definePropertyMasked(navigator, 'hardwareConcurrency', () => 8);

  // =========================================================================
  // 6. NAVIGATOR.DEVICEMEMORY — Realistic value
  // =========================================================================
  if ('deviceMemory' in navigator) {
    definePropertyMasked(navigator, 'deviceMemory', () => 8);
  }

  // =========================================================================
  // 7. NAVIGATOR.PLATFORM — Ensure consistent platform
  // =========================================================================
  definePropertyMasked(navigator, 'platform', () => 'Win32');

  // =========================================================================
  // 8. NAVIGATOR.MAXTOUCHPOINTS — Desktop should be 0
  // =========================================================================
  definePropertyMasked(navigator, 'maxTouchPoints', () => 0);

  // =========================================================================
  // 9. NAVIGATOR.CONNECTION — Spoof network info
  // =========================================================================
  if (navigator.connection) {
    try {
      definePropertyMasked(navigator.connection, 'rtt', () => 50);
      definePropertyMasked(navigator.connection, 'downlink', () => 10);
      definePropertyMasked(navigator.connection, 'effectiveType', () => '4g');
      definePropertyMasked(navigator.connection, 'saveData', () => false);
    } catch (e) {}
  }

  // =========================================================================
  // 10. NAVIGATOR.PERMISSIONS — Fix query behavior
  // =========================================================================
  (function spoofPermissions() {
    const origQuery = window.Permissions?.prototype?.query;
    if (!origQuery) return;

    const permissionStatuses = {
      'notifications': 'prompt',
      'geolocation': 'prompt',
      'camera': 'prompt',
      'microphone': 'prompt',
      'midi': 'granted',
      'persistent-storage': 'prompt',
      'push': 'prompt',
      'background-sync': 'granted',
      'accelerometer': 'granted',
      'gyroscope': 'granted',
      'magnetometer': 'granted',
      'accessibility-events': 'granted',
      'clipboard-read': 'prompt',
      'clipboard-write': 'granted',
      'payment-handler': 'granted'
    };

    const replacement = function (parameters) {
      const name = parameters?.name;
      if (name && permissionStatuses[name] !== undefined) {
        return Promise.resolve(
          Object.create(PermissionStatus.prototype, {
            state: { value: permissionStatuses[name], enumerable: true },
            onchange: { value: null, writable: true, enumerable: true }
          })
        );
      }
      return origQuery.call(this, parameters);
    };

    Permissions.prototype.query = replacement;
    patchToString(replacement, nativeToString.call(origQuery));
  })();

  // =========================================================================
  // 11. CHROME.APP — Emulate chrome.app object
  // =========================================================================
  if (typeof chrome === 'undefined') {
    window.chrome = {};
  }
  if (!chrome.app) {
    chrome.app = {
      isInstalled: false,
      InstallState: {
        DISABLED: 'disabled',
        INSTALLED: 'installed',
        NOT_INSTALLED: 'not_installed'
      },
      RunningState: {
        CANNOT_RUN: 'cannot_run',
        READY_TO_RUN: 'ready_to_run',
        RUNNING: 'running'
      },
      getDetails: function () { return null; },
      getIsInstalled: function () { return false; },
      installState: function (cb) { if (cb) cb('not_installed'); },
      runningState: function () { return 'cannot_run'; }
    };
    patchToString(chrome.app.getDetails, 'function getDetails() { [native code] }');
    patchToString(chrome.app.getIsInstalled, 'function getIsInstalled() { [native code] }');
    patchToString(chrome.app.installState, 'function installState() { [native code] }');
    patchToString(chrome.app.runningState, 'function runningState() { [native code] }');
  }

  // =========================================================================
  // 12. CHROME.CSI — Emulate chrome.csi() function
  // =========================================================================
  if (!chrome.csi) {
    chrome.csi = function () {
      return {
        onloadT: Date.now(),
        startE: Date.now() - Math.floor(Math.random() * 500 + 100),
        pageT: performance.now(),
        tran: 15
      };
    };
    patchToString(chrome.csi, 'function csi() { [native code] }');
  }

  // =========================================================================
  // 13. CHROME.LOADTIMES — Emulate chrome.loadTimes() function
  // =========================================================================
  if (!chrome.loadTimes) {
    chrome.loadTimes = function () {
      const navEntry = performance.getEntriesByType('navigation')[0] || {};
      return {
        commitLoadTime: (navEntry.responseStart || Date.now()) / 1000,
        connectionInfo: 'h2',
        finishDocumentLoadTime: (navEntry.domContentLoadedEventEnd || Date.now()) / 1000,
        finishLoadTime: (navEntry.loadEventEnd || Date.now()) / 1000,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: (navEntry.responseEnd || Date.now()) / 1000,
        navigationType: 'Other',
        npnNegotiatedProtocol: 'h2',
        requestTime: (navEntry.requestStart || Date.now()) / 1000,
        startLoadTime: (navEntry.fetchStart || Date.now()) / 1000,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true
      };
    };
    patchToString(chrome.loadTimes, 'function loadTimes() { [native code] }');
  }

  // =========================================================================
  // 14. CHROME.RUNTIME — Mask extension runtime from page context
  // =========================================================================
  (function maskChromeRuntime() {
    // In MAIN world, chrome.runtime should appear as it does in a normal
    // Chrome browser (exists but has no id, no sendMessage, etc.)
    try {
      if (chrome.runtime && chrome.runtime.id) {
        // Extension runtime is leaking — mask it
        const safeRuntime = {
          connect: undefined,
          sendMessage: undefined,
          id: undefined,
          OnInstalledReason: {
            CHROME_UPDATE: 'chrome_update',
            INSTALL: 'install',
            SHARED_MODULE_UPDATE: 'shared_module_update',
            UPDATE: 'update'
          },
          OnRestartRequiredReason: {
            APP_UPDATE: 'app_update',
            OS_UPDATE: 'os_update',
            PERIODIC: 'periodic'
          },
          PlatformArch: {
            ARM: 'arm',
            ARM64: 'arm64',
            MIPS: 'mips',
            MIPS64: 'mips64',
            X86_32: 'x86-32',
            X86_64: 'x86-64'
          },
          PlatformOs: {
            ANDROID: 'android',
            CROS: 'cros',
            LINUX: 'linux',
            MAC: 'mac',
            OPENBSD: 'openbsd',
            WIN: 'win'
          },
          RequestUpdateCheckStatus: {
            NO_UPDATE: 'no_update',
            THROTTLED: 'throttled',
            UPDATE_AVAILABLE: 'update_available'
          }
        };
        Object.defineProperty(chrome, 'runtime', {
          value: safeRuntime,
          writable: false,
          configurable: false,
          enumerable: true
        });
      }
    } catch (e) {}
  })();

  // =========================================================================
  // 15. AUTOMATION MARKERS — Remove cdc_, __webdriver, and other markers
  // =========================================================================
  (function removeAutomationMarkers() {
    const markers = Object.keys(window).filter(k =>
      /^cdc_/.test(k) ||
      /^__webdriver/.test(k) ||
      /^__driver/.test(k) ||
      /^__selenium/.test(k) ||
      /^__fxdriver/.test(k) ||
      /^_phantom/.test(k) ||
      /^_Recaptcha/.test(k) ||
      /^callPhantom/.test(k) ||
      /^calledSelenium/.test(k) ||
      /^domAutomation/.test(k) ||
      /^domAutomationController/.test(k)
    );
    markers.forEach(prop => {
      try { delete window[prop]; } catch (e) {
        try { Object.defineProperty(window, prop, { value: undefined }); } catch (e2) {}
      }
    });

    // Also remove from document
    const docMarkers = Object.keys(document).filter(k =>
      /^cdc_/.test(k) || /^\$cdc_/.test(k) || /^__webdriver/.test(k)
    );
    docMarkers.forEach(prop => {
      try { delete document[prop]; } catch (e) {}
    });
  })();

  // =========================================================================
  // 16. WEBGL VENDOR/RENDERER — Spoof to common GPU
  // =========================================================================
  (function spoofWebGL() {
    const getParameterOrig = WebGLRenderingContext.prototype.getParameter;
    const getParameter2Orig = WebGL2RenderingContext?.prototype?.getParameter;

    const UNMASKED_VENDOR_WEBGL = 0x9245;
    const UNMASKED_RENDERER_WEBGL = 0x9246;

    function patchedGetParameter(param) {
      if (param === UNMASKED_VENDOR_WEBGL) return 'Google Inc. (NVIDIA)';
      if (param === UNMASKED_RENDERER_WEBGL) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)';
      return getParameterOrig.call(this, param);
    }

    WebGLRenderingContext.prototype.getParameter = patchedGetParameter;
    patchToString(patchedGetParameter, nativeToString.call(getParameterOrig));

    if (getParameter2Orig) {
      function patchedGetParameter2(param) {
        if (param === UNMASKED_VENDOR_WEBGL) return 'Google Inc. (NVIDIA)';
        if (param === UNMASKED_RENDERER_WEBGL) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)';
        return getParameter2Orig.call(this, param);
      }
      WebGL2RenderingContext.prototype.getParameter = patchedGetParameter2;
      patchToString(patchedGetParameter2, nativeToString.call(getParameter2Orig));
    }
  })();

  // =========================================================================
  // 17. CANVAS FINGERPRINT — Add subtle noise to canvas readback
  // =========================================================================
  (function spoofCanvas() {
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;

    // Seed-based noise for consistency within a session
    let noiseSeed = Math.floor(Math.random() * 256);

    function addNoise(imageData) {
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        // Only modify a small percentage of pixels with tiny changes
        if ((i / 4 + noiseSeed) % 47 === 0) {
          data[i] = data[i] ^ 1;     // R
          data[i + 1] = data[i + 1] ^ 1; // G
        }
      }
      return imageData;
    }

    CanvasRenderingContext2D.prototype.getImageData = function () {
      const imageData = origGetImageData.apply(this, arguments);
      // Only add noise to canvases that look like fingerprinting (small size)
      if (this.canvas.width < 400 && this.canvas.height < 400) {
        addNoise(imageData);
      }
      return imageData;
    };
    patchToString(CanvasRenderingContext2D.prototype.getImageData, nativeToString.call(origGetImageData));

    HTMLCanvasElement.prototype.toDataURL = function () {
      // For small canvases (likely fingerprinting), inject noise first
      if (this.width < 400 && this.height < 400) {
        const ctx = this.getContext('2d');
        if (ctx) {
          try {
            const imageData = origGetImageData.call(ctx, 0, 0, this.width, this.height);
            addNoise(imageData);
            ctx.putImageData(imageData, 0, 0);
          } catch (e) {} // May fail due to tainted canvas
        }
      }
      return origToDataURL.apply(this, arguments);
    };
    patchToString(HTMLCanvasElement.prototype.toDataURL, nativeToString.call(origToDataURL));

    HTMLCanvasElement.prototype.toBlob = function () {
      if (this.width < 400 && this.height < 400) {
        const ctx = this.getContext('2d');
        if (ctx) {
          try {
            const imageData = origGetImageData.call(ctx, 0, 0, this.width, this.height);
            addNoise(imageData);
            ctx.putImageData(imageData, 0, 0);
          } catch (e) {}
        }
      }
      return origToBlob.apply(this, arguments);
    };
    patchToString(HTMLCanvasElement.prototype.toBlob, nativeToString.call(origToBlob));
  })();

  // =========================================================================
  // 18. AUDIOCTX FINGERPRINT — Add noise to AudioContext
  // =========================================================================
  (function spoofAudioContext() {
    const origGetFloatFrequencyData = AnalyserNode.prototype.getFloatFrequencyData;
    const origGetByteFrequencyData = AnalyserNode.prototype.getByteFrequencyData;

    AnalyserNode.prototype.getFloatFrequencyData = function (array) {
      origGetFloatFrequencyData.call(this, array);
      for (let i = 0; i < array.length; i += 13) {
        array[i] = array[i] + (Math.random() * 0.0001 - 0.00005);
      }
    };
    patchToString(AnalyserNode.prototype.getFloatFrequencyData, nativeToString.call(origGetFloatFrequencyData));

    AnalyserNode.prototype.getByteFrequencyData = function (array) {
      origGetByteFrequencyData.call(this, array);
      for (let i = 0; i < array.length; i += 17) {
        array[i] = Math.max(0, Math.min(255, array[i] + (Math.random() > 0.5 ? 1 : -1)));
      }
    };
    patchToString(AnalyserNode.prototype.getByteFrequencyData, nativeToString.call(origGetByteFrequencyData));

    // Also spoof createOscillator output for fingerprinting
    const origCreateOscillator = AudioContext.prototype.createOscillator;
    if (origCreateOscillator) {
      AudioContext.prototype.createOscillator = function () {
        const osc = origCreateOscillator.call(this);
        // Slightly randomize default frequency
        try {
          const origFreq = osc.frequency.value;
          osc.frequency.value = origFreq + (Math.random() * 0.01 - 0.005);
        } catch (e) {}
        return osc;
      };
      patchToString(AudioContext.prototype.createOscillator, nativeToString.call(origCreateOscillator));
    }
  })();

  // =========================================================================
  // 19. MEDIA CODECS — Spoof codec support to match real Chrome
  // =========================================================================
  (function spoofMediaCodecs() {
    const origCanPlayType = HTMLMediaElement.prototype.canPlayType;
    const codecResponses = {
      'audio/mpeg': 'probably',
      'audio/mp4': 'probably',
      'audio/mp4; codecs="mp4a.40.2"': 'probably',
      'audio/ogg; codecs="vorbis"': 'probably',
      'audio/ogg; codecs="flac"': 'probably',
      'audio/wav; codecs="1"': 'probably',
      'audio/webm; codecs="vorbis"': 'probably',
      'audio/webm; codecs="opus"': 'probably',
      'video/mp4; codecs="avc1.42E01E"': 'probably',
      'video/mp4; codecs="avc1.42E01E, mp4a.40.2"': 'probably',
      'video/mp4; codecs="avc1.4D401E, mp4a.40.2"': 'probably',
      'video/mp4; codecs="avc1.64001E, mp4a.40.2"': 'probably',
      'video/ogg; codecs="theora"': 'probably',
      'video/webm; codecs="vp8, vorbis"': 'probably',
      'video/webm; codecs="vp9"': 'probably',
      'video/webm; codecs="vp8"': 'probably'
    };

    HTMLMediaElement.prototype.canPlayType = function (type) {
      if (codecResponses[type] !== undefined) return codecResponses[type];
      return origCanPlayType.call(this, type);
    };
    patchToString(HTMLMediaElement.prototype.canPlayType, nativeToString.call(origCanPlayType));
  })();

  // =========================================================================
  // 20. WINDOW DIMENSIONS — Ensure consistent outer/inner dimensions
  // =========================================================================
  (function spoofDimensions() {
    // Only override if values look suspicious (0, or inner === outer exactly)
    const w = window.innerWidth || 1920;
    const h = window.innerHeight || 1080;

    if (window.outerWidth === 0 || window.outerHeight === 0) {
      definePropertyMasked(window, 'outerWidth', () => w + 16);
      definePropertyMasked(window, 'outerHeight', () => h + 88);
    }

    if (window.screen.width === 0) {
      definePropertyMasked(window.screen, 'width', () => 1920);
      definePropertyMasked(window.screen, 'height', () => 1080);
      definePropertyMasked(window.screen, 'availWidth', () => 1920);
      definePropertyMasked(window.screen, 'availHeight', () => 1040);
      definePropertyMasked(window.screen, 'colorDepth', () => 24);
      definePropertyMasked(window.screen, 'pixelDepth', () => 24);
    }

    // Ensure devicePixelRatio is set
    if (!window.devicePixelRatio || window.devicePixelRatio === 0) {
      definePropertyMasked(window, 'devicePixelRatio', () => 1);
    }
  })();

  // =========================================================================
  // 21. IFRAME CONTENTWINDOW — Fix cross-origin iframe detection
  // =========================================================================
  (function fixIframeContentWindow() {
    // Ensure iframes created dynamically have consistent properties
    const origHTMLIFrameElement = Object.getOwnPropertyDescriptor(
      HTMLIFrameElement.prototype, 'contentWindow'
    );

    if (origHTMLIFrameElement && origHTMLIFrameElement.get) {
      const origGet = origHTMLIFrameElement.get;
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        get: function () {
          const win = origGet.call(this);
          if (win) {
            try {
              // Ensure the iframe's navigator.webdriver is also false
              if (Object.getOwnPropertyDescriptor(win.navigator, 'webdriver')) {
                Object.defineProperty(win.navigator, 'webdriver', {
                  get: () => false,
                  configurable: true
                });
              }
            } catch (e) {} // Cross-origin will throw
          }
          return win;
        },
        configurable: true
      });
      patchToString(
        Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow').get,
        nativeToString.call(origGet)
      );
    }
  })();

  // =========================================================================
  // 22. PERFORMANCE ENTRIES — Hide extension resources
  // =========================================================================
  (function hideExtensionResources() {
    const origGetEntries = Performance.prototype.getEntries;
    const origGetEntriesByType = Performance.prototype.getEntriesByType;
    const origGetEntriesByName = Performance.prototype.getEntriesByName;

    function filterEntries(entries) {
      return entries.filter(e =>
        !e.name.includes('chrome-extension://') &&
        !e.name.includes('moz-extension://') &&
        !e.name.includes('safari-extension://')
      );
    }

    Performance.prototype.getEntries = function () {
      return filterEntries(origGetEntries.call(this));
    };
    patchToString(Performance.prototype.getEntries, nativeToString.call(origGetEntries));

    Performance.prototype.getEntriesByType = function (type) {
      const entries = origGetEntriesByType.call(this, type);
      if (type === 'resource') return filterEntries(entries);
      return entries;
    };
    patchToString(Performance.prototype.getEntriesByType, nativeToString.call(origGetEntriesByType));

    Performance.prototype.getEntriesByName = function (name, type) {
      if (name && (name.includes('chrome-extension://') || name.includes('moz-extension://'))) {
        return [];
      }
      return origGetEntriesByName.call(this, name, type);
    };
    patchToString(Performance.prototype.getEntriesByName, nativeToString.call(origGetEntriesByName));
  })();

  // =========================================================================
  // 23. WEBRTC LEAK PREVENTION — Prevent local IP leak via WebRTC
  // =========================================================================
  (function preventWebRTCLeak() {
    // Override RTCPeerConnection to prevent IP leaking
    const origRTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (!origRTCPeerConnection) return;

    const origCreateDataChannel = origRTCPeerConnection.prototype.createDataChannel;
    const origCreateOffer = origRTCPeerConnection.prototype.createOffer;

    // Wrap createOffer to filter out local IPs from SDP
    origRTCPeerConnection.prototype.createOffer = function () {
      return origCreateOffer.apply(this, arguments).then(offer => {
        if (offer && offer.sdp) {
          // Replace local/private IPs in SDP
          offer.sdp = offer.sdp.replace(
            /([0-9]{1,3}\.){3}[0-9]{1,3}/g,
            (match) => {
              // Keep public-looking IPs, mask private ones
              if (match.startsWith('10.') || match.startsWith('192.168.') ||
                  match.startsWith('172.16.') || match.startsWith('172.17.') ||
                  match.startsWith('172.18.') || match.startsWith('172.19.') ||
                  match.startsWith('172.2') || match.startsWith('172.3') ||
                  match.startsWith('127.') || match.startsWith('0.')) {
                return '0.0.0.0';
              }
              return match;
            }
          );
        }
        return offer;
      });
    };
    patchToString(origRTCPeerConnection.prototype.createOffer, nativeToString.call(origCreateOffer));
  })();

  // =========================================================================
  // 24. DATE/TIMEZONE — Ensure consistent timezone
  // =========================================================================
  (function spoofTimezone() {
    // Spoof to Europe/London (GMT/BST) for UK ticketing
    const origDateTimeFormat = Intl.DateTimeFormat;
    const origResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;

    Intl.DateTimeFormat.prototype.resolvedOptions = function () {
      const opts = origResolvedOptions.call(this);
      opts.timeZone = opts.timeZone || 'Europe/London';
      return opts;
    };
    patchToString(Intl.DateTimeFormat.prototype.resolvedOptions, nativeToString.call(origResolvedOptions));

    // Also override Date.prototype.toString and toTimeString to reflect Europe/London
    const origDateToString = Date.prototype.toString;
    const origDateToTimeString = Date.prototype.toTimeString;

    // Helper: format a Date as if in Europe/London timezone
    function formatDateInLondon(date) {
      // Use Intl to get the correct offset for Europe/London at this date
      const formatter = new origDateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        year: 'numeric', month: 'short', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false, weekday: 'short'
      });
      const parts = {};
      formatter.formatToParts(date).forEach(p => { parts[p.type] = p.value; });

      // Determine if BST (UTC+1) or GMT (UTC+0) by checking the hour difference
      const utcHour = date.getUTCHours();
      const londonHour = parseInt(parts.hour, 10);
      const isBST = ((londonHour - utcHour + 24) % 24) === 1;
      const offsetStr = isBST ? '+0100' : '+0000';
      const tzName = isBST ? 'British Summer Time' : 'Greenwich Mean Time';

      return { parts, offsetStr, tzName, isBST };
    }

    Date.prototype.toString = function () {
      try {
        const { parts, offsetStr, tzName } = formatDateInLondon(this);
        // Format: "Wed Mar 17 2026 14:30:00 GMT+0000 (Greenwich Mean Time)"
        const dayNames = { Mon: 'Mon', Tue: 'Tue', Wed: 'Wed', Thu: 'Thu', Fri: 'Fri', Sat: 'Sat', Sun: 'Sun' };
        const wd = dayNames[parts.weekday] || parts.weekday;
        return `${wd} ${parts.month} ${parts.day} ${parts.year} ${parts.hour}:${parts.minute}:${parts.second} GMT${offsetStr} (${tzName})`;
      } catch (e) {
        return origDateToString.call(this);
      }
    };
    patchToString(Date.prototype.toString, nativeToString.call(origDateToString));

    Date.prototype.toTimeString = function () {
      try {
        const { parts, offsetStr, tzName } = formatDateInLondon(this);
        // Format: "14:30:00 GMT+0000 (Greenwich Mean Time)"
        return `${parts.hour}:${parts.minute}:${parts.second} GMT${offsetStr} (${tzName})`;
      } catch (e) {
        return origDateToTimeString.call(this);
      }
    };
    patchToString(Date.prototype.toTimeString, nativeToString.call(origDateToTimeString));

    // Also override getTimezoneOffset to return 0 (GMT) or -60 (BST)
    const origGetTimezoneOffset = Date.prototype.getTimezoneOffset;
    Date.prototype.getTimezoneOffset = function () {
      try {
        const { isBST } = formatDateInLondon(this);
        return isBST ? -60 : 0;
      } catch (e) {
        return origGetTimezoneOffset.call(this);
      }
    };
    patchToString(Date.prototype.getTimezoneOffset, nativeToString.call(origGetTimezoneOffset));
  })();

  // =========================================================================
  // 25. CONSOLE.DEBUG — Prevent console.debug-based detection
  // =========================================================================
  (function fixConsoleDebug() {
    // Some detection scripts override console.debug to detect DevTools
    const origDebug = console.debug;
    if (origDebug) {
      console.debug = function () {
        return origDebug.apply(this, arguments);
      };
      // Make it look native
      Object.defineProperty(console.debug, 'name', { value: 'debug' });
    }
  })();

  // =========================================================================
  // 26. ERROR STACK TRACES — Clean up stack traces from extension paths
  // =========================================================================
  (function cleanStackTraces() {
    const origPrepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = function (error, structuredStackTrace) {
      // Filter out extension frames from stack traces
      const filtered = structuredStackTrace.filter(frame => {
        const fileName = frame.getFileName() || '';
        return !fileName.includes('chrome-extension://') &&
               !fileName.includes('moz-extension://');
      });
      if (origPrepareStackTrace) {
        return origPrepareStackTrace(error, filtered);
      }
      return error.toString() + '\n' + filtered.map(f =>
        '    at ' + f.toString()
      ).join('\n');
    };
  })();

  // =========================================================================
  // 27. DOCUMENT PROPERTIES — Hide automation indicators
  // =========================================================================
  (function hideDocumentIndicators() {
    // Ensure document.$cdc_ and similar don't exist
    const docKeys = Object.keys(document).filter(k =>
      k.startsWith('$cdc_') || k.startsWith('$chrome_') || k.startsWith('__')
    );
    docKeys.forEach(k => {
      try { delete document[k]; } catch (e) {}
    });

    // Ensure document.hidden and visibilityState are normal
    try {
      definePropertyMasked(document, 'hidden', () => false);
      definePropertyMasked(document, 'visibilityState', () => 'visible');
    } catch (e) {}
  })();

  // =========================================================================
  // 28. NOTIFICATION API — Ensure Notification constructor exists
  // =========================================================================
  if (typeof Notification === 'undefined') {
    window.Notification = function () {};
    Notification.permission = 'default';
    Notification.requestPermission = function () {
      return Promise.resolve('default');
    };
  }

  // =========================================================================
  // 29. BATTERY API — Spoof realistic battery status
  // =========================================================================
  if (navigator.getBattery) {
    const origGetBattery = navigator.getBattery;
    navigator.getBattery = function () {
      return Promise.resolve({
        charging: true,
        chargingTime: 0,
        dischargingTime: Infinity,
        level: 0.97,
        addEventListener: function () {},
        removeEventListener: function () {},
        dispatchEvent: function () { return true; },
        onchargingchange: null,
        onchargingtimechange: null,
        ondischargingtimechange: null,
        onlevelchange: null
      });
    };
    patchToString(navigator.getBattery, nativeToString.call(origGetBattery));
  }

  // =========================================================================
  // 30. SOURCEURL CLEANUP — Prevent detection via sourceURL in injected scripts
  // =========================================================================
  // This is handled by the extension's injection mechanism, but we ensure
  // no sourceURL or sourceMappingURL comments leak into the page context.

  // =========================================================================
  // 31. MUTATION OBSERVER PROTECTION — Prevent detection of injected elements
  // =========================================================================
  (function protectMutationObserver() {
    const origObserve = MutationObserver.prototype.observe;
    // We don't override MutationObserver itself, but ensure our injected
    // elements don't have detectable attributes
  })();

  // =========================================================================
  // 32. HEADLESS DETECTION COUNTERMEASURES
  // =========================================================================
  (function antiHeadlessDetection() {
    // Ensure chrome.runtime exists (non-extension version)
    if (!window.chrome) window.chrome = {};

    // Ensure window.chrome exists with expected properties
    if (!chrome.runtime) {
      chrome.runtime = {};
    }

    // Spoof Brave detection
    if (navigator.brave) {
      delete navigator.brave;
    }

    // Ensure speechSynthesis exists (missing in some headless modes)
    if (!window.speechSynthesis) {
      window.speechSynthesis = {
        getVoices: function () { return []; },
        speak: function () {},
        cancel: function () {},
        pause: function () {},
        resume: function () {},
        pending: false,
        speaking: false,
        paused: false,
        onvoiceschanged: null,
        addEventListener: function () {},
        removeEventListener: function () {},
        dispatchEvent: function () { return true; }
      };
    }
  })();

})();
