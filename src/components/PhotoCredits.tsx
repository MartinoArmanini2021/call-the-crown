// Photo credits for the Wikimedia Commons player photos (src/lib/photoCredits.ts), shown on the vote
// page and on How to play.
import { PHOTO_CREDITS } from "@/lib/photoCredits";
/** "Name: photographer, licence", each linking to the Commons file and the licence. */
export function PhotoCreditList({ ids, names }: { ids: string[]; names: Map<string, string> }) {
  return (
    <ul className="mt-1 space-y-0.5">
      {ids
        .filter((id) => PHOTO_CREDITS[id])
        .map((id) => {
          const c = PHOTO_CREDITS[id]!;
          return (
            <li key={id}>
              <a className="underline" href={c.file} rel="noopener noreferrer" target="_blank">
                {names.get(id) ?? id}
              </a>
              : {c.by},{" "}
              <a
                className="underline"
                href={c.licenceUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                {c.licence}
              </a>
            </li>
          );
        })}
    </ul>
  );
}
