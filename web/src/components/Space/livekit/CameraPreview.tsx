import { useRoomContext } from "@livekit/components-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Track, type LocalVideoTrack } from "livekit-client";
import {
  Aperture,
  ChevronDown,
  Loader2,
  VideoOff,
  Wallpaper,
} from "lucide-react";
import { FiCheckSquare, FiSquare } from "react-icons/fi";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/shared/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { cleanDeviceLabel, sortMediaDevices } from "@/lib/mediaDevices";
import { playCallSound } from "@/lib/callSounds";
import { useLowLight } from "@/hooks/useLowLight";
import {
  applyCameraBackground,
  backgroundKey,
  getPresetImageUrl,
  isCameraBackgroundSupported,
  loadCustomImage,
  loadSavedBackground,
  prepareCustomImage,
  saveBackground,
  type CameraBackground,
} from "@/lib/cameraBackgrounds";
import LowLightBadge from "../ui/LowLightBadge";
import BackgroundOptionsGrid from "./BackgroundOptions";
import { useIsAudioOnlyCall } from "./AudioOnlyMode";

// Turning the camera on in a call goes through a preview first, so nobody is
// put on screen before they've checked framing, lighting and which camera is
// live. The preview track is created with the room's capture defaults, so on
// confirm it's published as-is - no second camera acquire, no flicker.

type PreviewError = "denied" | "missing" | "busy" | "unknown";

const ERROR_COPY: Record<PreviewError, { title: string; body: string }> = {
  denied: {
    title: "Camera access is blocked",
    body: "Allow camera access from the icon in your browser's address bar, then try again.",
  },
  missing: {
    title: "No camera found",
    body: "Connect a camera, then try again.",
  },
  busy: {
    title: "Camera is in use",
    body: "Another app may be using your camera. Close it, then try again.",
  },
  unknown: {
    title: "Couldn't start your camera",
    body: "Something went wrong starting the camera. Try again.",
  },
};

const toPreviewError = (error: unknown): PreviewError => {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "denied";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "missing";
  }
  if (name === "NotReadableError" || name === "TrackStartError") return "busy";
  return "unknown";
};

// Gap between the camera control and the panel, and the minimum distance the
// panel keeps from the viewport edges - same as the device dropdowns.
const ANCHOR_GAP = 8;
const VIEWPORT_GUTTER = 8;

interface CameraPreviewContextValue {
  /** For the camera button: clicking it again closes the panel. */
  toggleCameraPreview: () => void;
  openCameraPreview: () => void;
  /** Callback ref for the camera control the panel pops up above. */
  setCameraAnchor: (element: HTMLElement | null) => void;
}

const CameraPreviewContext = createContext<CameraPreviewContextValue | null>(
  null,
);

export const useCameraPreview = () => {
  const context = useContext(CameraPreviewContext);
  if (!context) {
    throw new Error(
      "useCameraPreview must be used inside CameraPreviewProvider",
    );
  }
  return context;
};

export const CameraPreviewProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [anchor, setCameraAnchor] = useState<HTMLElement | null>(null);
  // Audio-only calls keep cameras off, so the preview never shows.
  const isAudioOnly = useIsAudioOnlyCall();
  if (isAudioOnly && isOpen) setIsOpen(false);
  const toggleCameraPreview = useCallback(() => setIsOpen((open) => !open), []);
  const openCameraPreview = useCallback(() => setIsOpen(true), []);
  const value = useMemo(
    () => ({ toggleCameraPreview, openCameraPreview, setCameraAnchor }),
    [toggleCameraPreview, openCameraPreview],
  );

  return (
    <CameraPreviewContext.Provider value={value}>
      {children}
      {isOpen && !isAudioOnly && (
        <CameraPreviewDialog anchor={anchor} onClose={() => setIsOpen(false)} />
      )}
    </CameraPreviewContext.Provider>
  );
};

const CameraPreviewDialog = ({
  anchor,
  onClose,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
}) => {
  const room = useRoomContext();
  const panelRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  const trackRef = useRef<LocalVideoTrack | null>(null);
  // Bumped on every acquire so a slow, superseded getUserMedia can't clobber
  // the current preview (or leave the camera running after close).
  const acquireIdRef = useRef(0);
  const handedOffRef = useRef(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const [track, setTrack] = useState<LocalVideoTrack | null>(null);
  const [error, setError] = useState<PreviewError | null>(null);
  const [isStarting, setIsStarting] = useState(true);
  const [isConfirming, setIsConfirming] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>(() => {
    const active = room.getActiveDevice("videoinput");
    return active && active !== "default" ? active : "";
  });
  const [resolution, setResolution] = useState<number | null>(null);
  const [hasFrame, setHasFrame] = useState(false);
  // Already on (opened from "Camera preview"): confirming applies the changes
  // to the live camera instead of turning it on.
  const [isCameraLive] = useState(() => room.localParticipant.isCameraEnabled);
  const [isCameraMenuOpen, setIsCameraMenuOpen] = useState(false);
  const [isBackgroundMenuOpen, setIsBackgroundMenuOpen] = useState(false);
  const isPickerOpen = isCameraMenuOpen || isBackgroundMenuOpen;
  // The raw camera, captured before any background processor - lighting is
  // judged on the real room, not the virtual one.
  const [rawCameraTrack, setRawCameraTrack] = useState<MediaStreamTrack | null>(
    null,
  );
  const isLowLight = useLowLight(rawCameraTrack);

  const [isBackgroundSupported, setIsBackgroundSupported] = useState(false);
  const [background, setBackground] =
    useState<CameraBackground>(loadSavedBackground);
  const [customImageUrl, setCustomImageUrl] = useState(loadCustomImage);
  const [pendingBackgroundKey, setPendingBackgroundKey] = useState<
    string | null
  >(null);
  const backgroundRef = useRef(background);
  const customImageUrlRef = useRef(customImageUrl);
  const applyIdRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void isCameraBackgroundSupported().then((supported) => {
      if (!cancelled) setIsBackgroundSupported(supported);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyBackgroundToPreview = useCallback(
    async (target: LocalVideoTrack, next: CameraBackground) => {
      const applyId = ++applyIdRef.current;
      setPendingBackgroundKey(
        next.kind === "none" ? null : backgroundKey(next),
      );
      try {
        await applyCameraBackground(target, next, customImageUrlRef.current);
      } catch (backgroundError) {
        console.error("Unable to apply camera background:", backgroundError);
        if (applyId === applyIdRef.current) {
          backgroundRef.current = { kind: "none" };
          setBackground({ kind: "none" });
          void target.stopProcessor().catch(() => undefined);
        }
      } finally {
        if (applyId === applyIdRef.current) setPendingBackgroundKey(null);
      }
    },
    [],
  );

  const selectBackground = (next: CameraBackground) => {
    backgroundRef.current = next;
    setBackground(next);
    saveBackground(next);
    if (trackRef.current) {
      void applyBackgroundToPreview(trackRef.current, next);
    }
  };

  const handleCustomImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      const url = await prepareCustomImage(file);
      customImageUrlRef.current = url;
      setCustomImageUrl(url);
      selectBackground({ kind: "custom" });
    } catch (imageError) {
      console.error("Unable to use that image as a background:", imageError);
    }
  };

  const releaseTrack = useCallback(() => {
    if (!handedOffRef.current) trackRef.current?.stop();
    trackRef.current = null;
    setTrack(null);
    setRawCameraTrack(null);
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(
        sortMediaDevices(all.filter((device) => device.kind === "videoinput")),
      );
    } catch {
      // Listing devices is best-effort; the preview still works without it.
    }
  }, []);

  const acquire = useCallback(
    async (requestedDeviceId: string) => {
      const acquireId = ++acquireIdRef.current;
      releaseTrack();
      setError(null);
      setIsStarting(true);
      setHasFrame(false);

      const create = (id: string) =>
        room.localParticipant.createTracks({
          video: {
            // A bare default would fall back to the room's `exact` pre-join
            // device, so name the "let the browser pick" case explicitly.
            deviceId: id ? { exact: id } : { ideal: "default" },
          },
        });

      try {
        let tracks;
        try {
          tracks = await create(requestedDeviceId);
        } catch (createError) {
          // The remembered camera went stale (unplugged / re-enumerated):
          // fall back to whichever camera the browser picks.
          if (
            requestedDeviceId &&
            createError instanceof Error &&
            (createError.name === "OverconstrainedError" ||
              createError.name === "NotFoundError")
          ) {
            tracks = await create("");
          } else {
            throw createError;
          }
        }

        const nextTrack = tracks.find(
          (item): item is LocalVideoTrack => item.kind === Track.Kind.Video,
        );
        if (acquireId !== acquireIdRef.current) {
          tracks.forEach((item) => item.stop());
          return;
        }
        if (!nextTrack) throw new Error("No camera track was created.");

        trackRef.current = nextTrack;
        setTrack(nextTrack);
        setRawCameraTrack(nextTrack.mediaStreamTrack);
        if (backgroundRef.current.kind !== "none") {
          void applyBackgroundToPreview(nextTrack, backgroundRef.current);
        }
        const settings = nextTrack.mediaStreamTrack.getSettings();
        setDeviceId(settings.deviceId ?? requestedDeviceId);
        setResolution(settings.height ?? null);
        await refreshDevices();
      } catch (acquireError) {
        if (acquireId !== acquireIdRef.current) return;
        setError(toPreviewError(acquireError));
      } finally {
        if (acquireId === acquireIdRef.current) setIsStarting(false);
      }
    },
    [applyBackgroundToPreview, refreshDevices, releaseTrack, room],
  );

  // Start on open; release the camera on close unless it was handed to LiveKit.
  useEffect(() => {
    void acquire(deviceId);
    return () => {
      acquireIdRef.current++;
      if (!handedOffRef.current) trackRef.current?.stop();
      trackRef.current = null;
    };
    // Only on mount - device switches call acquire() directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    navigator.mediaDevices?.addEventListener("devicechange", refreshDevices);
    return () =>
      navigator.mediaDevices?.removeEventListener(
        "devicechange",
        refreshDevices,
      );
  }, [refreshDevices]);

  // attach() (not a raw srcObject) so LiveKit swaps in the processed stream
  // when a background is applied or removed.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !track) return;
    track.attach(video);
    return () => {
      track.detach(video);
    };
  }, [track]);

  useEffect(() => {
    if (!isStarting && track) confirmRef.current?.focus();
  }, [isStarting, track]);

  const handleCancel = useCallback(() => {
    if (isConfirming) return;
    onClose();
  }, [isConfirming, onClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Esc in an open camera/background menu only closes that menu.
      if (event.key === "Escape" && !isPickerOpen) handleCancel();
    };
    // Click-away closes it, except on the camera control itself (that click
    // toggles it) and inside the camera picker, which renders in a portal.
    const handlePointerDown = (event: PointerEvent) => {
      // A click away from an open menu only closes that menu.
      if (isPickerOpen) return;
      const target = event.target as Element | null;
      if (
        !target ||
        panelRef.current?.contains(target) ||
        anchor?.contains(target) ||
        target.closest("[data-radix-popper-content-wrapper]")
      ) {
        return;
      }
      handleCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [anchor, handleCancel, isPickerOpen]);

  // Open upward from the camera control like its device dropdown: left edges
  // aligned, clamped inside the viewport.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const update = () => {
      const width = panel.offsetWidth;
      if (!anchor) {
        setPosition({
          left: (window.innerWidth - width) / 2,
          bottom: 96,
        });
        return;
      }
      const rect = anchor.getBoundingClientRect();
      setPosition({
        left: Math.min(
          Math.max(rect.left, VIEWPORT_GUTTER),
          window.innerWidth - width - VIEWPORT_GUTTER,
        ),
        bottom: window.innerHeight - rect.top + ANCHOR_GAP,
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    if (anchor) observer.observe(anchor);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [anchor]);

  const handleConfirm = async () => {
    const previewTrack = trackRef.current;
    if (!previewTrack || isConfirming) return;
    setIsConfirming(true);

    const localParticipant = room.localParticipant;
    const existing = localParticipant.getTrackPublication(Track.Source.Camera);

    // Switching to the camera that's already active would restart the live
    // track (and its background processor) for nothing.
    const needsDeviceSwitch =
      !!deviceId && deviceId !== room.getActiveDevice("videoinput");

    try {
      if (isCameraLive && existing?.track) {
        // Opened from "Camera preview" with the camera already on: apply the
        // chosen camera and background to the live track. Stop the preview
        // first - its segmenter runs on the main thread, and running it next
        // to the live track's freezes the page.
        previewTrack.stop();
        if (needsDeviceSwitch) {
          await room.switchActiveDevice("videoinput", deviceId, true);
        }
        await applyCameraBackground(
          existing.track as LocalVideoTrack,
          backgroundRef.current,
          customImageUrlRef.current,
        );
        onClose();
        return;
      }
      if (existing?.track) {
        // The camera was on earlier and is now a muted publication. Keep it
        // (recording follows that publication) - point it at the chosen
        // camera and unmute; LiveKit re-acquires while the preview stays live.
        if (needsDeviceSwitch) {
          await room.switchActiveDevice("videoinput", deviceId, true);
        }
        try {
          await localParticipant.setCameraEnabled(true);
        } catch {
          // Some platforms (mostly Windows) won't open one camera twice -
          // free the preview's capture and try once more.
          previewTrack.stop();
          await localParticipant.setCameraEnabled(true);
        }
        // The live camera is up - drop the preview (and its segmenter) before
        // building the publication's own.
        previewTrack.stop();
        // That publication has its own processor (or none) - bring it in
        // line with what the preview showed.
        try {
          await applyCameraBackground(
            existing.track as LocalVideoTrack,
            backgroundRef.current,
            customImageUrlRef.current,
          );
        } catch (backgroundError) {
          console.error("Unable to apply camera background:", backgroundError);
        }
      } else {
        handedOffRef.current = true;
        await localParticipant.publishTrack(previewTrack);
      }
      playCallSound("cameraOn");
      onClose();
    } catch (confirmError) {
      if (handedOffRef.current) {
        handedOffRef.current = false;
      }
      console.error("Unable to apply camera settings:", confirmError);
      setIsConfirming(false);
      setError(toPreviewError(confirmError));
      releaseTrack();
    }
  };

  const backgroundThumbUrl =
    background.kind === "preset"
      ? getPresetImageUrl(background.id)
      : background.kind === "custom"
        ? customImageUrl
        : null;

  const activeDevice = devices.find((device) => device.deviceId === deviceId);
  const activeLabel = activeDevice?.label
    ? cleanDeviceLabel(activeDevice.label)
    : "Camera";

  return (
    <div
      ref={panelRef}
      className={cn(
        "fixed z-[100] w-[min(360px,calc(100vw-1rem))] origin-bottom-left rounded-xl border border-call-border bg-call-background p-2 shadow-lg",
        position
          ? "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2"
          : "invisible",
      )}
      style={
        position
          ? { left: position.left, bottom: position.bottom }
          : { left: 0, bottom: 0 }
      }
      role="dialog"
      aria-label="Camera preview"
    >
      <div>
        <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-call-border bg-call-primary">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            onLoadedData={() => setHasFrame(true)}
            className={cn(
              // Mirrored like your tile in the call, so moving left moves left.
              "h-full w-full scale-x-[-1] object-cover transition-opacity duration-300",
              track && hasFrame ? "opacity-100" : "opacity-0",
            )}
          />

          {(isStarting || (track && !hasFrame)) && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-foreground/60">
              <Loader2 className="size-6 animate-spin" />
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-red-500/10 text-red-500">
                <VideoOff className="size-5" />
              </span>
              <p className="text-sm font-medium text-foreground">
                {ERROR_COPY[error].title}
              </p>
              <p className="max-w-[320px] text-xs leading-5 text-foreground/60">
                {ERROR_COPY[error].body}
              </p>
              <button
                type="button"
                onClick={() => void acquire(deviceId)}
                className="mt-1 rounded-lg border border-border bg-primary px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-primary-hover"
              >
                Try again
              </button>
            </div>
          )}

          {track && hasFrame && !error && (
            <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-2">
              {resolution ? (
                <span className="rounded-md bg-black/55 px-1.5 py-0.5 text-[0.65rem] font-medium tabular-nums text-white backdrop-blur-sm">
                  {resolution >= 2160 ? "4K" : `${resolution}p`}
                </span>
              ) : (
                <span />
              )}
              {isLowLight && <LowLightBadge />}
            </div>
          )}
        </div>

        <div className="mt-2 flex flex-col gap-2">
          <div className="flex items-stretch gap-2">
            <DropdownMenu
              // Non-modal: a modal menu disables pointer events on <body>, so a
              // click on the card would land on <html> and read as click-away.
              modal={false}
              open={isCameraMenuOpen}
              onOpenChange={setIsCameraMenuOpen}
            >
              <DropdownMenuTrigger asChild disabled={isConfirming}>
                <button
                  type="button"
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-call-border bg-primary px-3 py-2.5 text-left transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60",
                    isCameraMenuOpen && "bg-primary-hover",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                    {activeLabel}
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 text-foreground/50 transition-transform duration-150",
                      isCameraMenuOpen && "rotate-180",
                    )}
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                side="top"
                sideOffset={6}
                collisionPadding={8}
                className="z-[110] w-(--radix-dropdown-menu-trigger-width) rounded-xl border-call-border bg-call-background p-1.5"
              >
                {devices.length === 0 ? (
                  <DropdownMenuItem
                    disabled
                    className="cursor-default rounded-lg px-3 py-2 text-foreground/50"
                  >
                    No cameras found
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuRadioGroup
                    value={deviceId}
                    onValueChange={(nextId) => {
                      if (nextId !== deviceId) void acquire(nextId);
                    }}
                  >
                    {devices.map((device, index) => (
                      <DropdownMenuRadioItem
                        key={device.deviceId}
                        value={device.deviceId}
                        className="cursor-pointer rounded-lg px-2.5 py-1.5 pl-2.5 text-sm font-normal focus:bg-primary-hover [&>span:first-child]:hidden"
                      >
                        {device.deviceId === deviceId ? (
                          <FiCheckSquare className="size-4" />
                        ) : (
                          <FiSquare className="size-4" />
                        )}
                        <span className="min-w-0 flex-1 truncate">
                          {cleanDeviceLabel(device.label) ||
                            `Camera ${index + 1}`}
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {isBackgroundSupported && (
              <DropdownMenu
                modal={false}
                open={isBackgroundMenuOpen}
                onOpenChange={setIsBackgroundMenuOpen}
              >
                <DropdownMenuTrigger asChild disabled={isConfirming}>
                  <button
                    type="button"
                    title="Background"
                    aria-label="Background"
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-lg border border-call-border bg-primary px-2 transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60",
                      isBackgroundMenuOpen && "bg-primary-hover",
                    )}
                  >
                    <span className="relative flex h-5 w-8 items-center justify-center overflow-hidden rounded-[4px] text-foreground/70">
                      {backgroundThumbUrl ? (
                        <img
                          src={backgroundThumbUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : background.kind === "blur" ? (
                        <Aperture className="size-4" />
                      ) : (
                        <Wallpaper className="size-4" />
                      )}
                      {pendingBackgroundKey && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                          <Loader2 className="size-3 animate-spin" />
                        </span>
                      )}
                    </span>
                    <ChevronDown
                      className={cn(
                        "size-4 shrink-0 text-foreground/50 transition-transform duration-150",
                        isBackgroundMenuOpen && "rotate-180",
                      )}
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  side="top"
                  sideOffset={6}
                  collisionPadding={8}
                  className="z-[110] w-[248px] rounded-xl border-call-border bg-call-background p-1.5"
                >
                  <BackgroundOptionsGrid
                    value={background}
                    customImageUrl={customImageUrl}
                    pendingKey={pendingBackgroundKey}
                    disabled={isConfirming}
                    onSelect={selectBackground}
                    onUploadClick={() => fileInputRef.current?.click()}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              void handleCustomImage(event.target.files?.[0]);
              event.target.value = "";
            }}
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isConfirming}
              className="flex-1 rounded-lg border border-call-border bg-primary px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              ref={confirmRef}
              type="button"
              onClick={() => void handleConfirm()}
              disabled={!track || isStarting || isConfirming || !!error}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isConfirming && <Loader2 className="size-4 animate-spin" />}
              {isCameraLive
                ? isConfirming
                  ? "Applying…"
                  : "Apply"
                : isConfirming
                  ? "Turning on…"
                  : "Turn on camera"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
