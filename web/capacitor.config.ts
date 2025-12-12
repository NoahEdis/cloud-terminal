import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.noahedis.cloudterminal',
  appName: 'Cloud Terminal',
  webDir: 'out',
  server: {
    // Load the deployed web app - always up to date
    url: 'https://web-noah-edis-projects.vercel.app',
    cleartext: false,
  },
  ios: {
    // Allow inline media playback
    allowsLinkPreview: true,
    scrollEnabled: true,
    contentInset: 'automatic',
  },
  plugins: {
    // HealthKit will be configured here after adding the plugin
  },
};

export default config;
