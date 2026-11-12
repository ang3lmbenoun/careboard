// Clinical scope guard. CareBoard reports on spend, no shows and risk; it does not diagnose, prescribe, dose or recommend a
// medication change. A question that asks for any of those is refused BEFORE any model call or tool call, so the refusal
// cannot be argued away by supplying more detail, and a patient identifier is never requested to "help" with it.
// This is a first line of defence in plain code. The model's instructions say the same thing, but a rule is not persuadable.

const MED = "(drugs?|medications?|medicines?|insulin|metformin|glp-?1s?|semaglutide|ozempic|wegovy|dulaglutide|trulicity|sitagliptin|januvia|sglt-?2s?|dpp-?4s?|statins?|therap(?:y|ies)|treatments?)";
const RULES: RegExp[] = [
  /\b(dose|doses|dosage|dosing|prescrib\w*|titrat\w*)\b/i,
  new RegExp(`\\b(?:put|place|start|keep|leave)\\b.{0,40}\\bon\\b.{0,20}\\b${MED}\\b`, "i"),
  /\bhow (?:much|many) (?:units?|mg|mcg|ml|pills?|tablets?)\b/i,
  /\bunits? of\b/i,
  /\bdiagnos\w*/i,
  /\bis (?:patient )?#?\d+ (?:diabetic|prediabetic|pre-diabetic|sick|ill)\b/i,
  new RegExp(`\\b(?:switch|change|move|transition|put|swap)\\b.{0,60}\\b(?:to|onto|from|off)\\b.{0,50}\\b${MED}\\b`, "i"),
  new RegExp(`\\bwhich ${MED}\\b.{0,60}\\b(?:should|best|better|recommend\\w*|ideal|right)\\b`, "i"),
  new RegExp(`\\b${MED}\\b.{0,60}\\b(?:should|would you recommend|do you recommend)\\b`, "i"),
  new RegExp(`\\bshould\\b.{0,80}\\b(?:stop|start|begin|discontinue|quit|take|taking|switch|increase|decrease|reduce)\\b.{0,60}\\b${MED}\\b`, "i"),
  new RegExp(`\\b(?:stop|start|discontinue|increase|decrease|reduce)\\b.{0,40}\\b${MED}\\b.{0,40}\\b(?:for|in) (?:patients?|them|him|her)\\b`, "i"),
  /\bbetter outcomes?\b.{0,60}\b(?:drug|medication|treatment|insulin)/i,
  /\bwhat (?:should|can) (?:i|we) (?:give|prescribe|treat)\b/i,
];

export const OUT_OF_SCOPE =
  "I can't diagnose a patient, prescribe or dose a medication, or recommend a change in treatment. Those decisions belong to the treating clinician. " +
  "I can show spend, no show and risk reports, or draft a follow up call list for a person to approve.";

export const outOfScope = (question: string): boolean => {
  const q = question.replace(/[‘’]/g, "'");
  return RULES.some((r) => r.test(q));
};
