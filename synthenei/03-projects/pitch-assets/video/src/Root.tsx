import { Composition } from "remotion";
import { LawsomeFilm, TOTAL } from "./Film";
import { DeckStill } from "./Deck";

export const Root = () => (
  <>
    <Composition id="Lawsome60" component={LawsomeFilm} durationInFrames={TOTAL} fps={30} width={1920} height={1080} defaultProps={{ vo: [] as boolean[] }} />
    <Composition id="DeckStill" component={DeckStill as any} durationInFrames={1} fps={30} width={1400} height={1500} defaultProps={{ id: "01-dashboard" }} />
  </>
);
