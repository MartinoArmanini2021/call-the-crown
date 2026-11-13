// Player photos: Wikimedia Commons, free licences, each credited where the photos appear (Tino,
// 17 Oct 2026, "wikimedia yes"; ATP stopped serving its headshots to other sites in mid-October).
// Hotlinked 500 px thumbnails, never re-hosted. The event's players.image_path points at the same
// thumbnails; this list says who took each one and under which licence. Credits read from the
// Commons file pages (13 Nov 2026 for the ATP Finals eight).
const W = "https://thumb.wikimedia.org/wikipedia/commons/thumb/";
const FILE = "https://commons.wikimedia.org/wiki/File:";
const BY_SA_4 = {
  licence: "CC BY-SA 4.0",
  licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
};
const BY_SA_2 = {
  licence: "CC BY-SA 2.0",
  licenceUrl: "https://creativecommons.org/licenses/by-sa/2.0/",
};

export type PhotoCredit = {
  photo: string;
  by: string;
  file: string;
  licence: string;
  licenceUrl: string;
};

export const PHOTO_CREDITS: Record<string, PhotoCredit> = {
  alcaraz: {
    photo:
      W +
      "d/d4/25th_Laureus_World_Sports_Awards_-_Red_Carpet_-_Carlos_Alcaraz_-_240422_192324_%28cropped%29.jpg/500px-25th_Laureus_World_Sports_Awards_-_Red_Carpet_-_Carlos_Alcaraz_-_240422_192324_%28cropped%29.jpg",
    by: "Barcex",
    file:
      FILE +
      "25th_Laureus_World_Sports_Awards_-_Red_Carpet_-_Carlos_Alcaraz_-_240422_192324_(cropped).jpg",
    ...BY_SA_4,
  },
  zverev: {
    photo: W + "1/1d/Alexander_Zverev_%28cropped%29.jpg/500px-Alexander_Zverev_%28cropped%29.jpg",
    by: "Rick Munroe",
    file: FILE + "Alexander_Zverev_(cropped).jpg",
    ...BY_SA_4,
  },
  shelton: {
    photo:
      W +
      "1/1b/Ben_Shelton%2C_media_conference%2C_Swiss_Indoors_Basel_2025_%28cropped%29.jpg/500px-Ben_Shelton%2C_media_conference%2C_Swiss_Indoors_Basel_2025_%28cropped%29.jpg",
    by: "Peter Arnold",
    file: FILE + "Ben_Shelton,_media_conference,_Swiss_Indoors_Basel_2025_(cropped).jpg",
    ...BY_SA_4,
  },
  medvedev: {
    photo:
      W +
      "3/30/Danill_Medvedev_Miami_2019_%28cropped%29.jpg/500px-Danill_Medvedev_Miami_2019_%28cropped%29.jpg",
    by: "LacosteWiki",
    file: FILE + "Danill_Medvedev_Miami_2019_(cropped).jpg",
    ...BY_SA_4,
  },
  cobolli: {
    photo: W + "5/53/Cobolli_RGQ23_%2852944096963%29.jpg/500px-Cobolli_RGQ23_%2852944096963%29.jpg",
    by: "si.robi",
    file: FILE + "Cobolli_RGQ23_(52944096963).jpg",
    ...BY_SA_2,
  },
  fils: {
    photo: W + "8/89/Fils_BOR22_%2852083970501%29.jpg/500px-Fils_BOR22_%2852083970501%29.jpg",
    by: "si.robi",
    file: FILE + "Fils_BOR22_(52083970501).jpg",
    ...BY_SA_2,
  },
  tiafoe: {
    photo: W + "a/a3/FrancesTiafo.jpg/500px-FrancesTiafo.jpg",
    by: "Rickmunroe01",
    file: FILE + "FrancesTiafo.jpg",
    ...BY_SA_4,
  },
  jodar: {
    photo:
      W +
      "e/e4/Rafael_J%C3%B3dar_Roland_Garros_2026_%28cropped%29.jpg/500px-Rafael_J%C3%B3dar_Roland_Garros_2026_%28cropped%29.jpg",
    by: "Crosscourt View",
    file: FILE + "Rafael_Jódar_Roland_Garros_2026_(cropped).jpg",
    ...BY_SA_4,
  },
  // Riyadh field (17 Oct 2026)
  djokovic: {
    photo:
      W +
      "d/d1/Novak_Djokovic_Paris_2024_Olympic_Games_%28cropped%29.jpg/500px-Novak_Djokovic_Paris_2024_Olympic_Games_%28cropped%29.jpg",
    by: "Andymiah",
    file: FILE + "Novak_Djokovic_Paris_2024_Olympic_Games_(cropped).jpg",
    ...BY_SA_4,
  },
  deminaur: {
    photo: W + "1/13/Alex_de_Minaur_2024.jpg/500px-Alex_de_Minaur_2024.jpg",
    by: "Barcex",
    file: FILE + "Alex_de_Minaur_2024.jpg",
    ...BY_SA_4,
  },
  fritz: {
    photo:
      W +
      "6/61/Taylor_Fritz_-_Delray_Beach_Open_Final_Round_%28cropped%29.jpg/500px-Taylor_Fritz_-_Delray_Beach_Open_Final_Round_%28cropped%29.jpg",
    by: "Rickmunroe01",
    file: FILE + "Taylor_Fritz_-_Delray_Beach_Open_Final_Round_(cropped).jpg",
    ...BY_SA_4,
  },
  tien: {
    photo:
      W +
      "c/c8/Learner_Tien_%282024_US_Open%29_04.jpg/500px-Learner_Tien_%282024_US_Open%29_04.jpg",
    by: "Hameltion",
    file: FILE + "Learner_Tien_(2024_US_Open)_04.jpg",
    ...BY_SA_4,
  },
};
