import { useMemo } from "react";
import {
  keepPreviousData,
  replaceEqualDeep,
  skipToken,
  useQuery,
} from "@tanstack/react-query";
import type { Host } from "@bb/domain";
import type {
  HostDirectoryListing,
  HostDiscoveredReposResponse,
} from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { useHostListRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import {
  hostCloneDefaultPathQueryKey,
  hostDirectoryQueryKey,
  hostDiscoveredReposQueryKey,
  hostsQueryKey,
} from "./query-keys";
import type { QueryOptions } from "./query-helpers";

export function useHosts(
  options?: QueryOptions & { includeCreating?: boolean },
) {
  const enabled = options?.enabled ?? true;
  const includeCreating = options?.includeCreating ?? false;
  useHostListRealtimeSubscription({ enabled });

  return useQuery<Host[]>({
    queryKey: hostsQueryKey(includeCreating),
    queryFn: async ({ client, queryKey, signal }) =>
      keepHostsChangedOnlyByHeartbeat(
        client.getQueryData<Host[]>(queryKey),
        await sdk.hosts.list({ signal, includeCreating }),
      ),
    enabled,
    staleTime: 60_000,
  });
}

function changedOnlyByHeartbeat(previous: Host, next: Host): boolean {
  if (previous.status !== "connected" || next.status !== "connected") {
    return false;
  }
  const previousWithNextHeartbeat: Host = {
    ...previous,
    lastSeenAt: next.lastSeenAt,
    updatedAt: next.updatedAt,
  };
  return (
    replaceEqualDeep(previousWithNextHeartbeat, next) ===
    previousWithNextHeartbeat
  );
}

export function keepHostsChangedOnlyByHeartbeat(
  previous: readonly Host[] | undefined,
  next: Host[],
): Host[] {
  if (previous === undefined) return next;
  const previousById = new Map(previous.map((host) => [host.id, host]));
  return next.map((host) => {
    const known = previousById.get(host.id);
    return known !== undefined && changedOnlyByHeartbeat(known, host)
      ? known
      : host;
  });
}

export type HostScope = "persistent" | "all";

export function selectHosts(
  hosts: readonly Host[] | undefined,
  scope: HostScope,
): Host[] {
  const everyHost = hosts ? [...hosts] : [];
  return scope === "all"
    ? everyHost
    : everyHost.filter((host) => host.type !== "ephemeral");
}

export function selectPrimaryHost(
  hosts: readonly Host[] | undefined,
  primaryHostId: string | null,
): Host | null {
  const availableHosts = selectHosts(hosts, "persistent");
  if (availableHosts.length === 0) return null;
  if (primaryHostId !== null) {
    return availableHosts.find((host) => host.id === primaryHostId) ?? null;
  }
  return (
    availableHosts.find((host) => host.status === "connected") ??
    availableHosts[0] ??
    null
  );
}

export function usePrimaryHost(options?: QueryOptions): Host | null {
  const { data: hosts } = useHosts(options);
  const primaryHostId = useSystemConfig(options).data?.primaryHostId ?? null;
  return useMemo(
    () => selectPrimaryHost(hosts, primaryHostId),
    [hosts, primaryHostId],
  );
}

export function useHostCloneDefaultPath(
  hostId: string | null,
  projectId: string | null,
  options?: QueryOptions,
) {
  const enabled = options?.enabled ?? true;
  return useQuery<string>({
    queryKey: hostCloneDefaultPathQueryKey(hostId, projectId),
    queryFn:
      enabled && hostId !== null && projectId !== null
        ? async ({ signal }) =>
            (await sdk.hosts.cloneDefaultPath({ hostId, projectId, signal }))
              .path
        : skipToken,
    staleTime: 60_000,
  });
}

export function useHostDiscoveredRepos(
  hostId: string | null,
  options?: QueryOptions,
) {
  return useQuery<HostDiscoveredReposResponse>({
    queryKey: hostDiscoveredReposQueryKey(hostId),
    queryFn:
      hostId === null
        ? skipToken
        : ({ signal }) =>
            sdk.hosts.experimental_discoverRepos({ hostId, signal }),
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useHostDirectory(hostId: string | null, path: string | null) {
  return useQuery<HostDirectoryListing>({
    queryKey: hostDirectoryQueryKey(hostId, path),
    queryFn: ({ signal }) =>
      sdk.hosts.directory({
        hostId: hostId as string,
        ...(path ? { path } : {}),
        signal,
      }),
    enabled: hostId != null,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
