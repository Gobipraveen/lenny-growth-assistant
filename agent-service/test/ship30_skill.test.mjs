import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  validateSkillInput,
  normalizeEvidence,
  createEssayPlan,
  buildGenerationPrompt,
  buildSectionPrompt,
  validateEssay,
  countWords,
  assembleEssaySections,
  executeSkillWorkflow,
  registerShip30PiTool,
  ESSAY_DEFAULTS,
} from "../skills/ship30/index.mjs";

describe("Ship 30 for 30 Skill — Input & Evidence Contracts", () => {
  it("validates correct input successfully", () => {
    const input = {
      topic: "B2B SaaS Pricing Tiers",
      audience: "Seed Founders",
      intended_outcome: "Pick value metric tiers",
      proven_approach: "framework",
      four_a_path: "actionable",
      target_word_count: 1250,
      verified_evidence: [
        {
          chunk_id: "chunk-abc-123",
          episode_title: "Patrick Campbell on Pricing",
          guest: "Patrick Campbell",
          content: "Most founders pick the wrong value metric.",
        },
      ],
    };

    const res = validateSkillInput(input);
    assert.equal(res.isValid, true);
    assert.equal(res.errors.length, 0);
    assert.equal(res.sanitizedInput.topic, "B2B SaaS Pricing Tiers");
    assert.equal(res.sanitizedInput.target_word_count, 1250);
  });

  it("rejects missing or too-short topic", () => {
    const res = validateSkillInput({ topic: "abc", verified_evidence: [{ chunk_id: "1" }] });
    assert.equal(res.isValid, false);
    assert.ok(res.errors.some((e) => e.includes("topic")));
  });

  it("rejects invalid proven_approach or four_a_path", () => {
    const res = validateSkillInput({
      topic: "Valid Topic Here",
      proven_approach: "invalid_approach",
      four_a_path: "invalid_path",
      verified_evidence: [{ chunk_id: "1" }],
    });
    assert.equal(res.isValid, false);
    assert.ok(res.errors.some((e) => e.includes("proven_approach")));
    assert.ok(res.errors.some((e) => e.includes("four_a_path")));
  });

  it("normalizes evidence and deduplicates chunk IDs", () => {
    const raw = [
      {
        chunk_id: "chunk-1",
        episode_title: "Episode 1",
        guest: "Guest A",
        content: "Content 1",
        source_url: "https://youtube.com/watch?v=1",
      },
      {
        chunk_id: "CHUNK-1", // duplicate
        episode_title: "Episode 1",
        content: "Duplicate content",
      },
      {
        chunk_id: "chunk-2",
        content: "Content 2",
      },
      {
        // Malformed without content
        chunk_id: "chunk-3",
      },
    ];

    const normalized = normalizeEvidence(raw);
    assert.equal(normalized.length, 2);
    assert.equal(normalized[0].chunk_id, "chunk-1");
    assert.equal(normalized[1].chunk_id, "chunk-2");
    assert.equal(normalized[1].guest, "Expert Guest"); // Default fallback
  });

  it("rejects missing evidence and returns structured insufficient_evidence outcome", async () => {
    let generatorCalled = false;
    const generateFn = async () => {
      generatorCalled = true;
      return "Mock essay";
    };

    const result = await executeSkillWorkflow({
      input: {
        topic: "How to Build a Growth Flywheel",
        verified_evidence: [], // Empty evidence!
      },
      generateFn,
    });

    assert.equal(generatorCalled, false);
    assert.equal(result.generation_status, "insufficient_evidence");
    assert.equal(result.word_count, 0);
    assert.equal(result.validation_results.isValid, false);
    assert.ok(result.validation_results.errors[0].includes("Insufficient verified transcript evidence"));
  });
});

describe("Ship 30 for 30 Skill — Word Count & Deterministic Validation", () => {
  it("counts words accurately ignoring markdown noise", () => {
    const sample = `
# Title Here
This is a paragraph with **bold text** and [links](https://example.com/long-url-path).
- Bullet point one
- Bullet point two

\`\`\`javascript
const code = 123;
\`\`\`
Final takeaway sentence.
    `;
    const count = countWords(sample);
    assert.ok(count >= 15 && count <= 25);
  });

  function generateMockEssay(wordCount, options = {}) {
    const {
      hasH1 = true,
      h2Count = 4,
      hasTakeaway = true,
      hasBold = true,
      hasBullets = true,
      citedChunkIds = ["chunk-valid-1"],
      unsafeHtml = "",
    } = options;

    const wordsPerPara = 50;
    const parasNeeded = Math.max(Math.floor(wordCount / wordsPerPara), 1);

    let doc = "";
    if (hasH1) {
      doc += "# The Product Leader's Guide to Growth: How to Build Sustainable Retention\n\n";
    }

    if (unsafeHtml) {
      doc += unsafeHtml + "\n\n";
    }

    // Intro Hook
    doc += "Most early-stage teams fail because they optimize for acquisition before finding product retention.\n\n";
    if (hasBold) {
      doc += "The critical pivot is **nailing user activation** in the first forty-eight hours.\n\n";
    }

    // Sections
    for (let i = 1; i <= h2Count; i++) {
      if (i === h2Count && hasTakeaway) {
        doc += "## The Actionable Framework and Checklist\n\n";
      } else {
        doc += `## Strategic Section ${i}: Core Mechanics\n\n`;
      }

      for (let p = 0; p < Math.floor(parasNeeded / h2Count); p++) {
        let para = "Product strategy requires disciplined execution, continuous customer interviews, and rigorous prioritization across all features. ";
        para += "Teams must observe actual user behaviors rather than stated preferences during discovery sprints. ";
        para += "When testing growth mechanics, evaluate cohort retention curves at thirty and sixty days. ";

        if (p === 0 && citedChunkIds.length > 0) {
          para += `As explained in the transcript [chunk_id: ${citedChunkIds[p % citedChunkIds.length]}], activation determines the ceiling of growth. `;
        }
        doc += para + "\n\n";
      }

      if (hasBullets && i === 2) {
        doc += "- **Audit your setup funnel:** Measure drop-off at every single input.\n";
        doc += "- **Talk to churned users:** Identify the exact moment expectation deviated from reality.\n";
        doc += "- **Ship the core loop:** Minimize time-to-first-value to under five minutes.\n\n";
      }
    }

    // Pad or trim to target words
    const currentWords = countWords(doc);
    if (currentWords < wordCount) {
      const paddingWords = Array(wordCount - currentWords).fill("growth").join(" ");
      doc += paddingWords + ".\n";
    }

    return doc;
  }

  it("accepts an essay within the target range (1,100 to 1,400 words)", () => {
    const mockMarkdown = generateMockEssay(1250);
    const evidence = [{ chunk_id: "chunk-valid-1", episode_title: "Brian Chesky" }];

    const validation = validateEssay({
      markdown: mockMarkdown,
      verifiedEvidence: evidence,
      targetWordCount: 1250,
      minWordCount: 1100,
      maxWordCount: 1400,
    });

    assert.equal(validation.isValid, true);
    assert.equal(validation.wordCountValid, true);
    assert.equal(validation.headingsValid, true);
    assert.equal(validation.citationsValid, true);
    assert.equal(validation.takeawayValid, true);
    assert.equal(validation.errors.length, 0);
  });

  it("identifies a substantially too-short essay (< 1,100 words)", () => {
    const mockMarkdown = generateMockEssay(650);
    const evidence = [{ chunk_id: "chunk-valid-1" }];

    const validation = validateEssay({
      markdown: mockMarkdown,
      verifiedEvidence: evidence,
      targetWordCount: 1250,
      minWordCount: 1100,
      maxWordCount: 1400,
    });

    assert.equal(validation.isValid, false);
    assert.equal(validation.wordCountValid, false);
    assert.ok(validation.errors.some((e) => e.includes("too short")));
  });

  it("identifies an overly long essay (> 1,400 words)", () => {
    const mockMarkdown = generateMockEssay(1600);
    const evidence = [{ chunk_id: "chunk-valid-1" }];

    const validation = validateEssay({
      markdown: mockMarkdown,
      verifiedEvidence: evidence,
      targetWordCount: 1250,
      minWordCount: 1100,
      maxWordCount: 1400,
    });

    assert.equal(validation.isValid, false);
    assert.equal(validation.wordCountValid, false);
    assert.ok(validation.errors.some((e) => e.includes("exceeds the upper length boundary")));
  });

  it("rejects essay missing H1 headline", () => {
    const mockMarkdown = generateMockEssay(1250, { hasH1: false });
    const evidence = [{ chunk_id: "chunk-valid-1" }];

    const validation = validateEssay({ markdown: mockMarkdown, verifiedEvidence: evidence });
    assert.equal(validation.isValid, false);
    assert.equal(validation.headingsValid, false);
    assert.ok(validation.errors.some((e) => e.includes("Missing required H1 headline")));
  });

  it("rejects essay with fewer than 3 H2 sections", () => {
    const mockMarkdown = generateMockEssay(1250, { h2Count: 2 });
    const evidence = [{ chunk_id: "chunk-valid-1" }];

    const validation = validateEssay({ markdown: mockMarkdown, verifiedEvidence: evidence });
    assert.equal(validation.isValid, false);
    assert.equal(validation.headingsValid, false);
    assert.ok(validation.errors.some((e) => e.includes("H2 subheadings")));
  });

  it("rejects essay missing actionable takeaway section", () => {
    const mockMarkdown = generateMockEssay(1250, { hasTakeaway: false });
    const evidence = [{ chunk_id: "chunk-valid-1" }];

    const validation = validateEssay({ markdown: mockMarkdown, verifiedEvidence: evidence });
    assert.equal(validation.isValid, false);
    assert.equal(validation.takeawayValid, false);
    assert.ok(validation.errors.some((e) => e.includes("Missing concrete takeaway section")));
  });

  it("rejects fabricated citation IDs not present in verified evidence", () => {
    const mockMarkdown = generateMockEssay(1250, { citedChunkIds: ["chunk-fabricated-999"] });
    const evidence = [{ chunk_id: "chunk-valid-1" }]; // Does not contain chunk-fabricated-999

    const validation = validateEssay({ markdown: mockMarkdown, verifiedEvidence: evidence });
    assert.equal(validation.isValid, false);
    assert.equal(validation.citationsValid, false);
    assert.ok(validation.errors.some((e) => e.includes("Fabricated or unverified citation IDs")));
  });

  it("rejects unsafe HTML tags in generated content", () => {
    const mockMarkdown = generateMockEssay(1250, { unsafeHtml: "<script>alert('xss')</script>" });
    const evidence = [{ chunk_id: "chunk-valid-1" }];

    const validation = validateEssay({ markdown: mockMarkdown, verifiedEvidence: evidence });
    assert.equal(validation.isValid, false);
    assert.ok(validation.errors.some((e) => e.includes("Security violation")));
  });
});

describe("Ship 30 for 30 Skill — Structure Planning & Workflow Contracts", () => {
  const sampleEvidence = [
    {
      chunk_id: "c1",
      episode_title: "Elena Verna on B2B PLG",
      guest: "Elena Verna",
      content: "PLG is an acquisition and retention model, not a pricing strategy.",
    },
    {
      chunk_id: "c2",
      episode_title: "Elena Verna on B2B PLG",
      guest: "Elena Verna",
      content: "You need product-led sales to bridge the gap to enterprise deals.",
    },
  ];

  it("creates structured 5-section essay plan allocating word budgets", () => {
    const plan = createEssayPlan(
      {
        topic: "B2B Product-Led Growth Strategy",
        audience: "B2B SaaS Founders",
        intended_outcome: "Build a product-led acquisition loop",
        target_word_count: 1250,
      },
      sampleEvidence
    );

    assert.ok(plan.headline.startsWith("# The B2B SaaS Founders's Guide"));
    assert.equal(plan.sections.length, 5);
    assert.equal(plan.wordBudgets.hook + plan.wordBudgets.problem + plan.wordBudgets.insights + plan.wordBudgets.implications + plan.wordBudgets.takeaway, 1250);
    assert.equal(plan.sections[0].rhythm, "1/5/1");
    assert.equal(plan.sections[4].id, "section_5_takeaway");
  });

  it("builds generation prompt containing strict Ship 30 constraints and evidence blocks", () => {
    const plan = createEssayPlan(
      {
        topic: "B2B Product-Led Growth Strategy",
        audience: "B2B SaaS Founders",
        target_word_count: 1250,
      },
      sampleEvidence
    );

    const prompt = buildGenerationPrompt(plan);
    assert.ok(prompt.includes("Dickie Bush & Nicolas Cole"));
    assert.ok(prompt.includes("Wheels & Spokes"));
    assert.ok(prompt.includes("The Tequila Test"));
    assert.ok(prompt.includes("1/5/1"));
    assert.ok(prompt.includes('[VERIFIED PASSAGE chunk_id="c1"]'));
    assert.ok(prompt.includes("Elena Verna"));
  });

  it("executes skill workflow returning full output contract with mocked generator", async () => {
    const evidence = [
      {
        chunk_id: "chunk-valid-1",
        episode_title: "Brian Chesky on Airbnb",
        guest: "Brian Chesky",
        content: "Designing the 11-star experience was key.",
      },
    ];

    const mockEssay = `# The Founder's Guide to Retention: How to Design an 11-Star Experience

Most founders believe product-market fit is a static milestone.

It isn't. Product-market fit is a dynamic vector that decays the moment you stop talking to active customers. When you build for the median user, you build for nobody.

The critical insight is **designing an unscalable eleven-star journey** before standardizing the core workflow.

## Strategic Section 1: The Conventional Fallacy
Conventional product teams immediately optimize conversion funnels with micro-experiments and button tweaks.
This is a trap. Incremental AB testing cannot fix a fundamentally uninspiring value proposition.
When your value metric fails to spark genuine delight, higher top-of-funnel volume only burns cash faster.

## Strategic Section 2: Core Transcript Insights
As Brian Chesky explained on Lenny's Podcast [chunk_id: chunk-valid-1], the breakthrough occurred when Airbnb mapped out the extreme boundaries of hospitality.
What does a five-star experience look like? You get the key and a clean room.
What does a six-star experience look like? There is fresh fruit and a handwritten welcome note.
What does an eleven-star experience look like? Elon Musk meets you at the airport and takes you to space.
By imagining the impossible eleven-star tier, the team found the magical eight-star sweet spot that drove word-of-mouth referral without paid acquisition.

## Strategic Section 3: Tactical Operational Shifts
Translating unscalable delight into scalable operating cadence requires three distinct adjustments:
- **Map the extreme edge cases:** Identify what would make your top ten users weep with gratitude.
- **De-prioritize premature optimization:** Do not automate onboarding until fifty users complete it manually.
- **Institutionalize customer feedback:** Require every engineering leader to shadow support tickets weekly.

## The Actionable Framework and Checklist
To evaluate your product against this standard tomorrow morning, execute this four-step diagnostic:
1. Conduct five deep interviews with your most active power users.
2. Draft an eleven-star customer journey on a whiteboard without technical constraints.
3. Identify which eight-star elements can be delivered immediately with zero code.
4. Eliminate three feature requests that do not advance customer delight.

Delight is not an accident of scale. It is a deliberate choice of craftsmanship.
` + Array(140).fill("Customer satisfaction drives word of mouth.").join(" ") + " Final takeaway sentence.";

    const result = await executeSkillWorkflow({
      input: {
        topic: "11-Star Customer Experience",
        audience: "Early Founders",
        intended_outcome: "Design an unscalable delight loop",
        target_word_count: 1250,
        verified_evidence: evidence,
      },
      generateFn: async () => mockEssay,
    });

    assert.equal(result.generation_status, "success");
    assert.equal(result.validation_results.isValid, true);
    assert.ok(result.word_count >= 1100 && result.word_count <= 1400);
    assert.equal(result.citations.length, 1);
    assert.equal(result.citations[0].guest, "Brian Chesky");
    assert.equal(result.evidence_chunk_ids.length, 1);
  });

  it("registerShip30PiTool defines safe tool without shell or filesystem access", () => {
    let registeredTool = null;
    const mockPi = {
      registerTool(toolDef) {
        registeredTool = toolDef;
      },
    };

    registerShip30PiTool(mockPi);
    assert.ok(registeredTool);
    assert.equal(registeredTool.name, "generate_ship30_essay");
    assert.ok(registeredTool.parameters.properties.topic);
    assert.ok(!registeredTool.parameters.properties.command); // No shell
    assert.ok(!registeredTool.parameters.properties.path);    // No file writes
  });

  it("assembleEssaySections combines 5 sections with exactly one H1 and valid H2 hierarchy", () => {
    const plan = {
      headline: "# The Unscalable Delight Loop for Founders",
      sections: [
        { id: "s1", title: "Hook" },
        { id: "s2", title: "The Problem" },
        { id: "s3", title: "Expert Insights" },
        { id: "s4", title: "Execution Strategy" },
        { id: "s5", title: "Takeaway" },
      ],
    };

    const sectionTexts = [
      { section: plan.sections[0], text: "First sentence hook. Product-market fit is unscalable delight." },
      { section: plan.sections[1], text: "## The Conventional Trap\n\nMost teams automate before learning." },
      { section: plan.sections[2], text: "# Accidental H1\n\nDirect quote from podcast [chunk_id: c1]." },
      { section: plan.sections[3], text: "Tactical advice without explicit header." },
      { section: plan.sections[4], text: "## The Actionable Framework\n\nHere are 4 diagnostic steps." },
    ];

    const assembled = assembleEssaySections({ plan, sectionTexts });

    // Verify H1 is present once
    const h1Matches = assembled.match(/^#\s+.+$/gm);
    assert.equal(h1Matches.length, 1);
    assert.equal(h1Matches[0], "# The Unscalable Delight Loop for Founders");

    // Accidental H1 in section 3 was demoted to H2
    assert.ok(assembled.includes("## Accidental H1"));

    // Section 4 had default H2 injected
    assert.ok(assembled.includes("## Execution Strategy"));

    // Actionable framework H2 preserved
    assert.ok(assembled.includes("## The Actionable Framework"));
  });

  it("executes skill workflow sequentially with generateSectionFn across 5 bounded sections", async () => {
    const evidence = [
      {
        chunk_id: "chunk-valid-1",
        episode_title: "Brian Chesky on Airbnb",
        guest: "Brian Chesky",
        content: "Designing the 11-star experience was key.",
      },
    ];

    const calls = [];
    const mockSectionGenerator = async ({ section, plan, priorSectionsText, prompt }) => {
      calls.push({ sectionId: section.id, priorLen: priorSectionsText.length });
      if (section.id === "section_1_hook") {
        return "Single hook sentence.\n\n" + Array(25).fill("Building unscalable experiences creates product-market fit.").join(" ");
      } else if (section.id === "section_2_problem") {
        return "## The Conventional Trap\n\n" + Array(30).fill("Premature automation destroys early customer feedback loops.").join(" ");
      } else if (section.id === "section_3_insights") {
        return "## Core Transcript Insights\n\nAs Brian Chesky explained [chunk_id: chunk-valid-1], 11-star thinking works.\n\n" + Array(40).fill("Imagining impossible extremes uncovers realistic breakthroughs.").join(" ");
      } else if (section.id === "section_4_implications") {
        return "## Tactical Playbook\n\n" + Array(30).fill("Map customer journeys with extreme empathy and zero premature code.").join(" ");
      } else {
        return "## The Actionable Framework\n\n" + Array(25).fill("Execute customer discovery interviews every Tuesday morning.").join(" ");
      }
    };

    const result = await executeSkillWorkflow({
      input: {
        topic: "11-Star Delight",
        audience: "Founders",
        intended_outcome: "Delight framework",
        target_word_count: 1250,
        verified_evidence: evidence,
      },
      generateSectionFn: mockSectionGenerator,
    });

    // Verify exactly 5 sequential calls were made in order
    assert.equal(calls.length, 5);
    assert.equal(calls[0].sectionId, "section_1_hook");
    assert.equal(calls[1].sectionId, "section_2_problem");
    assert.equal(calls[2].sectionId, "section_3_insights");
    assert.equal(calls[3].sectionId, "section_4_implications");
    assert.equal(calls[4].sectionId, "section_5_takeaway");

    // Verify context accumulates
    assert.equal(calls[0].priorLen, 0);
    assert.ok(calls[1].priorLen > 0);
    assert.ok(calls[4].priorLen > calls[1].priorLen);

    // Verify result contract
    assert.ok(result.markdown.includes("# "));
    assert.ok(result.markdown.includes("[chunk_id: chunk-valid-1]"));
    assert.equal(result.evidence_chunk_ids[0], "chunk-valid-1");
    assert.equal(result.plan.sections.length, 5);
  });
});
