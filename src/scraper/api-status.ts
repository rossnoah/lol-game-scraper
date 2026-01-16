// Shared API key status across all workers
let apiKeyValid = true;
let apiKeyInvalidSince: Date | null = null;
let checkInterval: ReturnType<typeof setInterval> | null = null;

export function isApiKeyValid(): boolean {
  return apiKeyValid;
}

export function markApiKeyInvalid(): void {
  if (apiKeyValid) {
    apiKeyValid = false;
    apiKeyInvalidSince = new Date();
    console.error(`\n${'='.repeat(60)}`);
    console.error('API KEY INVALID OR EXPIRED');
    console.error('All scrapers are paused.');
    console.error('Please update RIOT_API_KEY and restart the service.');
    console.error('Get a new key from: https://developer.riotgames.com/');
    console.error(`${'='.repeat(60)}\n`);
  }
}

export function markApiKeyValid(): void {
  if (!apiKeyValid) {
    apiKeyValid = true;
    apiKeyInvalidSince = null;
    console.log('API key is now valid. Resuming scrapers...');
  }
}

export function getApiKeyStatus(): { valid: boolean; invalidSince: Date | null } {
  return { valid: apiKeyValid, invalidSince: apiKeyInvalidSince };
}

// Periodically check if key might be valid again (for hot-reload scenarios)
export function startApiKeyHealthCheck(checkFn: () => Promise<boolean>, intervalMs = 60000): void {
  if (checkInterval) {
    clearInterval(checkInterval);
  }

  checkInterval = setInterval(async () => {
    if (!apiKeyValid) {
      console.log('Checking if API key is valid again...');
      const valid = await checkFn();
      if (valid) {
        markApiKeyValid();
      }
    }
  }, intervalMs);
}

export function stopApiKeyHealthCheck(): void {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}
