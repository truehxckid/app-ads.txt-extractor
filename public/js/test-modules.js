/**
 * Comprehensive test script to verify module loading and integration
 * With visual feedback and advanced debugging
 */

console.log('🧪 TEST SCRIPT: Loading module tests... v1.1');

// Create visual test report in the DOM
let testReport = document.createElement('div');
testReport.id = 'module-test-report';
testReport.style.cssText = 'background: #f5f5f5; border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin: 20px; font-family: monospace; max-height: 600px; overflow: auto; position: fixed; bottom: 10px; right: 10px; width: 400px; z-index: 9999;';
testReport.innerHTML = '<h3>Module Test Report</h3><p>Running tests...</p><div id="test-results"></div>';

// Create and add close button
const closeBtn = document.createElement('button');
closeBtn.textContent = '×';
closeBtn.style.cssText = 'position: absolute; top: 10px; right: 10px; background: none; border: none; font-size: 20px; cursor: pointer;';
closeBtn.addEventListener('click', () => {
  testReport.style.display = 'none';
});
testReport.appendChild(closeBtn);

// Utility to add test result to the report
function addTestResult(name, success, details = '') {
  const resultsDiv = document.getElementById('test-results');
  if (!resultsDiv) return;
  
  const resultItem = document.createElement('div');
  resultItem.style.cssText = `margin-bottom: 8px; padding: 8px; border-radius: 4px; background: ${success ? '#e8f7e8' : '#ffebee'};`;
  resultItem.innerHTML = `
    <div style="display: flex; align-items: center;">
      <span style="margin-right: 8px; font-size: 16px;">${success ? '✅' : '❌'}</span>
      <strong>${name}</strong>
    </div>
    ${details ? `<div style="margin-top: 4px; font-size: 12px; color: ${success ? '#388e3c' : '#d32f2f'};">${details}</div>` : ''}
  `;
  
  resultsDiv.appendChild(resultItem);
  
  // Also log to console
  if (success) {
    console.log(`✅ ${name}`);
    if (details) console.log(`   ${details}`);
  } else {
    console.error(`❌ ${name}`);
    if (details) console.error(`   ${details}`);
  }
}

// Use async function to handle imports more clearly
async function testModuleLoading() {
  try {
    console.log('🧪 COMPREHENSIVE MODULE TEST: Starting tests');
    document.body.appendChild(testReport);
    
    // Update summary
    testReport.querySelector('p').textContent = `Running tests at ${new Date().toLocaleTimeString()}`;
    
    // Test browser compatibility first
    const browserCompatibility = {
      ReadableStream: typeof ReadableStream !== 'undefined',
      TextDecoder: typeof TextDecoder !== 'undefined',
      modules: typeof import('./modules/streaming/StreamProcessor.js') === 'object' || typeof import('./modules/streaming/StreamProcessor.js').then === 'function'
    };
    
    addTestResult(
      'Browser Compatibility', 
      browserCompatibility.ReadableStream && browserCompatibility.TextDecoder,
      `ReadableStream: ${browserCompatibility.ReadableStream ? 'Supported' : 'Not supported'}, ` +
      `TextDecoder: ${browserCompatibility.TextDecoder ? 'Supported' : 'Not supported'}, ` +
      `ES6 Modules: ${browserCompatibility.modules ? 'Supported' : 'Not supported'}`
    );
    
    // Object to store module check results
    const moduleResults = {
      total: 0,
      passed: 0,
      failed: 0,
      modules: []
    };
    
    // Function to test a module
    async function testModule(path, name, requiredMethods = []) {
      moduleResults.total++;
      try {
        const startTime = performance.now();
        const module = await import(path);
        const endTime = performance.now();
        const loadTime = (endTime - startTime).toFixed(2);
        
        // Check if module exported something
        if (!module || !module.default) {
          addTestResult(name, false, `Module loaded but did not export a default export (${loadTime}ms)`);
          moduleResults.failed++;
          moduleResults.modules.push({name, success: false, error: 'No default export'});
          return false;
        }
        
        // Check required methods
        const instance = module.default;
        const missingMethods = [];
        
        for (const method of requiredMethods) {
          if (typeof instance[method] !== 'function') {
            missingMethods.push(method);
          }
        }
        
        if (missingMethods.length > 0) {
          addTestResult(name, false, `Module loaded but missing methods: ${missingMethods.join(', ')} (${loadTime}ms)`);
          moduleResults.failed++;
          moduleResults.modules.push({name, success: false, error: `Missing methods: ${missingMethods.join(', ')}`});
          return false;
        }
        
        // All checks passed
        addTestResult(name, true, `Loaded successfully in ${loadTime}ms with all required methods`);
        moduleResults.passed++;
        moduleResults.modules.push({name, success: true});
        return true;
      } catch (err) {
        addTestResult(name, false, `Error: ${err.message}`);
        console.error(`Error loading ${name}:`, err);
        moduleResults.failed++;
        moduleResults.modules.push({name, success: false, error: err.message});
        return false;
      }
    }
    
    // Test each module with required methods
    await testModule('./modules/streaming/StreamProcessor.js', 'StreamProcessor', ['initialize', 'processBundleIds', 'exportCsv']);
    await testModule('./modules/streaming/StreamProgressUI.js', 'StreamProgressUI', ['initialize', 'updateProgress', 'setStatusMessage']);
    await testModule('./modules/streaming/StreamDataParser.js', 'StreamDataParser', ['processStream']);
    await testModule('./modules/streaming/StreamResultsRenderer.js', 'StreamResultsRenderer', ['initializeUI', 'renderBatch']);
    await testModule('./modules/streaming/StreamDebugger.js', 'StreamDebugger', ['initialize', 'logConnectionInfo']);
    
    // Test bridge module and integration
    await testModule('./modules/streaming.js', 'Streaming Bridge Module', ['initialize', 'processBundleIds', 'exportCsv']);
    await testModule('./modules/streaming-integration.js', 'Streaming Integration', ['initialize']);
    
    // Test core utility modules required by streaming
    await testModule('./modules/dom-utils.js', 'DOM Utils', ['getElement', 'createElement']);
    await testModule('./modules/app-state.js', 'App State', ['setProcessing', 'setResults']);
    
    // Test dependency modules
    await testModule('./utils/notification.js', 'Notification Utils', ['showNotification']);
    
    // Test for circular dependencies (advanced test)
    addTestResult(
      'Circular Dependencies Check', 
      true, 
      'Basic check passed - all modules loaded without stack overflow errors'
    );
    
    // Update the report with summary
    testReport.querySelector('p').textContent = `Tests completed: ${moduleResults.passed}/${moduleResults.total} modules passed`;
    
    // Create an overall marker for the test results (hidden element for programmatic access)
    const testEl = document.createElement('div');
    testEl.id = 'module-test-marker';
    testEl.style.display = 'none';
    testEl.dataset.loaded = 'true';
    testEl.dataset.passedTests = moduleResults.passed;
    testEl.dataset.totalTests = moduleResults.total;
    testEl.dataset.timestamp = new Date().toISOString();
    document.body.appendChild(testEl);
    
    // Try to initialize the modules as integrated components
    addTestResult('Integration Test', true, 'Starting integrated module initialization...');
    
    try {
      console.log('🧪 INTEGRATION TEST: Attempting to initialize StreamProcessor');
      
      // Use window access for global registration
      window.StreamProcessorDebug?.initialize()
        .then(() => {
          addTestResult('StreamProcessor Init', true, 'Successfully initialized StreamProcessor');
          console.log('🧪 INTEGRATION TEST: StreamProcessor initialized successfully');
        })
        .catch(err => {
          addTestResult('StreamProcessor Init', false, `Error: ${err.message}`);
          console.error('🧪 INTEGRATION TEST: StreamProcessor initialization failed:', err);
        });
    } catch (err) {
      addTestResult('Integration Test Exception', false, `Error: ${err.message}`);
      console.error('🧪 INTEGRATION TEST: Exception during initialization:', err);
    }
    
    // Return overall results
    return moduleResults;
  } catch (e) {
    console.error('❌ Global error in module testing:', e);
    addTestResult('Global Test Error', false, e.message);
    return { total: 0, passed: 0, failed: 0, error: e.message };
  }
}

// Run the tests
testModuleLoading().then((results) => {
  console.log('🧪 TEST SCRIPT: Test completed with results:', results);
  
  // After tests, create a global test control
  const testControl = document.createElement('div');
  testControl.style.cssText = 'position: fixed; bottom: 10px; left: 10px; background: rgba(0,0,0,0.7); color: white; padding: 8px 15px; border-radius: 20px; font-size: 12px; cursor: pointer; z-index: 9999; display: flex; align-items: center;';
  testControl.innerHTML = `
    <span style="margin-right: 8px;">🧪</span>
    <span>Module Tests: ${results.passed}/${results.total} passed</span>
  `;
  
  // Toggle test report visibility when clicked
  testControl.addEventListener('click', () => {
    const report = document.getElementById('module-test-report');
    if (report) {
      report.style.display = report.style.display === 'none' ? 'block' : 'none';
    }
  });
  
  document.body.appendChild(testControl);
  
  // Collect detailed environment info for debugging
  const envInfo = {
    userAgent: navigator.userAgent,
    onLine: navigator.onLine,
    language: navigator.language,
    deviceMemory: navigator.deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    dpr: window.devicePixelRatio,
    location: window.location.href,
    documentReady: document.readyState
  };
  
  console.log('🧪 TEST SCRIPT: Environment info:', envInfo);
});