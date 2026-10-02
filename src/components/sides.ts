// The two players of a match each have a colour (Tino, 2 Oct 2026: "colour code the two players ...
// so that it's easier to view what the user is selecting", then "sleeker"): player 1 sky blue,
// player 2 amber, from the brand tokens --p1 / --p2 (event_config.branding.colors.p1 / p2 can change
// them). Colour is an accent, never a fill: what you chose is a soft tint with a thin outline and
// coloured text; a dot or a hairline marks whose is whose. Full class names here so Tailwind keeps them.
export type Side = 1 | 2;

export const SIDE_COLOR = {
  1: {
    chosen: "bg-p1/15 text-p1 ring-1 ring-inset ring-p1/60",
    text: "text-p1",
    line: "border-p1",
    dot: "bg-p1",
  },
  2: {
    chosen: "bg-p2/15 text-p2 ring-1 ring-inset ring-p2/60",
    text: "text-p2",
    line: "border-p2",
    dot: "bg-p2",
  },
} as const;
