/**
 * Plan usage + entitlements, straight from the server. The client NEVER
 * decides plan limits itself - it only renders what these endpoints return.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/axiosInstance";

export interface Usage {
  plan: "demo" | "pro" | "selfhost";
  used: number;
  limit: number | null;
  remaining: number | null;
  resets_at: string | null;
  exhausted: boolean;
  /** True when ≤2 minutes of metered credit remain. */
  warning: boolean;
}

export interface Entitlements {
  plan: "demo" | "pro" | "selfhost";
  metered: boolean;
  recordingSecondsLimit: number | null;
  resetsAt: string | null;
  watermark: boolean;
  cloudBackupAllowed: boolean;
  maxVideoHeight: number;
  maxAudioSampleRate: number;
  multitrack: boolean;
  retentionHours: number | null;
}

export const useUsage = (enabled = true) =>
  useQuery({
    queryKey: ["usage"],
    queryFn: async () => {
      const { data } = await api.get<{ data: Usage }>("/usage");
      return data.data;
    },
    enabled,
    staleTime: 30_000,
  });

export const useEntitlements = (enabled = true) =>
  useQuery({
    queryKey: ["entitlements"],
    queryFn: async () => {
      const { data } = await api.get<{ data: Entitlements }>(
        "/usage/entitlements",
      );
      return data.data;
    },
    enabled,
    staleTime: 60_000,
  });

/**
 * Heartbeat sent while recording. Response is the fresh usage snapshot;
 * `data === null` means the session isn't metered (self-host).
 */
export const sendUsageHeartbeat = async (
  sessionId: string,
): Promise<Usage | null> => {
  const { data } = await api.post<{ data: Usage | null }>("/usage/heartbeat", {
    sessionId,
  });
  return data.data;
};

export const useCreateCheckout = () =>
  useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ data: { url: string } }>(
        "/billing/checkout",
      );
      return data.data.url;
    },
  });

export const useBillingPortal = () =>
  useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ data: { url: string } }>(
        "/billing/portal",
      );
      return data.data.url;
    },
  });

// Self-host settings

export interface SelfHostConfigView {
  enabled: boolean;
  livekitUrl: string;
  livekitApiKey: string; // masked
  r2AccountId: string;
  r2AccessKeyId: string; // masked
  r2Bucket: string;
  lastValidatedAt: string | null;
}

export interface SelfHostConfigInput {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  r2AccountId: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2Bucket: string;
}

const invalidatePlanQueries = (
  queryClient: ReturnType<typeof useQueryClient>,
) => {
  queryClient.invalidateQueries({ queryKey: ["usage"] });
  queryClient.invalidateQueries({ queryKey: ["entitlements"] });
  queryClient.invalidateQueries({ queryKey: ["selfhost-config"] });
};

export const useSelfHostConfig = () =>
  useQuery({
    queryKey: ["selfhost-config"],
    queryFn: async () => {
      const { data } = await api.get<{ data: SelfHostConfigView | null }>(
        "/settings/selfhost",
      );
      return data.data;
    },
  });

export const useSaveSelfHostConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SelfHostConfigInput) => {
      const { data } = await api.put<{ data: SelfHostConfigView }>(
        "/settings/selfhost",
        input,
      );
      return data.data;
    },
    onSuccess: () => invalidatePlanQueries(queryClient),
  });
};

export const useToggleSelfHost = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const { data } = await api.patch<{ data: SelfHostConfigView }>(
        "/settings/selfhost",
        { enabled },
      );
      return data.data;
    },
    onSuccess: () => invalidatePlanQueries(queryClient),
  });
};

export const useDeleteSelfHostConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.delete("/settings/selfhost");
    },
    onSuccess: () => invalidatePlanQueries(queryClient),
  });
};
