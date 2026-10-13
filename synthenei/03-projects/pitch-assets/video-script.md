# LAWSOME — 60-second product film: script and storyboard

**Files:** `lawsome-60s.mp4` is silent: 1920x1080, 30 fps, H.264 / yuv420p, 60.0 s, no audio track. `lawsome-60s-tamil.mp4` is the same picture with the Tamil voice-over (AAC 160k, loudness-normalised to -16 LUFS). Source: `video/` (Remotion).
**Use:** opening of tomorrow's LAWSOME meeting, the landing page and the email campaign. It plays silent: the on-screen captions tell the story. The voice-over lines are optional, for a live narrator or a future recorded track.
**Data:** every screen is the landing page's product replica with synthetic data. Raghavan Law Chambers is a fictional firm with offices in Egmore, Chennai and KK Nagar, Madurai. "Sample data · fictional firm" stays on screen for every product scene.

## Story arc
Problem: chasing lawyers for hearing updates. Then one clear view (dashboard), hearings and calendar, cases with a missing-date flag, the multi-site team, eCourts search and Ask Nidhi (labelled as research support). Ends on the CTA "Book a live demo".

## Storyboard

| Time | Scene | On-screen visual (landing screen / section) | Caption (≤ 8 words) | Optional voice-over |
|---|---|---|---|---|
| 0:00–0:04.5 | Cold open | Navy. Kinetic type, line by line. Small label: "Chennai · Egmore Office" | Hearing day, 9:40 am. / Three hearings. / Which lawyer is where? | "Hearing day. Three matters listed. And you're on the phone asking who is where." |
| 0:04.5–0:08 | Title | LAWSOME wordmark, a blue rule draws, headline reveal | Your entire law firm. One clear view. | "LAWSOME puts your whole firm in one view." |
| 0:08–0:16 | Dashboard | Landing **Dashboard** screen (section 01, Firm intelligence). The frame rises and the tilt settles flat. KPIs count up to 24 / 6 / 3 / 9 and the status bars fill. The growth line draws. The camera then pushes into the status bars and upcoming hearings | See the whole firm on one screen. | "Case volumes, status, upcoming hearings and both offices, on one screen." |
| 0:16–0:22 | Hearings & calendar | Landing **Calendar** screen (October 2026, section 02). It opens already cropped. Hearing, task and note chips appear in date order. The camera pushes into the week of 20 Oct and 20 Oct is outlined (Menon Estates vs Kumar Builders) | Hearings and tasks. One calendar. | "Hearings, tasks and notes sit together, so everyone knows what is coming." |
| 0:22–0:30 | Cases | Landing **Cases** table (section 03). A highlight moves down the rows and stops on *State vs Rajasekar*. Its "Hearing date missing" flag pulses once. The other missing-date flags light up as the camera pushes into the Next-hearing column | Spot matters with no hearing date. | "Every matter shows its owner and next hearing. The ones with no date stand out." |
| 0:30–0:36 | Multi-site team | **Sites** cards (Egmore Office 15 cases / 6 staff; Madurai Bench Office 9 / 3). The camera pulls back and the **Lawyers** cards stagger in (section 04) | Two offices. One firm. | "Two offices, one structure, clear roles for every lawyer and staff member." |
| 0:36–0:42 | eCourts | **eCourts** screen with the CNR Number tab (section 05). A 16-character CNR is typed, Search is pressed, the result row (Commercial Court, Chennai, PENDING) appears and the row is saved | Search eCourts by CNR number. | "Search court records by CNR, advocate, case number or party name, and save the case." |
| 0:42–0:51 | Ask Nidhi | **Ask Nidhi** panel, labelled "Illustrative conversation · sample data" (section 06). A property-dispute question, a typing indicator, then three answer sections: internal matches / external judgments for review / research summary. Side note: "Research support. Verify all sources." | Find related matters your firm handled. | "Describe a new matter. Ask Nidhi supports your research with related matters from your own records. Advocates verify every source." |
| 0:51–0:55.5 | Recap | Three pillars on paper white: Firm intelligence / Case & hearing control / AI-assisted research | One workspace for the whole firm. | — |
| 0:55.5–1:00 | End card | Navy. Wordmark, "Your entire law firm. One clear view.", white button "Book a live demo", footer "Product screens use sample data" | Book a live demo | "See it with your own firm's workflow. Book a live demo." |

## Claims check (per `01-strategy/lawsome-positioning.md`)
- Every screen shows a module that is in the current dev build: Dashboard, Calendar, Cases, Users, Sites, eCourts. Ask Nidhi is shown as an illustrative conversation. Before external use, replace it with a verified capture from the working build.
- The film makes no outcome, accuracy or time-saved claims. Ask Nidhi's only claim is "supports research" with "verify all sources". The external-judgments section shows no invented citations.
- Banned words (none appear): AI-powered, revolutionise, seamless, unlock.
- Data fixes made in the video's copy of the demo data (the landing is not changed; flag these to the landing owner): status counts now add up to the 24 total (Open 17 → 16), and two CNRs now use the real 16-character format.

## Re-render
```
cd synthenei/03-projects/pitch-assets/video
npm install
node render.mjs                 # renders, then writes ../lawsome-60s.mp4 (H.264 High, yuv420p, faststart)
node render.mjs frames          # QA stills every 2 s in out/frames/ (or: node render.mjs frames 390,820)
node deck.mjs && python3 crop.py out/deck-raw ../deck-screens   # deck PNGs
```
Scene boundaries are fixed at 0 / 4.5 / 8 / 16 / 22 / 30 / 36 / 42 / 51 / 55.5 / 60 s. The voice-over is timed to them, so don't change `S` in `Film.tsx` without re-timing the VO.

## Tamil voice-over
- Script: `voiceover-tamil.md` (ElevenLabs text in `voiceover-tamil-elevenlabs.txt`). Audio: `audio/vo-tamil.mp3`, one continuous take of 59.4 s whose pauses fall within about 1 s of the scene boundaries.
- Mux onto the silent film (run in `pitch-assets/`):
```
ffmpeg -y -i lawsome-60s.mp4 -i audio/vo-tamil.mp3 -filter_complex "[1:a]loudnorm=I=-16:TP=-1.5:LRA=7,afade=t=in:d=0.05,afade=t=out:st=59.0:d=0.4,aresample=48000,pan=stereo|c0=c0|c1=c0,volume=-2.3dB,apad=whole_dur=60[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 160k -shortest -movflags +faststart lawsome-60s-tamil.mp4
ffmpeg -i lawsome-60s-tamil.mp4 -af ebur128 -f null - 2>&1 | tail -12    # check: Integrated about -16 LUFS
```
- Per-scene clips (optional): put `video/audio/vo-01.wav` to `vo-10.wav` in place and `node render.mjs` places each one at its scene start + 0.2 s and renders with audio. With no clips it renders silent.
Timings live in `video/src/Film.tsx` (object `S`). Copy lives in each scene's `title` / `sub` props.

## Open items
- The silent cut has no music bed. The voiced cut is Tamil only; an English VO would need its own take.
- No URL on the end card until the landing page is deployed.
