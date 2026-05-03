# Product Requirements Document

## Product Overview

**Product Name:** Openside

**Product Vision:** A simple, affordable video calling platform for recording high-quality podcast interviews and content creation sessions. Openside provides separate recording tracks for each participant, giving creators the flexibility to edit and produce professional content without the complexity and cost of existing solutions.

**Core Problem:** Existing video recording platforms like Riverside.fm are expensive and overcomplicated for creators who simply need high-quality separate tracks for their content. Openside solves this by providing essential recording features at a lower price point with a generous free tier.

**Target Users:**
- Content creators (podcasters, YouTubers)
- Anyone who needs to record high-quality video calls for content creation
- Interviewers and hosts conducting remote recordings

**Key Differentiators:**
- Lower pricing with better free tier
- Simpler interface focused on essential features
- No feature bloat - just what you need

---

## User Personas

### Primary: Content Creator
- **Needs:** Record podcast/interview episodes with guests, download separate audio/video tracks for editing
- **Pain Points:** Existing solutions are too expensive, complicated features they don't use
- **Goals:** Create high-quality content affordably, easy to use without technical expertise

### Secondary: Guest Participant
- **Needs:** Join calls easily without creating an account, reliable audio/video experience
- **Pain Points:** Complex sign-up processes, technical difficulties joining calls
- **Goals:** Quick and seamless joining experience, good recording quality

---

## Product Scope

### Core Features

#### 1. Authentication & User Management
- Google OAuth sign-in only
- Guest access without account (name required only)
- User plans: FREE, PRO, STUDIO
- Profile management (name, email, avatar, preferences)

#### 2. Video Calling
- LiveKit-backed WebRTC video calls
- Real-time audio/video streaming
- Automatic bandwidth-based quality adjustment
- Pre-join screen with camera/mic preview and device selection
- Connection quality test before joining

#### 3. Room Management
- Create rooms with unique join codes
- Join via code (no password required)
- Host, co-host, and guest roles
- Waiting room (host approval before joining)
- Maximum participants per plan:
  - FREE: 2 participants
  - PRO: 4 participants
  - STUDIO: 10 participants

#### 4. In-Call Features

**Basic Controls:**
- Mute/unmute microphone
- Turn camera on/off
- Hang up / leave call
- Recording start/stop (host/co-host only)

**Host Controls:**
- Kick participants
- Mute other participants
- Promote participants to co-host
- End call for everyone

**Participant Features:**
- Participant list with status indicators
- Emoji reactions and raise hand
- Text chat (history saved and exportable, visible to host only in dashboard)
- Screen sharing (standard quality - 720p, optimized for presentations)

**Recording Indicator:**
- Always visible recording status
- All participants aware when recording is active

#### 5. Recording System

**Recording Capabilities:**
- Separate tracks: Each participant's video and audio recorded separately
- Combined tracks: All participants combined into single video
- Screen share recording: Captured along with participant tracks
- Multiple recording sessions per call (stop and start new sessions)

**Recording Quality Per Plan:**
- FREE: Up to 1080p
- PRO: Up to 4K
- STUDIO: Up to 4K

**Audio Quality Per Plan:**
- FREE: Standard (128 kbps)
- PRO: High quality (256 kbps)
- STUDIO: High quality (256 kbps)

**Recording Limits:**

*FREE Plan:*
- 1 hour multi-track recording (one-time)
- 5 hours single-track recording (per month)

*PRO Plan:*
- 8 hours multi-track recording (per month)
- 20 hours single-track recording (per month)

*STUDIO Plan:*
- 12 hours multi-track recording (per month)
- 20 hours single-track recording (per month)

**Processing:**
- Hybrid approach: Client records, server processes
- Target processing time: 15-30 minutes for 1 hour recording
- Instant preview of recordings available after processing

#### 6. Recording Output Formats

**Download Formats:**
- MP4 (video)
- MP3 (audio)
- WAV (audio)

**Output Types:**
- Separate video/audio tracks per participant
- Combined video with all participants
- Audio-only output
- Video-only output (no audio)
- Screen share recordings

**Export Options:**
- Download files individually
- Download all as ZIP
- Direct download links

**File Naming:**
- Auto-generated: timestamp + participant name

#### 7. Storage & Management

**Storage Duration Per Plan:**
- FREE: 14 days
- PRO: 30 days
- STUDIO: 6 months

**Guest Recording Access:**
- Guests cannot download or view recordings
- Only host has access to all recordings

**Recording Management:**
- Recording library in dashboard
- Search and filter recordings
- Delete recordings manually

#### 8. Dashboard

**Features:**
- Quick start call button
- Recent calls/recordings list
- Usage analytics (hours used, storage used)
- Recording library with preview
- Plan and billing information

#### 9. Profile & Settings

**Profile:**
- Basic information (name, email, avatar)
- Call preferences (default camera/mic selection)
- Plan & billing management
- Usage statistics

#### 10. Notifications

**Notification Types:**
- Email notifications only

**Notification Events:**
- Recording processing complete
- Storage/hours limit warning (approaching limit)
- Recordings expiring soon (before deletion)

---

## Technical Architecture

### Frontend
- Next.js 15 (App Router)
- React 19
- TypeScript
- Tailwind CSS
- LiveKit React/client SDK
- Socket.IO client for recording coordination
- MediaRecorder API for local recording

### Backend
- Node.js with Express
- TypeScript
- LiveKit server SDK for room and token management
- Socket.IO for recording coordination and upload progress
- Prisma ORM
- PostgreSQL database

### Infrastructure
- Cloud-hosted only (no self-hosting option)
- LiveKit SFU for media transport
- S3-compatible storage for recordings

### Recording Flow
1. Host starts recording via UI
2. Backend broadcasts "start recording" event to all participants
3. Each participant starts 3 MediaRecorders (video, audio, combined)
4. Recording chunks generated every 5 seconds
5. Chunks uploaded to server immediately
6. Segments tracked in database
7. Host stops recording via UI
8. Backend broadcasts "stop recording" event
9. All participants upload final chunks
10. Server processes recordings to create final outputs
11. Recordings available for preview and download

---

## User Flows

### New User Flow
1. User visits landing page
2. Clicks "Sign in with Google"
3. Authenticates via Google OAuth
4. Redirected to dashboard
5. User account auto-created with FREE plan

### Create & Join Call Flow

**Host:**
1. Click "Start New Call" from dashboard
2. Configure room settings (optional title/description)
3. Room created with unique join code
4. Pre-join screen (camera/mic preview, quality test, device selection)
5. Join room
6. Share join code with guests
7. Host starts recording when ready

**Guest:**
1. Receive join code from host
2. Visit join page and enter code
3. Enter name (no account required)
4. Wait in waiting room for host approval
5. Pre-join screen (camera/mic preview, quality test, device selection)
6. Join call
7. Participate in call (recording automatic if host started)

### Recording Flow
1. Host clicks "Start Recording"
2. All participants see recording indicator
3. Recording happens automatically for all participants
4. Host can stop/start new recording sessions during call
5. Host ends call
6. Recordings process on server (15-30 min for 1 hour)
7. Host receives email when processing complete
8. Host views recordings in dashboard
9. Host downloads individual tracks or all as ZIP

---

## Design Requirements

### UI/UX Principles
- Simple and clean interface
- Minimal clicks to start recording
- Clear visual feedback for all actions
- Responsive design (desktop-first, mobile-aware)
- Dark and light theme support
- Accessible (WCAG 2.1 AA compliance)

### Pre-Join Screen
- Large camera preview
- Device selection dropdowns (camera, mic, speaker)
- Connection quality indicator
- Visual/audio test button
- Clear "Join" button

### In-Call Interface
- Large video grid (4 participants per page with pagination)
- Bottom control bar with clear icons
- Recording indicator always visible (red dot + timer)
- Participant list in sidebar
- Chat sidebar (toggleable)
- Screen share takes center stage when active

### Dashboard
- Welcome banner with quick actions
- Recent recordings grid with thumbnails
- Usage statistics cards
- Simple navigation sidebar

---

## Success Metrics

### User Growth
- Monthly active users
- Sign-up conversion rate
- User retention rate (7-day, 30-day)

### Recording Usage
- Total recording hours per month
- Average recording duration
- Recording sessions per user
- Multi-track vs single-track usage

### Retention
- Repeat usage rate
- Average sessions per user per month
- Churn rate

### Conversion
- Free to paid conversion rate
- Upgrade rate (PRO to STUDIO)
- Revenue per user

### Quality
- Recording success rate
- Processing completion rate
- Average processing time
- User-reported quality issues

---

## Pricing

### Pricing Model
- Monthly subscriptions only
- Forever free plan with limits

### Plan Comparison

| Feature | FREE | PRO | STUDIO |
|---------|------|-----|--------|
| **Participants** | 2 | 4 | 10 |
| **Video Quality** | 1080p | 4K | 4K |
| **Audio Quality** | 128 kbps | 256 kbps | 256 kbps |
| **Multi-track Recording** | 1 hour (one-time) | 8 hours/month | 12 hours/month |
| **Single-track Recording** | 5 hours/month | 20 hours/month | 20 hours/month |
| **Storage Duration** | 14 days | 30 days | 6 months |
| **Screen Sharing** | ✓ | ✓ | ✓ |
| **Separate Tracks** | ✓ | ✓ | ✓ |
| **Reactions & Chat** | ✓ | ✓ | ✓ |
| **Waiting Room** | ✓ | ✓ | ✓ |
| **Priority Support** | - | ✓ | ✓ |

---

## Security & Privacy

### Authentication
- Google OAuth only
- Clerk Auth for token management
- JWT-based API authentication

### Room Security
- Unique join codes (not guessable)
- Waiting room for host approval
- Host can kick participants

### Data Privacy
- Recordings only accessible to host
- Guests have no access to recordings post-call
- Recordings auto-deleted after storage duration
- No recording sharing between users

### Data Storage
- Recordings stored in encrypted S3 buckets
- Database backups encrypted at rest
- Secure SSL/TLS for all communications

---

## Future Considerations

### Potential Future Features
- Call scheduling and calendar integration
- Email reminders for scheduled calls
- Calendar sync (Google Calendar, Outlook)

### Not Planned
- Live streaming to platforms
- AI features (transcription, editing)
- Recording templates/branding
- Team/organization workspaces
- Third-party integrations
- Mobile native apps
- Background blur/virtual backgrounds (not implementing now)

---

## Technical Constraints

### Performance
- LiveKit SFU-based media transport
- Bandwidth auto-adjustment for call quality
- Client-side recording with server processing

### Browser Support
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

### System Requirements
- Stable internet connection (minimum 2 Mbps upload/download)
- Modern computer (2019 or newer recommended)
- Microphone and camera

### Limitations
- No mobile browser support for recording (desktop only)
- No offline mode
- Recording quality dependent on participant's hardware/connection

---

## Risks & Mitigation

### Technical Risks

**Risk:** LiveKit media connection may fail on restricted networks
**Mitigation:** LiveKit reconnect handling, connection quality UI, clear error messages, TURN/ICE configuration

**Risk:** Client-side recording may fail or produce corrupted files
**Mitigation:** Chunked uploads with retry logic, segment tracking, checksum validation

**Risk:** Processing pipeline may take too long
**Mitigation:** Optimize ffmpeg processing, parallel processing, clear ETA communication

### Business Risks

**Risk:** Users exceed storage/bandwidth costs
**Mitigation:** Strict plan limits, auto-delete after storage duration, usage warnings

**Risk:** Free tier abuse
**Mitigation:** Rate limiting, one-time multi-track recording limit, email verification

**Risk:** Low conversion from free to paid
**Mitigation:** Clear value proposition, usage limit warnings, smooth upgrade flow

---

## Open Questions & Decisions Needed

### Technical Decisions
- [ ] Which S3-compatible storage provider (AWS S3, Cloudflare R2, etc.)
- [ ] Video processing tool (ffmpeg, cloud transcoding service)
- [ ] Email service provider (SendGrid, AWS SES, Resend)
- [ ] Payment processor (Stripe, Paddle)
- [ ] Hosting platform (Vercel, AWS, GCP, Railway)

### Product Decisions
- [ ] Specific pricing amounts ($X/month for PRO, $Y/month for STUDIO)
- [ ] Exact storage size limits (GB per plan)
- [ ] Connection quality thresholds for warnings
- [ ] Recording bitrate specifics for each plan

### UX Decisions
- [ ] Onboarding flow for first-time users
- [ ] Empty states for dashboard
- [ ] Error message copy and recovery flows
- [ ] Email notification templates

---

## Implementation Notes

### Current Implementation Status

**Completed:**
- Authentication system (Google OAuth via Clerk)
- Room creation and management
- Participant management (join, leave, roles, kick)
- LiveKit video calling foundation
- Socket.IO recording event coordination
- Pre-join screen with camera/mic preview
- In-call basic controls (mute, camera, leave)
- Recording system infrastructure (database models, API endpoints)
- Recording session management (start, stop, multiple sessions)
- Client-side MediaRecorder implementation (3 streams per participant)
- Recording segment tracking
- Dashboard basic structure
- Theme switching (dark/light)

**In Progress / TODO:**
- S3 upload service integration (chunk upload logic)
- Video processing pipeline (ffmpeg or transcoding service)
- Final output generation (merge tracks)
- Screen sharing implementation
- Chat system implementation (UI exists, functionality needed)
- Reactions and raise hand feature
- Waiting room functionality
- Host controls (mute others, promote to co-host)
- Recording library with preview
- Usage analytics tracking
- Plan & billing integration
- Email notification system
- Storage duration enforcement (auto-delete)
- Connection quality test
- Background blur (future consideration, not now)

### Technical Debt
- Implement proper error handling for recording failures
- Add retry logic for chunk uploads
- Optimize database queries for recording segments
- Add comprehensive logging and monitoring
- Implement rate limiting on API endpoints
- Add input validation and sanitization
- Write unit and integration tests

---

## Glossary

**Multi-track Recording:** Recording each participant's audio and video separately, allowing for individual editing and mixing in post-production.

**Single-track Recording:** Recording all participants combined into a single audio or video file.

**Space/Room:** A video call session where participants join using a unique code.

**Host:** The user who created the space/room and has full control.

**Co-host:** A participant promoted by the host with additional permissions (start/stop recording).

**Guest:** A participant without an account who joins using just a name.

**Recording Session:** A single continuous recording within a space. Multiple sessions can exist in one call if recording is stopped and started again.

**Segment:** A chunk of recording data (5 seconds) uploaded during recording.

**Final Output:** The processed and merged recording files ready for download.

**Rendition:** Different quality versions of a final output (e.g., 4K, 1080p, 720p).
