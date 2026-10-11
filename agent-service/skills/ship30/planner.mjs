/**
 * Essay Structure Planner for Ship 30 for 30 Writing Skill.
 * Formulates a bounded 5-section narrative blueprint allocating word count budgets
 * and mapping verified transcript evidence chunks to designated sections.
 */

/**
 * Plans the 5-section narrative blueprint for a 1,250-word grounded essay.
 * @param {object} input - Sanitized skill input
 * @param {Array<object>} verifiedEvidence - Normalized transcript chunks
 * @returns {object} Structured essay plan
 */
export function createEssayPlan(input, verifiedEvidence = []) {
  const {
    topic,
    audience,
    intended_outcome,
    proven_approach = "framework",
    four_a_path = "actionable",
    target_word_count = 1250,
  } = input;

  // Allocate section word counts proportional to target
  // Total = 1,250 words across 5 sections
  const scale = target_word_count / 1250;
  const wordBudgets = {
    hook: Math.round(200 * scale),
    problem: Math.round(250 * scale),
    insights: Math.round(350 * scale),
    implications: Math.round(250 * scale),
    takeaway: Math.round(200 * scale),
  };

  // Group evidence by guest/speaker
  const guestsMentioned = Array.from(new Set(verifiedEvidence.map((p) => p.guest || p.speaker).filter(Boolean)));
  const primaryGuest = guestsMentioned[0] || "Lenny's Podcast Guest";

  // Distribute chunks across sections (insights get the majority, problem & implications get secondary)
  const chunkAllocations = {
    section1_hook: [],
    section2_problem: verifiedEvidence.slice(0, 1),
    section3_insights: verifiedEvidence.slice(1, 4).length > 0 ? verifiedEvidence.slice(1, 4) : verifiedEvidence,
    section4_implications: verifiedEvidence.slice(4, 6),
    section5_takeaway: [],
  };

  // Generate headline following Ship 30 Who/What/Why Curiosity Gap
  const headline = formatHeadline({
    topic,
    audience,
    intended_outcome,
    proven_approach,
    primaryGuest,
  });

  const sections = [
    {
      id: "section_1_hook",
      title: "Hook and the Counter-Intuitive Tension",
      targetWords: wordBudgets.hook,
      minWords: Math.round(wordBudgets.hook * 0.75),
      maxWords: Math.round(wordBudgets.hook * 1.25),
      maxTokens: Math.round(wordBudgets.hook * 1.9),
      rhythm: "1/5/1",
      purpose: "Hook the reader immediately. State WHO this is for and WHAT misconception is holding them back.",
      rules: [
        "Open with a sharp single-sentence hook.",
        "Establish the tension without fluff.",
        "Do not invent fake anecdotes; anchor in the product/growth reality.",
      ],
      assignedEvidence: chunkAllocations.section1_hook,
    },
    {
      id: "section_2_problem",
      title: "The Conventional Trap (The Tequila Test)",
      targetWords: wordBudgets.problem,
      minWords: Math.round(wordBudgets.problem * 0.8),
      maxWords: Math.round(wordBudgets.problem * 1.25),
      maxTokens: Math.round(wordBudgets.problem * 1.8),
      rhythm: "1/3/1 + 1/3/1",
      purpose: "Differentiate by attacking the cliché advice most teams follow.",
      rules: [
        "Explain why standard playbooks fail in practice.",
        "Use selective bolding on the core pivot.",
      ],
      assignedEvidence: chunkAllocations.section2_problem,
    },
    {
      id: "section_3_insights",
      title: "The Transcript-Backed Breakthrough",
      targetWords: wordBudgets.insights,
      minWords: Math.round(wordBudgets.insights * 0.8),
      maxWords: Math.round(wordBudgets.insights * 1.25),
      maxTokens: Math.round(wordBudgets.insights * 1.7),
      rhythm: "1/5/1",
      purpose: `Present the central framework directly from ${guestsMentioned.join(" & ") || "Lenny's Podcast"}.`,
      rules: [
        "Directly cite transcript evidence with compact tokens like [S1] or [chunk_id: <id>].",
        "Distinguish direct quotes from paraphrased principles.",
        "Highlight the counter-intuitive mechanic that drove success.",
      ],
      assignedEvidence: chunkAllocations.section3_insights,
    },
    {
      id: "section_4_implications",
      title: "From Philosophy to Tactical Execution",
      targetWords: wordBudgets.implications,
      minWords: Math.round(wordBudgets.implications * 0.8),
      maxWords: Math.round(wordBudgets.implications * 1.25),
      maxTokens: Math.round(wordBudgets.implications * 1.8),
      rhythm: "1/3/1",
      purpose: "Bridge high-level strategy to day-to-day product operations.",
      rules: [
        "Explain the 3 practical shifts a team must make.",
        "Use bullet points for skimmability.",
      ],
      assignedEvidence: chunkAllocations.section4_implications,
    },
    {
      id: "section_5_takeaway",
      title: "The Actionable Playbook and Checklist",
      targetWords: wordBudgets.takeaway,
      minWords: Math.round(wordBudgets.takeaway * 0.75),
      maxWords: Math.round(wordBudgets.takeaway * 1.25),
      maxTokens: Math.round(wordBudgets.takeaway * 1.9),
      rhythm: "1/3/1",
      purpose: "Leave the reader with an immediate diagnostic checklist or decision rule.",
      rules: [
        "Provide a concrete 4-part checklist or decision rule.",
        "End with a clear, memorable closing conviction.",
      ],
      assignedEvidence: chunkAllocations.section5_takeaway,
    },
  ];

  return {
    headline,
    topic,
    audience,
    intended_outcome,
    proven_approach,
    four_a_path,
    target_word_count,
    wordBudgets,
    guests: guestsMentioned,
    sections,
    allEvidence: verifiedEvidence,
  };
}

/**
 * Formulates a clear headline following Ship 30 principles:
 * Clear > Clever, specifies WHO, WHAT, and the PROMISE.
 */
function formatHeadline({ topic, audience, intended_outcome, proven_approach, primaryGuest }) {
  const cleanTopic = topic.replace(/[.?!]+$/, "").trim();
  const cleanAudience = audience.replace(/[.?!]+$/, "").trim();

  if (intended_outcome) {
    return `# The ${cleanAudience}'s Guide to ${cleanTopic}: How to ${intended_outcome}`;
  }

  return `# ${cleanTopic}: The ${cleanAudience}'s Playbook for Sustainable Growth`;
}
