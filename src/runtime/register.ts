const adminUrl = normalizeUrl(process.env["RESTATE_ADMIN_URL"] ?? "http://127.0.0.1:9070");
const serviceEndpointUrl = normalizeUrl(process.env["MOYE_SERVICE_ENDPOINT_URL"] ?? "http://127.0.0.1:9080");

await registerDeployment({ adminUrl, serviceEndpointUrl });

export async function registerDeployment(options: {
  readonly adminUrl: string;
  readonly serviceEndpointUrl: string;
  readonly attempts?: number;
  readonly retryMs?: number;
}): Promise<void> {
  const attempts = options.attempts ?? 60;
  const retryMs = options.retryMs ?? 500;
  let lastError = "registration not attempted";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(new URL("/deployments", options.adminUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uri: options.serviceEndpointUrl }),
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok || response.status === 409) {
        process.stdout.write(`Moye deployment registered: ${options.serviceEndpointUrl}\n`);
        return;
      }
      lastError = `HTTP ${response.status}: ${(await response.text()).slice(0, 1_000)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, retryMs));
  }
  throw new Error(`Unable to register Moye deployment after ${attempts} attempts: ${lastError}`);
}

function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Unsafe URL protocol: ${url.protocol}`);
  if (url.username || url.password || url.hash) throw new Error("Registration URL cannot contain credentials or fragments");
  return url.toString();
}
