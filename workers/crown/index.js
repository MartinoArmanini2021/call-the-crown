// crown.grandslamgm.com, the official address of Call the Crown (15 Oct 2026). A Worker rather than a
// Pages custom domain because a Worker custom domain creates its own DNS record. It serves the
// production Pages site (six-kings-game.pages.dev, branch main) unchanged, so a Pages deploy to main is
// all it takes to update this address too.
const ORIGIN = "https://six-kings-game.pages.dev";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    return fetch(new Request(ORIGIN + url.pathname + url.search, request), { redirect: "manual" });
  },
};
