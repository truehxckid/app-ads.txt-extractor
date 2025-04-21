/**
 * Theme Manager Utility
 * Handles theme switching and preferences
 */

/**
 * Theme Manager class
 */
class ThemeManager {
  constructor() {
    this.darkMode = false;
    this.themeToggle = null;
    this.themeColorMeta = null;
  }
  
  /**
   * Initialize theme manager
   */
  initialize() {
    // Get theme toggle button
    this.themeToggle = document.getElementById('themeToggle');
    
    // Get theme-color meta tag
    this.themeColorMeta = document.getElementById('theme-color-meta') || 
                        document.querySelector('meta[name="theme-color"]');
    
    // Load saved preference or use system preference
    this.loadThemePreference();
    
    // Apply the current theme
    this.applyTheme(this.darkMode);
    
    // Set button state
    this.updateButtonState();
    
    // Add media query listener for system theme changes
    this.setupMediaQueryListener();
  }
  
  /**
   * Load theme preference from localStorage or system preference
   */
  loadThemePreference() {
    const savedTheme = localStorage.getItem('theme');
    
    if (savedTheme) {
      // Use saved preference
      this.darkMode = savedTheme === 'dark';
    } else {
      // Use system preference
      this.darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
  }
  
  /**
   * Apply theme to document
   * @param {boolean} isDark - Whether to apply dark theme
   */
  applyTheme(isDark) {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    
    // Update theme-color meta tag for browser UI
    if (this.themeColorMeta) {
      this.themeColorMeta.setAttribute(
        'content', 
        isDark ? '#121826' : '#3498db'
      );
    }
    
    this.darkMode = isDark;
  }
  
  /**
   * Update theme toggle button state
   */
  updateButtonState() {
    if (!this.themeToggle) return;
    
    this.themeToggle.setAttribute('aria-pressed', this.darkMode);
    this.themeToggle.setAttribute(
      'aria-label', 
      `Toggle ${this.darkMode ? 'light' : 'dark'} mode`
    );
  }
  
  /**
   * Set up media query listener for system theme changes
   */
  setupMediaQueryListener() {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    // Modern browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', (e) => {
        // Only apply system preference if no saved preference
        if (!localStorage.getItem('theme')) {
          this.darkMode = e.matches;
          this.applyTheme(this.darkMode);
          this.updateButtonState();
        }
      });
    } 
    // Legacy browsers
    else if (mediaQuery.addListener) {
      mediaQuery.addListener((e) => {
        // Only apply system preference if no saved preference
        if (!localStorage.getItem('theme')) {
          this.darkMode = e.matches;
          this.applyTheme(this.darkMode);
          this.updateButtonState();
        }
      });
    }
  }
  
  /**
   * Toggle between light and dark theme
   */
  toggleTheme() {
    this.darkMode = !this.darkMode;
    
    // Apply the new theme
    this.applyTheme(this.darkMode);
    
    // Save preference to localStorage
    localStorage.setItem('theme', this.darkMode ? 'dark' : 'light');
    
    // Update button state
    this.updateButtonState();
    
    return this.darkMode;
  }
  
  /**
   * Get current theme
   * @returns {string} - Current theme name
   */
  getCurrentTheme() {
    return this.darkMode ? 'dark' : 'light';
  }
}

// Export singleton instance
const themeManager = new ThemeManager();
export default themeManager;