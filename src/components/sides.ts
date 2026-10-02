// The two players of a match each have a colour (Tino, 2 Oct 2026: "colour code the two players ...
// so that it's easier to view what the user is selecting"): player 1 blue, player 2 orange, from the
// brand tokens --p1 / --p2 (event_config.branding.colors.p1 / p2 can change them). Everything that
// belongs to a player wears their colour: the winner button, the set toggle, the chosen score, the
// scoreboard row. Full class names here so Tailwind keeps them.
export type Side = 1 | 2;

export const SIDE_COLOR = {
  1: {
    fill: "bg-p1 text-bg", // selected: the player's colour, dark text
    text: "text-p1",
    edge: "border-p1",
    dot: "bg-p1",
  },
  2: {
    fill: "bg-p2 text-bg",
    text: "text-p2",
    edge: "border-p2",
    dot: "bg-p2",
  },
} as const;
