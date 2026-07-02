export type ApiJob = {
  id: string;
  type: string;
  status: "queued" | "running" | "succeeded" | "failed";
  result?: Record<string, unknown> | null;
  error?: { message?: string | null } | null;
};

type JobStatusResponse = {
  ok: boolean;
  job: ApiJob;
};

export const pollJobUntilDone = async (
  jobId: string,
  options?: {
    intervalMs?: number;
    timeoutMs?: number;
  }
) => {
  const intervalMs = options?.intervalMs ?? 1200;
  const timeoutMs = options?.timeoutMs ?? 300_000;
  const startedAt = Date.now();

  while (true) {
    const response = await fetch(`/api/jobs/${jobId}`, { method: "GET" });
    const payload = (await response.json().catch(() => ({}))) as Partial<JobStatusResponse> & {
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load job status.");
    }

    const job = payload.job;
    if (!job) {
      throw new Error("Job status response is missing job data.");
    }

    if (job.status === "succeeded") {
      return job;
    }

    if (job.status === "failed") {
      throw new Error(job.error?.message || "Background job failed.");
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Job timed out.");
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};
