/**
 * Character creation random tables (OH p.23-31, 174-181). Summarised.
 */

export const FEATURES = {
  eyes: ["Green", "Blue", "Brown", "Hazel", "Grey", "Heterochromia"],
  hair: ["Blond", "Black", "Brown", "Auburn", "Red", "Grey"],
  scars: ["Cut across eye", "Burned hand", "Missing part of ear", "Split lip", "Broken nose", "Scar on neck"],
  tattoos: ["Pentagram", "Angel", "Tentacles", "Band name", "Ex's name", "Significant number"],
  affectations: ["Plays with hair/beard", "Flips a coin to decide", "Bites nails", "Nervous laugh", "Frequent snacker", "Constant pop-culture references"]
};

/** Age: 3d6 + 15. */
export const AGE_FORMULA = "3d6 + 15";

export const GOAL_EXAMPLES = {
  short: [
    "Finally finish that Gantt chart", "Be on time for three weeks straight",
    "Book leave during the school holidays", "Stop throwing up when Security appears",
    "Find out who keeps using your mug"
  ],
  long: [
    "Get promoted into senior management", "Prove yourself as a field operative",
    "Land a nice, safe desk job", "Buy your own place to live", "Survive CASE NIGHTMARE GREEN"
  ]
};

const t = (dice, rows) => ({ dice, rows });

/** Inductee Questionnaire (OH p.174-181). rows: [min, max, text] */
export const QUESTIONNAIRE = [
  { key: "origin", q: "Place of origin — where are you from?", table: t("2d6", [
    [2, 2, "London (borough, nearest tube station)"], [3, 3, "Manchester"], [4, 4, "Glasgow"], [5, 5, "Birmingham"],
    [6, 6, "Cardiff"], [7, 7, "Nottingham"], [8, 8, "Liverpool"], [9, 9, "Edinburgh"], [10, 10, "A small town"],
    [11, 11, "Overseas (how did you relocate?)"], [12, 12, "Other"]]) },
  { key: "personality", q: "Personality profile — what are you like?", table: t("2d6", [
    [2, 2, "Solves problems with force (and percussive maintenance)"], [3, 3, "Obsessed with mastering a practical craft"],
    [4, 4, "Brains over brawn — outsmart the opposition"], [5, 5, "A natural leader"],
    [6, 6, "Prefers someone else to solve the problem"], [7, 7, "Avoids conflict; the peacemaker"],
    [8, 8, "Curious — about things and other people's secrets"], [9, 9, "Sets impossible challenges for themself"],
    [10, 10, "Enthusiastic and keen (for now)"], [11, 11, "Quiet and thoughtful"], [12, 12, "Other"]]) },
  { key: "education", q: "Educational background", table: t("2d6", [
    [2, 2, "Left school early (why?)"], [3, 3, "Left after A-levels"], [4, 4, "Certificate of Higher Education / HNC"],
    [5, 5, "HND / DipHE"], [6, 6, "Vocational foundation degree"], [7, 7, "Bachelor's degree"], [8, 8, "Master's degree"],
    [9, 9, "Doctorate — call me Doctor"], [10, 10, "Work qualifications (NVQ, BTEC)"], [11, 11, "Evening classes / Open University"], [12, 12, "Other"]]) },
  { key: "experience", q: "Prior experience — what did you do before?", table: t("3d6", [
    [3, 3, "Medical doctor"], [4, 4, "Police officer / detective"], [5, 5, "Lawyer"], [6, 6, "Customer services"], [7, 7, "Military"],
    [8, 8, "Crafts / arts / writer"], [9, 9, "Student"], [10, 10, "Engineer / technician"], [11, 11, "Clerical / office worker"],
    [12, 12, "Scientist"], [13, 13, "Teacher / professor"], [14, 14, "Programmer / repair / hacker"], [15, 15, "Journalist"],
    [16, 16, "Skilled manual work"], [17, 17, "Librarian / archivist / researcher"], [18, 18, "Other"]]) },
  { key: "event", q: "Instigating event — how were you recruited?", table: t("2d6", [
    [2, 2, "A friend or relative already works here and recommended you"], [3, 3, "Your project nearly breached reality"],
    [4, 4, "An operative met you on assignment and asked for help"], [5, 5, "Someone close became possessed / infected / undead"],
    [6, 6, "Your mentor was secretly a cultist"], [7, 7, "Abducted by a cult, rescued before the sacrifice"],
    [8, 8, "Headhunted for your skills"], [9, 9, "You told your doctor about dreams of a strange pyramid"],
    [10, 10, "Your conspiracy blog got too close to the truth"], [11, 11, "You saw through the wards and demanded a job"], [12, 12, "Other"]]) },
  { key: "associates", q: "Known associates — who are your friends?", table: t("2d6", [
    [2, 2, "Spouse / partner"], [3, 3, "Siblings"], [4, 4, "Parents"], [5, 5, "Only distant friends"], [6, 6, "A close friend you see weekly"],
    [7, 7, "A friendly neighbour"], [8, 8, "A former partner"], [9, 9, "A close (former) colleague"],
    [10, 10, "A club or gaming group"], [11, 11, "Nobody (why?)"], [12, 12, "Other"]]) },
  { key: "conflicts", q: "Potential conflicts — who don't you get on with?", table: t("1d6", [
    [1, 1, "A boss"], [2, 2, "A neighbour"], [3, 3, "A relative"], [4, 4, "An authority figure"], [5, 5, "A work colleague"], [6, 6, "Other"]]) },
  { key: "secret", q: "Secrets — what does nobody else know?", table: t("2d6", [
    [2, 2, "You are dangerous and prone to violence"], [3, 3, "A devout faith"], [4, 4, "In love with a workmate"],
    [5, 5, "Your motives here are not honest"], [6, 6, "You love uncovering secrets"], [7, 7, "You hate rules"],
    [8, 8, "You had your former boss arrested"], [9, 9, "You were once in a cult or secret society"],
    [10, 10, "You stole something important"], [11, 11, "Someone close vanished and was never found"], [12, 12, "Other"]]) },
  { key: "fear", q: "Fears — what is your worst fear?", table: t("1d6", [
    [1, 1, "The dark"], [2, 2, "An animal or insect"], [3, 3, "Crowds or solitude"], [4, 4, "Open or enclosed spaces"], [5, 5, "Success or failure"], [6, 6, "Other"]]) },
  { key: "want", q: "What do you want most?", table: t("1d6", [
    [1, 1, "Money"], [2, 2, "Security"], [3, 3, "Family"], [4, 4, "Promotion"], [5, 5, "Knowledge"], [6, 6, "Other"]]) }
];

export function lookupRow(rows, total) {
  return rows.find(([min, max]) => total >= min && total <= max)?.[2] ?? "";
}
