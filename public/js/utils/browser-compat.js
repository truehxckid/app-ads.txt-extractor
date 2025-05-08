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
  
  // Check for ES6 support using safer alternatives to eval
  try {
    // Check class syntax by defining a class in a function
    new Function('class Test {}')();
    
    // Check arrow functions
    new Function('const test = () => {}')();
    
    // Check spread operator
    new Function('let x = {...{}}')();
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
  
  // Check for async/await using safer alternative to eval
  try {
    // Use Function constructor instead of eval
    new Function('async function test() { await Promise.resolve(); }')();
  } catch (e) {
    missingFeatures.push('Async/Await');
  }
  
  // Check for Promise
  if (typeof Promise === 'undefined') {
    missingFeatures.push('Promises');
  }
  
  // Check for Modules - using a safer approach without eval
  // We can check for basic dynamic import support by looking at browser capabilities
  if (typeof import !== 'function' && 
      !(window.chrome || window.safari || window.firefox || window.edge)) {
    // If import is not a function and we're not in a modern browser, 
    // it's likely ES modules are not supported
    missingFeatures.push('ES Modules');
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
  
  // Create container div
  const warningDiv = document.createElement('div');
  warningDiv.className = 'browser-warning';
  
  // Create content container
  const contentDiv = document.createElement('div');
  contentDiv.className = 'browser-warning-content';
  
  // Create heading
  const heading = document.createElement('h3');
  heading.textContent = 'Browser Compatibility Warning';
  
  // Create description paragraph
  const descriptionPara = document.createElement('p');
  descriptionPara.textContent = 'Your browser is missing the following features required by this application:';
  
  // Create feature list
  const featureList = document.createElement('ul');
  missingFeatures.forEach(feature => {
    const listItem = document.createElement('li');
    listItem.textContent = feature;
    featureList.appendChild(listItem);
  });
  
  // Create update message
  const updatePara = document.createElement('p');
  updatePara.textContent = 'Please update your browser or try a different browser for the best experience.';
  
  // Create continue button
  const continueButton = document.createElement('button');
  continueButton.type = 'button';
  continueButton.className = 'warning-close-btn';
  continueButton.textContent = 'Continue Anyway';
  
  // Add event listener to button
  continueButton.addEventListener('click', () => {
    warningDiv.remove();
  });
  
  // Assemble all elements
  contentDiv.appendChild(heading);
  contentDiv.appendChild(descriptionPara);
  contentDiv.appendChild(featureList);
  contentDiv.appendChild(updatePara);
  contentDiv.appendChild(continueButton);
  
  warningDiv.appendChild(contentDiv);
  
  // Add to document
  document.body.appendChild(warningDiv);
}

// Export default object
export default {
  checkBrowserSupport,
  isMobileBrowser,
  getBrowserInfo,
  showBrowserWarning
};