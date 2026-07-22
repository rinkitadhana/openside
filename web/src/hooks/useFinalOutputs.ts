import { useQuery, type Query } from "@tanstack/react-query";
import api from "@/lib/axiosInstance";
import type {
  FinalOutput,
  GetOutputsBySpaceResponse,
  DownloadUrlResponse,
  DownloadFormat,
} from "@/types/outputTypes";

export const useGetOutputsBySpace = (
  spaceId: string,
  enabled: boolean = true,
  refetchInterval:
    | number
    | false
    | ((query: Query<FinalOutput[], Error>) => number | false) = false,
) => {
  return useQuery({
    queryKey: ["final-outputs", spaceId],
    queryFn: async () => {
      const { data } = await api.get<GetOutputsBySpaceResponse>(
        `/output/space/${spaceId}`,
      );
      return data.data.outputs;
    },
    enabled: enabled && !!spaceId,
    staleTime: 30000,
    refetchInterval,
    retry: false,
  });
};

/**
 * Request a download URL for an output in a given format. Returns the parsed
 * response: `ready: true` with a `url`, or `ready: false` while a transcode is
 * preparing (poll again shortly).
 */
export async function fetchDownloadUrl(
  outputId: string,
  format: DownloadFormat,
  disposition: "inline" | "attachment" = "attachment",
): Promise<DownloadUrlResponse["data"]> {
  const { data } = await api.get<DownloadUrlResponse>(
    `/output/${outputId}/download`,
    {
      params: { format, disposition },
      validateStatus: (s) => s === 200 || s === 202,
    },
  );
  return data.data;
}

/**
 * Cached inline (playback) URL for an output. Presigned URLs stay valid for a
 * while, so we hold them long enough that navigating away and back reuses the
 * same URL - letting the browser serve the thumbnail from its HTTP cache instead
 * of re-fetching and re-downloading every visit.
 */
export const useInlineOutputUrl = (
  outputId: string,
  format: DownloadFormat = "webm",
  enabled: boolean = true,
) => {
  return useQuery({
    queryKey: ["output-url", outputId, format],
    queryFn: async () => {
      const res = await fetchDownloadUrl(outputId, format, "inline");
      return res.url ?? null;
    },
    enabled: enabled && !!outputId,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
    retry: false,
  });
};
