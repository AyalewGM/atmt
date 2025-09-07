// Centralized constants and environment wiring

// BRAND & APP INFO
export const BRAND_INFO = {
  name: "Ancient Truths, Modern Times (ATMT)",
  usp: "The only blog focusing specifically on Ethiopian Orthodox Tewahedo theology with a modern, accessible format rooted in authentic tradition. Bridging ancient truths with modern times.",
  audience: "18–45 year old diaspora (U.S., Canada, UK, Ethiopia), students, young professionals, seekers. Spiritually curious, disillusioned with secular culture, seeking depth and authenticity.",
  tone: "Respectful, reverent, clear, compassionate, educational, authentic, and accessible (Grade 6-8 readability but theologically deep).",
};

// API key management
const USER_API_KEY = "YOUR_API_KEY_HERE";
export const API_KEY = USER_API_KEY !== "YOUR_API_KEY_HERE" ? USER_API_KEY : "";

// Firebase config (injected or fallback)
// eslint-disable-next-line no-undef
export const firebaseConfig = typeof __firebase_config !== 'undefined'
  // eslint-disable-next-line no-undef
  ? JSON.parse(__firebase_config)
  : { apiKey: "your-api-key", authDomain: "your-auth-domain", projectId: "your-project-id" };

// App ID (injected or fallback)
// eslint-disable-next-line no-undef
export const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// Optional global html2pdf binding (for browser only)
export const html2pdf = (typeof window !== 'undefined' && window.html2pdf) || null;

