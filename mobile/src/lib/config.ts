// Where the app talks to. The values are public (the website ships the same ones); see mobile/.env.

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'https://agenticfactor.io').replace(/\/$/, '');
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
