export interface SendReceipt {
  readonly invocationId: string;
  readonly status?: string;
}

export class IngressError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Restate ingress returned ${status}: ${body}`);
    this.name = "IngressError";
    this.status = status;
    this.body = body;
  }
}

export async function invoke<TResponse>(
  ingressUrl: string,
  service: string,
  key: string,
  handler: string,
  input?: unknown,
): Promise<TResponse> {
  return request<TResponse>(
    ingressUrl,
    service,
    key,
    handler,
    input,
    false,
  );
}

export async function send(
  ingressUrl: string,
  service: string,
  key: string,
  handler: string,
  input: unknown,
): Promise<SendReceipt> {
  return request<SendReceipt>(
    ingressUrl,
    service,
    key,
    handler,
    input,
    true,
  );
}

async function request<TResponse>(
  ingressUrl: string,
  service: string,
  key: string,
  handler: string,
  input: unknown,
  oneWay: boolean,
): Promise<TResponse> {
  const suffix = oneWay ? "/send" : "";
  const url = `${ingressUrl.replace(/\/$/, "")}/${encodeURIComponent(service)}/${encodeURIComponent(key)}/${encodeURIComponent(handler)}${suffix}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input ?? null),
  });
  const body = await response.text();
  if (!response.ok) throw new IngressError(response.status, body);
  if (!body) return undefined as TResponse;
  return JSON.parse(body) as TResponse;
}
