# Share cards: checks only a real phone can do

The headless browser has no file sharing, so it only proved the fallback (download + copy). These
need a real phone, on the staging preview once it is deployed with this branch.

Use a test account that is in a league. Make a pick on an open match first; for "I called it" you
need a finished match where you picked the winner.

## iPhone, Safari

1. Picks → on the match card, tap **Share my call**. The card appears in the sheet.
2. Tap **Share my call** in the sheet. The iPhone share sheet opens straight away (no second tap).
3. Choose **WhatsApp** → a chat. The message carries the image and the text with
   `…/leagues?code=XXXXXX`.
4. Open that link on another phone (signed out): it opens the join flow with the code filled in.
5. Repeat 1–3 from the **Saved** message that shows after you save a pick.
6. Results → tap a finished match you called → **Share**. Same checks.
7. Switch the phone to Arabic (or use the language link on the home page) and repeat step 1: the
   card reads right to left, set 1 on the right, letters joined.
8. Share sheet → **Save Image**: the photo in Photos is sharp (1080×1350).

## Android, Chrome

Same steps 1–8. On step 2 the Android share sheet opens. If it does not offer files (older
Chrome), the app saves the image and copies the link instead and says "Image saved. Link copied.":
paste into WhatsApp and attach the saved image by hand.

## What to report back

For each phone: which step failed, and a screenshot.
