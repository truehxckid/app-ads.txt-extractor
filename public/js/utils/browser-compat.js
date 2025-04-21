/**
 * Browser Compatibility Utility
 * Checks for browser features needed by the application
 */

/**
 * Check for browser support of required features
 * @returns {string[]} - Array of unsupported features
 */
export function checkBrowserSupport() {
  const missingFeatures = [];
  
  // Check for ES6 support
  try {
    eval('class Test {}');
    eval('const test = () => {}');
    eval('let x = {...{}}');
  } catch (e) {
    missingFeatures.push('ES6 Features');
  }
  
  // Check for fetch API
  if (!window.fetch) {
    missingFeatures.push('Fetch API');
  }
  
  // Check for essential DOM API features
  if (!window.DOMParser || !document.querySelector) {
    missingFeatures.push('Modern DOM API');
  }
  
  // Check for async/await
  try {
    eval('async function test() { await Promise.resolve(); }');
  } catch (e) {
    missingFeatures.push('Async/Await');
  }
  
  // Check for Promise
  if (typeof Promise === 'undefined') {
    missingFeatures.push('Promises');
  }
  
  // Check for Modules
  try {
    eval('import("data:text/javascript;base64,Cg==")');
  } catch (e) {
    // ES modules syntax error is okay (means syntax is supported)
    if (!(e instanceof SyntaxError)) {
      missingFeatures.push('ES Modules');
    }
  }
  
  // Check for required Web APIs
  const webAPIs = [
    ['Clipboard', () => navigator.clipboard],
    ['URL', () => window.URL],
    ['Blob', () => window.Blob],
    ['LocalStorage', () => window.localStorage]
  ];
  
  webAPIs.forEach(([name, check]) => {
    try {
      if (!check()) {
        missingFeatures.push(name);
      }
    } catch (e) {
      missingFeatures.push(name);
    }
  });
  
  return missingFeatures;
}

/**
 * Check if browser is mobile
 * @returns {boolean} - True if mobile browser
 */
export function isMobileBrowser() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * Get browser information
 * @returns {Object} - Browser information
 */
export function getBrowserInfo() {
  const ua = navigator.userAgent;
  let browserName = "Unknown";
  let browserVersion = "Unknown";
  
  // Extract browser information
  if (ua.indexOf("Firefox") > -1) {
    browserName = "Firefox";
    browserVersion = ua.match(/Firefox\/([0-9.]+)/)[1];
  } else if (ua.indexOf("Edge") > -1 || ua.indexOf("Edg/") > -1) {
    browserName = "Edge";
    browserVersion = ua.indexOf("Edge") > -1 
      ? ua.match(/Edge\/([0-9.]+)/)[1] 
      : ua.match(/Edg\/([0-9.]+)/)[1];
  } else if (ua.indexOf("Chrome") > -1) {
    browserName = "Chrome";
    browserVersion = ua.match(/Chrome\/([0-9.]+)/)[1];
  } else if (ua.indexOf("Safari") > -1) {
    browserName = "Safari";
    browserVersion = ua.match(/Version\/([0-9.]+)/)?.[1] || "Unknown";
  } else if (ua.indexOf("MSIE") > -1 || ua.indexOf("Trident") > -1) {
    browserName = "Internet Explorer";
    browserVersion = ua.indexOf("MSIE") > -1 
      ? ua.match(/MSIE ([0-9.]+)/)[1] 
      : "11.0";
  }
  
  return {
    name: browserName,
    version: browserVersion,
    userAgent: ua,
    isMobile: isMobileBrowser(),
    language: navigator.language || navigator.userLanguage,
    platform: navigator.platform
  };
}

/**
 * Show unsupported browser warning if needed
 * @param {string[]} missingFeatures - Array of missing features
 */
export function showBrowserWarning(missingFeatures) {
  if (missingFeatures.length === 0) return;
  
  const warningDiv = document.createElement('div');
  warningDiv.className = 'browser-warning';
  warningDiv.innerHTML = `
    <div class="browser-warning-content">
      <h3>Browser Compatibility Warning</h3>
      <p>Your browser is missing the following features required by this application:</p>
      <ul>
        ${missingFeatures.map(feature => `<li>${feature}</li>`).join('')}
      </ul>
      <p>Please update your browser or try a different browser for the best experience.</p>
      <button type="button" class="warning-close-btn">Continue Anyway</button>
    </div>
  `;
  
  document.body.appendChild(warningDiv);
  
  // Add close button handler
  const closeButton = warningDiv.querySelector('.warning-close-btn');
  if (closeButton) {
    closeButton.addEventListener('click', () => {
      warningDiv.remove();
    });
  }
}

// Export default object
export default {
  checkBrowserSupport,
  isMobileBrowser,
  getBrowserInfo,
  showBrowserWarning
};