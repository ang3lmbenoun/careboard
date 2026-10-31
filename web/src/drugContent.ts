export type DrugInfo = {
  name: string;
  tagline: string;
  how: string;
  usedFor: string;
  form: string;
  examples: string;
};

// General background for readers who are not clinicians. Not medical advice; no dosing.
export const DRUGS: Record<string, DrugInfo> = {
  "GLP-1": {
    name: "GLP-1 receptor agonists",
    tagline: "Medicines that copy a gut hormone called GLP-1.",
    how: "They help the pancreas release insulin when blood sugar is high, slow how quickly the stomach empties, and reduce appetite.",
    usedFor: "Type 2 diabetes. Some brands and doses are prescribed for weight management instead.",
    form: "Mostly weekly or daily injections; one is a daily tablet.",
    examples: "Semaglutide (Ozempic, Wegovy), dulaglutide (Trulicity), liraglutide (Victoza, Saxenda). Tirzepatide (Mounjaro, Zepbound) also acts on a second hormone, GIP, and is grouped with GLP-1 here.",
  },
  Metformin: {
    name: "Metformin",
    tagline: "Often the first medicine tried for type 2 diabetes.",
    how: "It reduces the sugar the liver releases and helps the body respond better to its own insulin.",
    usedFor: "Type 2 diabetes, and sometimes prediabetes.",
    form: "Tablet, taken by mouth.",
    examples: "Metformin, sold generically and under several brand names.",
  },
  "DPP-4": {
    name: "DPP-4 inhibitors",
    tagline: "Medicines that block an enzyme called DPP-4.",
    how: "The enzyme normally breaks down natural hormones that trigger insulin release. Blocking it lets those hormones work a little longer, so more insulin is released when blood sugar is high.",
    usedFor: "Type 2 diabetes, usually alongside other medicines. Effect on blood sugar is modest, and they do not usually change body weight.",
    form: "Daily tablet.",
    examples: "Sitagliptin (Januvia), linagliptin (Tradjenta).",
  },
  Insulin: {
    name: "Insulin",
    tagline: "The hormone that moves sugar from the blood into the body's cells.",
    how: "It replaces or tops up the insulin the body makes. Long-acting types give a steady background level, and rapid-acting types cover meals.",
    usedFor: "Used when the body does not make enough insulin or other medicines are not enough. Dosing is individual and set by a clinician.",
    form: "Injection or pump.",
    examples: "Insulin glargine (Lantus), insulin lispro (Humalog), insulin aspart (Novolog).",
  },
};

export const CLASS_ORDER = ["GLP-1", "Metformin", "DPP-4", "Insulin"];
