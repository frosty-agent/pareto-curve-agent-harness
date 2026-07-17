export async function retry(operation, { attempts = 3, delay = () => Promise.resolve() } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(attempt);
    }
  }
  throw lastError;
}
