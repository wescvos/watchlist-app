export function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = {
  get tmdbKey() { return getEnv("TMDB_API_KEY"); },
  get omdbKey() { return getEnv("OMDB_API_KEY"); },
  get passcode() { return getEnv("APP_PASSCODE"); },
};
