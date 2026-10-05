// The share cards on screen (brief "bragging rights", Phase 3): a button that opens a sheet with the
// card as an image and one Share button. The card is drawn when the sheet opens, so the tap on Share
// goes straight to the phone's share sheet (iPhone Safari only allows it straight after a tap).
// Phones that can share files get the PNG and the text; anything else downloads the PNG and copies
// the text. Analytics: call_card_opened and call_card_shared, no personal data.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useEvent } from "@/config/eventConfig";
import { useGame } from "@/hooks/useGame";
import { useT } from "@/i18n/useT";
import { track } from "@/lib/analytics";
import { badgesQuery, inLocale, myCallStatsQuery, myLeaguesQuery } from "@/lib/api";
import { cardPng, cardSpec, nightOf, type CardKind } from "@/lib/callCard";
import { scoreLine, surname } from "@/lib/format";
import { inviteLink } from "@/lib/leagueIntent";
import { cn } from "@/lib/utils";
import { activeLeague } from "./LeagueNudge";
import { playerName } from "./Brand";
import { useMatchNames } from "./matchNames";

const canShareFiles = () => {
  try {
    const probe = new File([new Blob()], "x.png", { type: "image/png" });
    return !!navigator.canShare?.({ files: [probe] });
  } catch {
    return false;
  }
};

export function ShareCallButton({
  kind,
  matchNo,
  className,
}: {
  kind: CardKind;
  matchNo: number;
  className?: string;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "focus-ring rounded-full border border-gold/50 px-4 py-2 text-xs font-bold text-gold",
          className,
        )}
      >
        {kind === "my_call" ? t("share_my_call") : t("share")}
      </button>
      {open && <CallCardSheet kind={kind} matchNo={matchNo} onClose={() => setOpen(false)} />}
    </>
  );
}

export function CallCardSheet({
  kind,
  matchNo,
  onClose,
}: {
  kind: CardKind;
  matchNo: number;
  onClose: () => void;
}) {
  const { t, locale } = useT();
  const event = useEvent();
  const { user, matches, byPlayer, pickByMatch } = useGame();
  const leagues = useQuery({ ...myLeaguesQuery(user?.id ?? ""), enabled: !!user });
  const { title } = useMatchNames(byPlayer);
  const all = matches.data ?? [];
  const match = all.find((m) => m.match_no === matchNo);
  const pick = pickByMatch.get(matchNo);
  const badges = useQuery({
    ...badgesQuery(user?.id ?? ""),
    enabled: kind === "called_it" && !!user,
  });
  const stats = useQuery({
    ...myCallStatsQuery(matchNo),
    enabled: kind === "called_it" && !!user,
  });
  const [png, setPng] = useState<{ blob: Blob; url: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const method = canShareFiles() ? "share" : "download";

  const league = user && leagues.data ? activeLeague(user.id, leagues.data) : undefined;
  const ready =
    !!match &&
    !!pick &&
    leagues.isFetched &&
    (kind === "my_call" || (stats.isFetched && badges.isFetched));
  const url = league ? inviteLink(league.code) : window.location.origin;

  useEffect(() => {
    if (!ready || !match || !pick) return;
    let gone = false;
    let made: string | null = null;
    const names = [1, 2].map((s) =>
      surname(playerName(byPlayer.get((s === 1 ? match.p1_id : match.p2_id) ?? ""), locale)),
    ) as [string, string];
    const spec = cardSpec({
      kind,
      match,
      matches: all,
      pick,
      names,
      locale,
      t,
      timezone: event.timezone,
      brand: (
        inLocale(event.branding, "short_name", locale) ??
        inLocale(event.branding, "app_name", locale) ??
        event.name
      ).split(" "),
      stats: stats.data ?? null,
      perfect:
        kind === "called_it" &&
        (badges.data ?? []).some(
          (b) => b.perfect && b.night_no === nightOf(match, all, event.timezone),
        ),
      code: league?.code ?? null,
      host: window.location.host,
    });
    cardPng(spec).then(
      (blob) => {
        if (gone) return;
        made = URL.createObjectURL(blob);
        setPng({ blob, url: made });
        track("call_card_opened", { kind, match_no: matchNo, method, locale });
      },
      () => !gone && setFailed(true),
    );
    return () => {
      gone = true;
      if (made) URL.revokeObjectURL(made);
    };
    // drawn once per opening: the data is settled by the time `ready` turns true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  useEffect(() => {
    if (png) panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [png]);

  if (!match) return null;
  const text =
    kind === "my_call"
      ? t("share_text_my_call", { match: title(match, all), url })
      : t("share_text_called", {
          score: `${title(match, all)} ${scoreLine(match.set_scores).replace(/ +/g, " ")}`,
          url,
        });

  async function share() {
    if (!png) return;
    const file = new File([png.blob], `call-the-crown-${kind}-${matchNo}.png`, {
      type: "image/png",
    });
    if (method === "share") {
      try {
        await navigator.share({ files: [file], text });
        track("call_card_shared", { kind, match_no: matchNo, method, locale });
      } catch {
        /* the fan closed the share sheet */
      }
      return;
    }
    const a = document.createElement("a");
    a.href = png.url;
    a.download = file.name;
    a.click();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard refused: the image is still saved */
    }
    setNotice(t("share_fallback"));
    track("call_card_shared", { kind, match_no: matchNo, method, locale });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" role="presentation">
      <button
        type="button"
        aria-label={t("close")}
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={kind === "my_call" ? t("share_my_call") : t("share")}
        className="safe-bottom relative w-full max-w-xl space-y-3 rounded-t-3xl border-t border-line bg-card px-4 pb-4 pt-4"
      >
        <div className="mx-auto aspect-[4/5] w-full max-w-[19rem] overflow-hidden rounded-2xl border border-line bg-bg">
          {png ? (
            <img
              src={png.url}
              alt={text}
              className="h-full w-full"
              data-card-bytes={png.blob.size}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-ink-3">
              {failed ? t("err_generic") : "…"}
            </div>
          )}
        </div>
        {notice && (
          <p role="status" className="text-center text-sm font-semibold text-good">
            {notice}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            data-autofocus=""
            disabled={!png}
            onClick={share}
            className="focus-ring h-11 flex-1 rounded-full bg-gold text-sm font-bold text-bg disabled:opacity-40"
          >
            {kind === "my_call" ? t("share_my_call") : t("share")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring h-11 shrink-0 rounded-full bg-raised px-5 text-sm font-semibold"
          >
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}
