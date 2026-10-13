# Deck screens for Venkat

These are 2x PNGs of the LAWSOME product screens, each on a neutral #f6f7fb background with 64 px padding (128 device px). They are rendered from the same components as the landing page and the 60-second film, so all three look the same.

**All data is synthetic.** Raghavan Law Chambers, its offices, lawyers, parties, case numbers and CNRs are fictional. Every PNG already carries a small "Sample data · fictional firm" chip at the bottom right. Don't crop it out. Keep each slide's caption close to the one below.

| File | Caption to paste under it |
|---|---|
| `00-hero.png` | Your entire law firm. One clear view: the LAWSOME landing hero. |
| `01-dashboard.png` | One dashboard for the firm: case volumes, status mix, upcoming hearings, growth and sites. |
| `02-calendar.png` | Hearings, tasks and notes together in one monthly calendar. |
| `03-hearings.png` | Hearing list for this site (Egmore Office), with court, status, assigned lawyer and purpose. |
| `04-cases.png` | Every matter shows its owner and next hearing, and "Hearing date missing" flags the gaps. |
| `05-sites.png` | Multi-site firms: each office has its own cases, lawyers and clients. |
| `06-team.png` | Lawyers and staff across sites, with roles and access managed in one place. |
| `07-ecourts.png` | Search court records by CNR, advocate, case number or party name across Supreme, High and District Courts. |
| `08-ask-nidhi.png` | Ask Nidhi supports legal research: related matters from your own records, plus external judgments for the advocate to review. Illustrative conversation. |

Notes
- eCourts (`07`): the product notes (`03-projects/lawsome-product.md`) record Supreme, High and District Courts in the dev build. Krishna should confirm before the deck goes out.
- Ask Nidhi (`08`) is an illustrative conversation, not a capture from the build. Before the deck goes outside the room, replace it with a verified capture from the working build. Never add citations we have not checked.
- In these renders the case-status counts add up to the 24-case total (Open 16). The landing page still shows Open 17; that is flagged for a fix.
- Regenerate: `cd ../video && node deck.mjs && python3 crop.py out/deck-raw ../deck-screens`.
