# LAWSOME 60s film — Tamil voice-over script

For generating the voice-over with a text-to-speech (TTS) tool. Timings match the scene boundaries in `video/src/Film.tsx` (object `S`). Register: spoken Chennai Tamil, with the English words lawyers actually use (case, hearing, CNR, dashboard) left in English. Brand name: say **"லாஸம்" (LAW-some)**.

| # | Time (dur) | Scene | Tamil voice-over (TTS input) |
|---|---|---|---|
| 01 | 0:00–0:04.5 (4.5s) | Cold open | ஹியரிங் நாள். காலை ஒன்பது நாற்பது. மூணு ஹியரிங். எந்த வக்கீல் எங்க இருக்காங்க? |
| 02 | 0:04.5–0:08 (3.5s) | Title | லாஸம். உங்க முழு லா ஃபர்மும், ஒரே பார்வையில். |
| 03 | 0:08–0:16 (8s) | Dashboard | எத்தனை கேஸ், எந்த ஸ்டேட்டஸ், வரப்போற ஹியரிங்ஸ், ரெண்டு ஆபீஸும்... எல்லாமே ஒரே ஸ்க்ரீன்ல. |
| 04 | 0:16–0:22 (6s) | Calendar | ஹியரிங்ஸ், டாஸ்க்ஸ், நோட்ஸ், எல்லாம் ஒரே காலண்டர்ல. அடுத்து என்ன வருதுன்னு எல்லாருக்கும் தெரியும். |
| 05 | 0:22–0:30 (8s) | Cases | ஒவ்வொரு கேஸுக்கும் யார் பொறுப்பு, அடுத்த ஹியரிங் எப்போன்னு தெளிவா தெரியும். ஹியரிங் தேதி இல்லாத கேஸ்கள் உடனே கண்ணுல படும். |
| 06 | 0:30–0:36 (6s) | Team & sites | ரெண்டு ஆபீஸ், ஒரே ஃபர்ம். ஒவ்வொரு வக்கீலுக்கும், ஸ்டாஃபுக்கும் தெளிவான ரோல். |
| 07 | 0:36–0:42 (6s) | eCourts | CNR நம்பர், அட்வகேட் பேர், இல்லன்னா பார்ட்டி பேர் வெச்சு கோர்ட் ரெக்கார்ட்ஸ் தேடி, சேவ் பண்ணலாம். |
| 08 | 0:42–0:51 (9s) | Ask Nidhi | புது கேஸ் வந்திருக்கா? Ask Nidhi-கிட்ட சொல்லுங்க. உங்க ஃபர்ம் முன்னாடி பார்த்த தொடர்புடைய கேஸ்களை எடுத்துக் காட்டும். இது ரிசர்ச்சுக்கு ஒரு உதவி தான்; ஒவ்வொரு சோர்ஸையும் வக்கீல் சரிபார்க்கணும். |
| 09 | 0:51–0:55.5 (4.5s) | Recap | முழு ஃபர்முக்கும், ஒரே வொர்க்ஸ்பேஸ். |
| 10 | 0:55.5–1:00 (4.5s) | End card | உங்க ஃபர்ம் வேலை செய்யற முறையிலேயே பாருங்க. லைவ் டெமோ புக் பண்ணுங்க. |

## Generation notes
- **Voice:** calm, confident, warm; mid-30s; neutral Chennai accent. Not a "radio ad" voice.
- **Pace:** unhurried, about 130–140 words per minute. Lines 05 and 08 are the longest. If they overrun, speed up 5–8%, or drop "தெளிவா" (05) or "இது" (08).
- **Pronunciation:** LAWSOME = "லாஸம்". Ask Nidhi = "ஆஸ்க் நிதி". CNR = "சி-என்-ஆர்" (spell it out).
- **Files:** generate one clip per line, named `vo-01.wav` … `vo-10.wav` (48 kHz WAV, or high-bitrate MP3). Each clip should start about 0.2 s after its scene starts, with no long silence at either end.
- **Loudness:** about −16 LUFS integrated. Send the clips back and they can be placed on the timeline and muxed into `lawsome-60s.mp4`.
- **Claims:** line 08 must keep "ரிசர்ச்சுக்கு ஒரு உதவி தான்; ஒவ்வொரு சோர்ஸையும் வக்கீல் சரிபார்க்கணும்" (it is research support; the advocate verifies every source). It matches the on-screen label and the claims policy, so don't cut it.

## English reference (what each line means)
01 Hearing day. 9:40 am. Three hearings. Which lawyer is where? · 02 LAWSOME. Your entire law firm, in one view. · 03 How many cases, which status, upcoming hearings, both offices: all on one screen. · 04 Hearings, tasks, notes, all in one calendar. Everyone knows what's coming. · 05 For every case you can see who's responsible and when the next hearing is. Cases with no hearing date stand out. · 06 Two offices, one firm. Clear roles for every lawyer and staff member. · 07 Search court records by CNR number, advocate or party name, and save them. · 08 Got a new case? Tell Ask Nidhi. It surfaces related cases your firm has handled. It's research support; the advocate verifies every source. · 09 One workspace for the whole firm. · 10 See it in the way your firm works. Book a live demo.
