# LiveKit Video Call Migration Plan

Date: 2026-05-03

## Goal

Replace the current PeerJS peer-to-peer video call stack with a LiveKit-based room stack, using La Suite Meet as the reference application. Do not touch `/backup` or any backup-named files/directories.

Implementation has started. PeerJS hooks, rendered PeerJS call screen, PeerJS signaling events, and direct PeerJS dependencies have been removed from the active app code.

## References

- La Suite Meet repository: https://github.com/suitenumerique/meet
- La Suite Meet key patterns reviewed:
  - `src/frontend/src/features/rooms/components/Conference.tsx`
  - `src/frontend/src/features/rooms/components/Join.tsx`
  - `src/frontend/src/features/rooms/livekit/prefabs/VideoConference.tsx`
  - `src/backend/core/utils.py`
  - `src/backend/core/authentication/livekit.py`
  - `src/backend/core/services/livekit_events.py`
  - `src/backend/core/api/viewsets.py`
- LiveKit token and grants docs: https://docs.livekit.io/frontends/reference/tokens-grants/
- LiveKit room management docs: https://docs.livekit.io/intro/basics/rooms-participants-tracks/rooms/
- LiveKit React `LiveKitRoom` docs: https://docs.livekit.io/reference/components/react/component/livekitroom/
- LiveKit React `useTracks` docs: https://docs.livekit.io/reference/components/react/hook/usetracks/
- LiveKit connection and reconnect docs: https://docs.livekit.io/intro/basics/connect/

## Current Code Inventory

PeerJS was originally used in these non-backup files:

- `web/src/hooks/usePeer.ts`: creates the PeerJS instance and exposes `peer` / `myId`.
- `web/src/hooks/usePlayer.ts`: stores local and remote `MediaStream` players, toggles media, and disconnects PeerJS.
- `web/src/components/Space/SpaceScreen.tsx`: orchestrates `usePeer`, `usePlayer`, `useMediaStream`, Socket.IO signaling, incoming/outgoing PeerJS calls, and the current participant grid.
- `core/src/sockets/index.ts`: acts as PeerJS/WebRTC signaling for `join-room`, `user-connected`, media toggles, and `user-leave`.
- `web/src/pages/RoomPage.tsx`: reads `myId` from `usePeer`.
- `web/package.json`, `web/package-lock.json`, `web/pnpm-lock.yaml`: include `peer`, `peerjs`, and `@types/peerjs`.
- `core/package.json`, `core/package-lock.json`: include `peer` and `peerjs`.
- `docs/PRD.md`: still describes the app as PeerJS/WebRTC peer-to-peer.

Existing domain pieces to keep and extend:

- `Space`: room domain record with `joinCode`, host, status, recording status, start/end time.
- `SpaceParticipant`: participant domain record with display name, guest flag, role, active/left state, and session id.
- Existing endpoints for create, get by code, join, leave, participant list, kick, and end space.
- Existing recording manager and chunk upload flow, unless later replaced by LiveKit Egress.

## Target Architecture

Use LiveKit as the only media, participant, track-state, reconnect, and room-disconnect system.

Keep the app backend as the authority for:

- Secure room codes and invite links.
- Space lifecycle: create, validate, expire, end.
- Host and guest role decisions.
- Participant identity generation and persistence.
- LiveKit token generation.
- Token TTL and room expiry rules.
- Recording metadata and current local recording workflow.

Use LiveKit backend APIs for:

- Creating rooms when a `Space` starts.
- Deleting rooms when host ends for all.
- Issuing signed JWT access tokens.
- Optionally removing/kicking participants later.
- Optional LiveKit webhooks for participant joined/left and room finished reconciliation.

Use LiveKit React/client APIs for:

- `LiveKitRoom` room context and connection lifecycle.
- `Room` options such as `adaptiveStream`, `dynacast`, capture defaults, and audio output.
- `usePreviewTracks`, `createLocalAudioTrack`, `createLocalVideoTrack` in pre-join.
- `useTracks`, `useParticipants`, `useLocalParticipant`, `useConnectionState`, `useConnectionQualityIndicator`, `RoomAudioRenderer`, `ConnectionStateToast`.
- Track toggles for mic, camera, screen share, and device switching.

## La Suite Meet Patterns To Copy

1. Conference shell

La Suite Meet wraps the call in `LiveKitRoom`, fetches a backend room payload containing `livekit.url`, `livekit.room`, and `livekit.token`, creates a stable `Room` instance, and passes `audio` / `video` initial choices into `LiveKitRoom`.

Adopt this shape in `SpaceScreen` or a new `LiveKitSpaceScreen`:

- Fetch or create our `Space`.
- Call backend join/token endpoint.
- Build a `Room` instance with `adaptiveStream: true`, `dynacast: true`, capture defaults, and selected devices.
- Render custom app layout inside `LiveKitRoom`.
- Handle `onDisconnected`, `onError`, and `onMediaDeviceFailure`.

2. Pre-join

La Suite Meet uses `usePreviewTracks` for initial preview, and creates local audio/video tracks on demand when the user initially joined muted/off and later enables them before joining.

Adopt this in `PreJoinScreen`:

- Replace raw `getUserMedia` state with LiveKit preview tracks.
- Persist choices: display name, mic enabled, camera enabled, selected camera, selected mic, selected output.
- Support permission-denied and device-in-use states.
- Stop preview tracks on unmount.

3. Video layout

La Suite Meet uses `useTracks` for camera placeholders and screen-share tracks, auto-focuses screen share, renders `GridLayout` when no focus track exists, and renders `FocusLayout` plus carousel when a screen share or pinned participant is focused.

Adopt this behavior with our visual design:

- Grid layout for normal calls.
- Active speaker layout from LiveKit active speakers.
- Screen-share focus layout.
- Participant tile placeholders when camera is off.
- `RoomAudioRenderer` for remote audio.
- Mobile control bar and responsive layout.

4. Security and roles

La Suite Meet signs LiveKit tokens server-side with identity, display name, room grant, publish/subscribe permissions, and participant attributes such as room admin.

Adopt this in Node/Express:

- Use `livekit-server-sdk`.
- Generate tokens only from the backend.
- Use stable identities:
  - Authenticated user: `user:${user.id}` or `clerk:${clerkId}`.
  - Guest: `guest:${spaceId}:${participantSessionId}`.
- Include display name in token name.
- Include attributes/metadata: `spaceParticipantId`, `role`, `isGuest`, `host`, optional avatar.
- Host token gets room admin permissions. Guests get join/publish/subscribe only.

5. Reliability

La Suite Meet warms up LiveKit connection with `room.prepareConnection`, uses longer connection retries/timeouts for constrained networks, and branches on disconnect reasons.

Adopt:

- `room.prepareConnection(LIVEKIT_URL)` before setting `connect=true`.
- `connectOptions.maxRetries` and `peerConnectionTimeout`.
- UI states for connecting, reconnecting, reconnected, disconnected, duplicate identity, removed, room deleted.

## Backend Plan

### Phase 1: Dependencies and configuration

- Add `livekit-server-sdk` to `core`.
- Add frontend dependencies to `web`:
  - `livekit-client`
  - `@livekit/components-react`
  - `@livekit/components-styles`
- Add environment variables:
  - `LIVEKIT_URL`
  - `LIVEKIT_API_KEY`
  - `LIVEKIT_API_SECRET`
  - `LIVEKIT_TOKEN_TTL_SECONDS`
  - `LIVEKIT_ROOM_EMPTY_TIMEOUT_SECONDS`
  - `LIVEKIT_ROOM_MAX_PARTICIPANTS`
- Add `.env.example` entries for `core` and `web`. The frontend should only receive the LiveKit URL from the API, not the API secret.

### Phase 2: Data model

Extend Prisma without breaking existing records:

- `Space.livekitRoomName String? @unique`
- `Space.expiresAt DateTime?`
- `Space.endedReason String?` or enum later.
- `SpaceParticipant.livekitIdentity String? @unique`
- `SpaceParticipant.lastConnectedAt DateTime?`
- `SpaceParticipant.connectionState String?`

Recommended room name:

- `space:${space.id}` or just `space.id`.
- Do not use the join code as the LiveKit room name. The join code is user-facing and should remain revocable/rotatable.

### Phase 3: LiveKit service

Create `core/src/services/livekit-service.ts`:

- `createLiveKitRoom(space)`: calls `RoomServiceClient.createRoom`.
- `deleteLiveKitRoom(space)`: calls `deleteRoom`; this disconnects all participants.
- `generateLiveKitToken({ space, participant, role })`: creates an `AccessToken` with `VideoGrant`.
- `getLiveKitRoom(space)`: optional room lookup for validation/recovery.
- `removeLiveKitParticipant(space, identity)`: optional for kick/host moderation.

Token grants:

- Host:
  - `roomJoin: true`
  - `roomAdmin: true`
  - `canPublish: true`
  - `canSubscribe: true`
  - `canPublishData: true`
  - `canPublishSources: ["camera", "microphone", "screen_share", "screen_share_audio"]`
- Guest:
  - `roomJoin: true`
  - `roomAdmin: false`
  - `canPublish: true`
  - `canSubscribe: true`
  - `canPublishData: true`
  - same publish sources unless product rules later restrict screen share.

### Phase 4: Room lifecycle endpoints

Keep existing space routes where possible, but change their behavior:

- `POST /space/create`
  - Generate secure join code server-side. Stop trusting client-provided `joinCode`.
  - Create `Space`.
  - Create LiveKit room with configured empty timeout/max participants.
  - Create host participant row.
  - Return `space`, `joinCode`, `inviteUrl`, and a LiveKit join payload for host if desired.

- `GET /space/code/:joinCode`
  - Validate code format.
  - Return limited public room info only.
  - Return explicit status for invalid, ended, or expired rooms.

- `POST /participant/:spaceId/join`
  - Support authenticated and guest join.
  - Validate `Space.status === LIVE`.
  - Validate `expiresAt` if present.
  - Find or create `SpaceParticipant` by `participantSessionId`.
  - Generate stable LiveKit identity.
  - Return participant plus:
    - `livekit.url`
    - `livekit.room`
    - `livekit.token`
    - token expiry
    - role/isHost/isGuest

- `POST /participant/:spaceId/leave`
  - Mark participant inactive.
  - Client also calls `room.disconnect()`.
  - Do not delete LiveKit room unless host chooses end-for-all.

- `POST /space/:spaceId/end`
  - Host only.
  - Mark space ended and participants inactive.
  - Call LiveKit `deleteRoom`.
  - Return final room state.

- Add `POST /space/:spaceId/livekit-token` only if token refresh/rejoin cannot be cleanly handled by join endpoint.

### Phase 5: Room cleanup and expiry

- On every join and validation call, reject `ENDED` and expired rooms.
- Add `expiresAt` when creating a room. Pick a product default, for example 24 hours after creation, unless the existing business logic says otherwise.
- Add scheduled cleanup:
  - Mark expired live spaces as `ENDED`.
  - Delete matching LiveKit rooms.
  - Mark active participants inactive.
- Use LiveKit empty timeout for media room cleanup, but do not rely on it as the only source of app room state.

### Phase 6: LiveKit webhooks

Add optional but recommended endpoint:

- `POST /livekit/webhook`

Use LiveKit webhook receiver verification to process:

- `participant_joined`: update `lastConnectedAt`, `connectionState`.
- `participant_left`: mark inactive only after a grace period or update state without ending domain participation immediately.
- `room_finished`: reconcile empty/deleted room.

Do not trust raw webhook bodies without LiveKit signature verification.

## Frontend Plan

### Phase 1: Replace PeerJS call orchestration

Create new hooks/components:

- `web/src/hooks/useLiveKitJoin.ts`
  - Calls join endpoint and returns LiveKit payload.
- `web/src/components/Space/LiveKitSpaceScreen.tsx`
  - Owns `Room` instance, connection warmup, `LiveKitRoom`, and disconnect handlers.
- `web/src/components/Space/livekit/LiveKitVideoStage.tsx`
  - Uses LiveKit tracks/participants to render the call.
- `web/src/components/Space/livekit/LiveKitControls.tsx`
  - Mic/camera/screen/device/leave/end controls.
- `web/src/components/Space/livekit/ParticipantTile.tsx`
  - Camera placeholder, name, host/guest badge, mic/camera indicators, active speaker outline.

Then switch `SpaceScreen.tsx` to the LiveKit implementation or replace it entirely once parity is reached.

### Phase 2: Pre-join

Update `PreJoinScreen.tsx`:

- Load devices with LiveKit hooks or browser device APIs.
- Use `usePreviewTracks` for preview.
- Display selected camera/mic/output menus.
- Support:
  - camera preview
  - mic preview/activity indicator
  - join muted
  - join with camera off
  - camera selection
  - mic selection
  - speaker/output selection where supported
  - permission denied, no device, and device-in-use errors
- Save selected devices to local storage.
- Submit display name and session id to the join endpoint before connecting.

### Phase 3: In-call controls

Implement LiveKit-backed controls:

- Mute/unmute: `room.localParticipant.setMicrophoneEnabled`.
- Camera on/off: `room.localParticipant.setCameraEnabled`.
- Screen share start/stop: `room.localParticipant.setScreenShareEnabled`.
- Device switch:
  - Use LiveKit local track `setDeviceId` where available.
  - Update room audio output device when supported.
- Leave call:
  - Confirm before leaving.
  - Call leave endpoint.
  - Call `room.disconnect()`.
- End call for all:
  - Host only.
  - Confirm before ending.
  - Call `/space/:spaceId/end`; LiveKit room deletion disconnects everyone.

### Phase 4: Participants and layout

Use LiveKit state instead of app-maintained `players`:

- `useTracks([{ source: Camera, withPlaceholder: true }, { source: ScreenShare }])`.
- `useParticipants` for list/count.
- `useSpeakingParticipants` or room active speakers for active speaker highlight.
- `useConnectionQualityIndicator` or participant connection quality for network indicator.
- Track publication state for mic/camera icons.
- Participant metadata/attributes for host and guest badges.

Layouts:

- Grid: default camera placeholder layout.
- Active speaker: featured active speaker when no screen share is active.
- Screen share: auto-focus screen share and show participant carousel/grid.
- Mobile: compact top content, bottom controls, collapsible participants.
- Fullscreen: use existing fullscreen pattern but attach it to the LiveKit stage/screen-share focus.

### Phase 5: Reliability UI

Add visible states:

- connecting
- reconnecting
- reconnected
- connection lost
- duplicate identity
- participant removed
- room deleted / host ended call
- invalid room code
- expired room

LiveKit already attempts resume, ICE restart, and full reconnect. The UI should only represent those states; it should not implement custom PeerJS reconnect logic.

### Phase 6: Invite system

Move room code generation to backend:

- Generate secure room code server-side.
- Shareable link: `${WEB_URL}/room/${joinCode}` or current route equivalent.
- Add invite/share modal:
  - room code
  - copy invite link
  - copy code
  - optional native share on mobile

## PeerJS Removal Plan

Only remove after the LiveKit implementation passes parity tests.

Remove or rewrite:

- `web/src/hooks/usePeer.ts`
- `web/src/hooks/usePlayer.ts`
- PeerJS code in `SpaceScreen.tsx`
- PeerJS references in `RoomPage.tsx`
- PeerJS signaling comments and events in `core/src/sockets/index.ts`

Keep Socket.IO only if still needed for:

- recording start/stop events
- recording upload progress
- app-specific notifications not covered by LiveKit data channels

Remove dependencies:

- `peer`
- `peerjs`
- `@types/peerjs`

Update docs:

- Replace PeerJS/WebRTC peer-to-peer language in `docs/PRD.md`.
- Mention LiveKit SFU, signed tokens, and backend-created rooms.

Do not edit:

- `/backup`
- any backup-named files/directories

## Feature Checklist

### Core

- Create room: `POST /space/create` creates `Space` and LiveKit room.
- End room: host endpoint marks `Space` ended and deletes LiveKit room.
- Leave room: participant endpoint marks inactive and client disconnects.
- Room expiry: `expiresAt` plus scheduled cleanup.
- Room validation: join code validation returns invalid/ended/expired reasons.
- Room state management: React Query for app state, LiveKit room context for media state.

### Joining

- Join by room code: existing route backed by validated code.
- Join by invite link: link contains join code.
- Guest join: join endpoint accepts display name and participant session id without signup.
- Display name input: passed as LiveKit token name.
- Rejoin after disconnect: reuse participant session id and request fresh token if needed.
- Invalid/expired room handling: explicit UI states before pre-join or on join failure.

### Pre-join

- Camera preview: LiveKit preview video track.
- Mic preview: LiveKit preview audio track and level indicator.
- Join muted: initial `audio=false`.
- Join with camera off: initial `video=false`.
- Camera selection: saved device id and preview track switch.
- Mic selection: saved device id and preview track switch.
- Speaker/output selection: saved output device where browser supports it.
- Permission handling: denied, missing, device-in-use, and retry states.

### In-call controls

- Mute/unmute: LiveKit local microphone publish state.
- Camera on/off: LiveKit local camera publish state.
- Screen share start/stop: LiveKit screen share track.
- Device switch during call: LiveKit track/device APIs.
- Leave call: leave endpoint plus `room.disconnect`.
- End call for all: host endpoint plus LiveKit `deleteRoom`.

### Participants

- Participant tiles: from LiveKit track references.
- Participant list: from LiveKit participants plus app metadata.
- Participant count: LiveKit participants count.
- Join/leave events: LiveKit participant events and optional webhook reconciliation.
- Active speaker highlight: LiveKit active speakers.
- Mic state indicator: audio track publication/muted state.
- Camera state indicator: camera track publication/muted state.
- Host badge: token attributes or participant metadata.
- Guest badge: token attributes or participant metadata.

### Layout

- Grid layout: default stage.
- Active speaker layout: featured speaker mode.
- Screen share layout: auto-focused screen share.
- Responsive mobile layout: mobile control bar and compact stage.
- Fullscreen mode: fullscreen stage/focus region.

### Network / Reliability

- Auto reconnect: LiveKit built-in reconnect.
- Reconnecting state: `useConnectionState` / room events.
- Connection lost state: disconnected reason handling.
- Network quality indicator: LiveKit connection quality.
- Media recovery handling: rely on LiveKit republish/reconnect events; show temporary UI.

### Invite System

- Generate room code: backend secure code.
- Generate shareable link: backend or frontend from join code.
- Copy invite link: invite modal.
- Invite/share modal: room code, link, copy/share actions.

### Backend

- Create room endpoint: creates app + LiveKit rooms.
- Join room endpoint: validates and returns signed token.
- Token generation: `livekit-server-sdk`.
- Guest identity generation: stable guest identity from session id.
- Token expiry: short TTL with refresh/rejoin strategy.
- Room cleanup: scheduled cleanup and LiveKit delete.

### Security

- Secure room codes: generated server-side with sufficient entropy.
- Access validation: status, expiry, role, room code.
- Signed tokens: backend only.
- Session expiration: room expiry plus token TTL.

### UX Polish

- Waiting for participants screen: no remote participants.
- Loading states: fetch, token, connecting, media permission.
- Error states: invalid, expired, permission denied, connection failure.
- Confirm before leaving: leave/end confirmation dialogs.
- Empty room state: host waiting state and ended/expired state.

### Optional Later

- Chat: LiveKit data channels or app Socket.IO.
- Raise hand: LiveKit participant attributes.
- Reactions: LiveKit data channels.
- Waiting room: backend pending participant queue and host approval.
- Kick participant: LiveKit remove participant.
- Recording: LiveKit Egress or keep current local recording first.
- Background blur: LiveKit track processor like La Suite Meet.
- Captions: LiveKit transcription/data or existing future system.
- Polls: app-level data channel or backend persisted state.
- Breakout rooms: multiple LiveKit rooms tied to one parent space.

## Implementation Order

1. Add LiveKit dependencies and env config.
2. Add Prisma fields and migrate.
3. Implement `livekit-service.ts`.
4. Update create/join/end/leave endpoints to return and enforce LiveKit state.
5. Build LiveKit pre-join device preview and join payload flow.
6. Build LiveKit room shell around `LiveKitRoom`.
7. Build participant tiles, layouts, controls, and invite modal.
8. Add reliability states and disconnect reason handling.
9. Preserve or adapt local recording events.
10. Remove PeerJS hooks, signaling, and dependencies.
11. Update `docs/PRD.md` after implementation lands.
12. Add tests and run full validation.

## Test Plan

Backend:

- Create room creates `Space`, host participant, LiveKit room, and secure code.
- Join live room returns token and participant.
- Join ended room fails.
- Join expired room fails.
- Guest join creates stable guest identity.
- Rejoin with same `participantSessionId` reuses identity.
- Host end calls LiveKit delete and marks participants inactive.
- Non-host cannot end room.
- Token does not expose API secret and contains expected grants.

Frontend:

- Pre-join works with camera/mic on.
- Pre-join works joined muted/camera off.
- Device switching changes preview and in-call devices.
- Two participants can join and see/hear each other.
- Participant list/count updates.
- Mic/camera state indicators update.
- Screen share starts, focuses, and stops.
- Host end disconnects all users with clear state.
- Guest leave removes participant without ending room.
- Refresh/rejoin works with same display/session id.
- Invalid and expired links show correct UI.
- Mobile layout is usable.

Reliability:

- Simulate network interruption and verify reconnecting/reconnected UI.
- Verify duplicate identity handling by joining same identity twice.
- Verify connection failure surfaces actionable error.

Regression:

- Existing recording start/stop/chunk upload still works.
- Dashboard room creation and recent spaces still work.
- No `/backup` file changed.

## Risks And Decisions

- Recording: the app currently records local streams. LiveKit migration can preserve this initially, but LiveKit Egress is the better long-term recording path.
- Socket.IO: remove PeerJS signaling, but keep Socket.IO if recording progress depends on it. Replacing those events with LiveKit data channels can be a later cleanup.
- Token TTL: LiveKit says token expiry affects initial connection and refresh/reconnect behavior, but self-hosted deployments need short TTL plus backend refusal after kick/end to prevent stale-token rejoin.
- Room code generation: current create endpoint accepts client-supplied `joinCode`; this should move server-side before public guest joining is considered secure.
- Browser output device selection is not supported everywhere, so the UI must gracefully hide/disable speaker selection where unavailable.
