export const env = {
  apiUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api',
  caregiverPin: import.meta.env.VITE_CAREGIVER_PIN ?? '1234',
} as const;
