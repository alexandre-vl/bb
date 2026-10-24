import { resolveCurrentDevInstanceConfig } from "@bb/config/runtime";
import { PERSONAL_PROJECT_ID } from "@bb/domain";

export interface ThreadFixture {
  id: string;
  maxSeq: number;
  path: string;
  projectId: string;
  title: string;
}

interface SidebarThread {
  archivedAt: number | null;
  id: string;
  projectId: string;
  title: string | null;
  titleFallback: string | null;
  visibility: string;
}

interface SidebarBootstrapResponse {
  personalProject: { threads: SidebarThread[] };
  projects: { threads: SidebarThread[] }[];
}

interface TimelineResponse {
  maxSeq: number;
}

interface SystemConfigResponse {
  experiments: { performanceDiagnostics: boolean };
  performanceDiagnosticsAvailable: boolean;
}

export type PerfDiagnosticsState = "enabled" | "unavailable";

async function isListening(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return true;
  } catch {
    return false;
  }
}

export async function resolveDevAppUrl(repoRoot: string): Promise<string> {
  const config = resolveCurrentDevInstanceConfig(repoRoot);
  const viteAppUrl = `http://127.0.0.1:${config.ports.appPort}`;
  return (await isListening(viteAppUrl)) ? viteAppUrl : config.serverUrl;
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${url} → ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function waitForServer(appUrl: string): Promise<void> {
  const response = await fetch(`${appUrl}/health`).catch((error: unknown) => {
    throw new Error(
      `No bb server answers at ${appUrl} (${String(error)}). Start one with \`pnpm start:worktree --perf-diagnostics\` or pass --app <url>.`,
    );
  });
  if (!response.ok) {
    throw new Error(`${appUrl}/health → ${response.status}`);
  }
}

export async function enablePerfDiagnostics(
  appUrl: string,
): Promise<PerfDiagnosticsState> {
  const config = await readJson<SystemConfigResponse>(
    `${appUrl}/api/v1/system/config`,
  );
  if (!config.performanceDiagnosticsAvailable) {
    return "unavailable";
  }
  if (!config.experiments.performanceDiagnostics) {
    await readJson(`${appUrl}/api/v1/settings/experiments`, {
      body: JSON.stringify({ performanceDiagnostics: true }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    });
  }
  return "enabled";
}

function threadPath(thread: SidebarThread): string {
  return thread.projectId === PERSONAL_PROJECT_ID
    ? `/threads/${thread.id}`
    : `/projects/${thread.projectId}/threads/${thread.id}`;
}

export async function discoverThreadFixtures(
  appUrl: string,
): Promise<ThreadFixture[]> {
  const sidebar = await readJson<SidebarBootstrapResponse>(
    `${appUrl}/api/v1/sidebar-bootstrap`,
  );
  const threads = [
    ...sidebar.projects.flatMap((project) => project.threads),
    ...sidebar.personalProject.threads,
  ].filter(
    (thread) => thread.archivedAt === null && thread.visibility === "visible",
  );
  const fixtures = await Promise.all(
    threads.map(async (thread) => {
      const timeline = await readJson<TimelineResponse>(
        `${appUrl}/api/v1/threads/${thread.id}/timeline?deferContent=true`,
      );
      return {
        id: thread.id,
        maxSeq: timeline.maxSeq,
        path: threadPath(thread),
        projectId: thread.projectId,
        title: thread.title ?? thread.titleFallback ?? thread.id,
      };
    }),
  );
  return fixtures.sort((left, right) => right.maxSeq - left.maxSeq);
}
