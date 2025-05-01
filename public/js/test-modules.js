/**
 * Simple test script to verify modules are loading
 */

console.log('🧪 TEST SCRIPT: Loading module tests...');

// Use async function to handle imports more clearly
async function testModuleLoading() {
  try {
    console.log('Testing individual modules:');
    
    // Test each module individually
    try {
      const processorModule = await import('./modules/streaming/StreamProcessor.js');
      console.log('✅ StreamProcessor module loaded successfully');
    } catch (err) {
      console.error('❌ Failed to load StreamProcessor module:', err);
    }
    
    try {
      const progressUIModule = await import('./modules/streaming/StreamProgressUI.js');
      console.log('✅ StreamProgressUI module loaded successfully');
    } catch (err) {
      console.error('❌ Failed to load StreamProgressUI module:', err);
    }
    
    try {
      const dataParserModule = await import('./modules/streaming/StreamDataParser.js');
      console.log('✅ StreamDataParser module loaded successfully');
    } catch (err) {
      console.error('❌ Failed to load StreamDataParser module:', err);
    }
    
    try {
      const resultsRendererModule = await import('./modules/streaming/StreamResultsRenderer.js');
      console.log('✅ StreamResultsRenderer module loaded successfully');
    } catch (err) {
      console.error('❌ Failed to load StreamResultsRenderer module:', err);
    }
    
    try {
      const debuggerModule = await import('./modules/streaming/StreamDebugger.js');
      console.log('✅ StreamDebugger module loaded successfully');
    } catch (err) {
      console.error('❌ Failed to load StreamDebugger module:', err);
    }
    
    // Test main streaming module
    console.log('Testing main streaming module:');
    try {
      const streamingModule = await import('./modules/streaming.js');
      console.log('✅ Main streaming module loaded successfully');
      
      // Check if the processor has the expected methods
      const processor = streamingModule.default;
      console.log('Streaming module exports:', Object.keys(processor));
      
      if (typeof processor.processBundleIds === 'function') {
        console.log('✅ processBundleIds method exists');
      } else {
        console.error('❌ processBundleIds method is missing!');
      }
      
      if (typeof processor.initialize === 'function') {
        console.log('✅ initialize method exists');
      } else {
        console.error('❌ initialize method is missing!');
      }
    } catch (err) {
      console.error('❌ Failed to load main streaming module:', err);
    }
    
    // Now try to test the streaming integration
    console.log('Testing streaming integration:');
    try {
      const integrationModule = await import('./modules/streaming-integration.js');
      console.log('✅ streaming-integration.js loaded successfully');
      
      // Check if the integration has the expected methods
      const integration = integrationModule.default;
      console.log('Integration methods:', Object.keys(integration));
      
      if (typeof integration.initialize === 'function') {
        console.log('✅ initialize method exists in integration');
      } else {
        console.error('❌ initialize method is missing in integration!');
      }
    } catch (err) {
      console.error('❌ Failed to load streaming integration:', err);
    }
  } catch (e) {
    console.error('❌ Global error in module testing:', e);
  }
}

// Add test script reference to document
const testEl = document.createElement('div');
testEl.id = 'module-test-marker';
testEl.style.display = 'none';
testEl.dataset.loaded = 'true';
testEl.textContent = 'Module test script executed at ' + new Date().toISOString();
document.body.appendChild(testEl);

// Run the tests
testModuleLoading().then(() => {
  console.log('🧪 TEST SCRIPT: Test completed. Check for module loading results above.');
});