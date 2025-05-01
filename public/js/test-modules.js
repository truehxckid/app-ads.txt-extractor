/**
 * Simple test script to verify modules are loading
 */

console.log('🧪 TEST SCRIPT: Loading module tests...');

// Try to import the modules
try {
  import('./modules/streaming/StreamProcessor.js')
    .then(module => {
      console.log('✅ StreamProcessor module loaded successfully:', module);
    })
    .catch(err => {
      console.error('❌ Failed to load StreamProcessor module:', err);
    });

  import('./modules/streaming/StreamProgressUI.js')
    .then(module => {
      console.log('✅ StreamProgressUI module loaded successfully:', module);
    })
    .catch(err => {
      console.error('❌ Failed to load StreamProgressUI module:', err);
    });

  import('./modules/streaming/StreamDataParser.js')
    .then(module => {
      console.log('✅ StreamDataParser module loaded successfully:', module);
    })
    .catch(err => {
      console.error('❌ Failed to load StreamDataParser module:', err);
    });

  import('./modules/streaming/StreamResultsRenderer.js')
    .then(module => {
      console.log('✅ StreamResultsRenderer module loaded successfully:', module);
    })
    .catch(err => {
      console.error('❌ Failed to load StreamResultsRenderer module:', err);
    });

  import('./modules/streaming/StreamDebugger.js')
    .then(module => {
      console.log('✅ StreamDebugger module loaded successfully:', module);
    })
    .catch(err => {
      console.error('❌ Failed to load StreamDebugger module:', err);
    });

  // Also check if the main streaming.js is loading correctly
  import('./modules/streaming.js')
    .then(module => {
      console.log('✅ Main streaming module loaded successfully:', module);
    })
    .catch(err => {
      console.error('❌ Failed to load main streaming module:', err);
    });
} catch (e) {
  console.error('❌ Global error in module loading:', e);
}

// Add test script reference to document
const testEl = document.createElement('div');
testEl.id = 'module-test-marker';
testEl.style.display = 'none';
testEl.dataset.loaded = 'true';
testEl.textContent = 'Module test script executed at ' + new Date().toISOString();
document.body.appendChild(testEl);

console.log('🧪 TEST SCRIPT: Test completed. Check for module loading results above.');