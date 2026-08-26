export interface RestateDeploymentSummaryV1 {
  readonly id: string;
  readonly uri: string;
  readonly services: readonly { readonly name: string; readonly revision: number }[];
}

export async function latestRestateServiceEndpoint(
  adminUrl: string,
  serviceName: string,
): Promise<string | undefined> {
  const response = await fetch(`${adminUrl.replace(/\/$/u, "")}/deployments`);
  if (!response.ok) throw new Error(`Restate deployment discovery failed: ${response.status} ${await response.text()}`);
  const body = await response.json() as { deployments?: readonly RestateDeploymentSummaryV1[] } | readonly RestateDeploymentSummaryV1[];
  const deployments = Array.isArray(body)
    ? body as readonly RestateDeploymentSummaryV1[]
    : (body as { deployments?: readonly RestateDeploymentSummaryV1[] }).deployments ?? [];
  return selectLatestRestateServiceEndpoint(deployments, serviceName);
}

export function selectLatestRestateServiceEndpoint(
  deployments: readonly RestateDeploymentSummaryV1[],
  serviceName: string,
): string | undefined {
  return deployments
    .flatMap((deployment) => deployment.services
      .filter((service) => service.name === serviceName)
      .map((service) => ({ uri: deployment.uri, revision: service.revision })))
    .sort((left, right) => right.revision - left.revision)[0]?.uri;
}

/**
 * Keeps the acceptance revision but moves its endpoint back to the still-running
 * predecessor before the temporary process exits. Existing invocations retain
 * their revision while new invocations no longer target a dead endpoint.
 */
export async function handoffRestateDeployment(
  adminUrl: string,
  deploymentId: string,
  replacementEndpoint: string,
): Promise<void> {
  const response = await fetch(`${adminUrl.replace(/\/$/u, "")}/deployments/${encodeURIComponent(deploymentId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uri: replacementEndpoint }),
  });
  if (!response.ok) throw new Error(`Restate deployment handoff failed: ${response.status} ${await response.text()}`);
}
