/*
  Replace placeholders below with your report content.

  Sample company profile shape:

  const sampleCompanyProfile = {
    companyName: "Example Company",
    companyLogo: {
      localPath: "./assets/logos/example-company.png",
      // Or use googleDriveFileId: "abc123"
      description: "Company logo used in the audit",
      sourceURL: "https://example.com/careers",
    },
    companyEvidence: {
      "example.com": {
        sourceDomain: "example.com",
        images: [
          {
            localPath: "./assets/evidence/example-careers-home.png",
            // Or use googleDriveFileId: "abc123"
            description: "Careers homepage hero",
            sourceURL: "https://example.com/careers",
          },
        ],
        textualEvidence: [
          {
            sourceURL: "https://example.com/careers",
            type: "headline",
            context: "Careers homepage hero",
            content: {
              text: "Build what matters.",
            },
          },
        ],
      },
    },
    analysis: {
      scientificTalentValueProposition: {
        primaryHeadline: {
          text: "Primary value proposition headline",
          sourceURL: "https://example.com/careers",
        },
        keyPillarStatements: [
          {
            statement: "Supporting pillar statement",
            sourceURL: "https://example.com/careers",
          },
        ],
        summary: "Summary of the value proposition.",
        sourceURLs: ["https://example.com/careers"],
      },
      kilosFrameworkAnalysis: {
        Kinship: {
          presence: true,
          summary: "How this company signals belonging and culture.",
          sourceURLs: ["https://example.com/culture"],
          supportingEvidence: [
            {
              evidenceText: "Quoted or paraphrased proof point.",
              theme: "Diversity, inclusion, equality",
              sourceURL: "https://example.com/culture",
            },
          ],
        },
      },
    },
  };
*/

const templateMeta = {
  reportTitle: "Employer Brand Competitive Audit",
  reportSubtitle: "Replace with your audience, talent segment, or market focus.",
  footerText: "© 2025 Symphony Talent, LLC. All Rights Reserved.",
  headerLogo: "./assets/branding/symphony-talent-header.png",
  heroLogo: "./assets/branding/symphony-talent-hero.png",
  overviewBackground: "./assets/backgrounds/overview-bg.jpg",
  contentBackground: "./assets/backgrounds/content-bg.jpg",
  watermarkGraphic: "",
};

const client = {
  companyName: "Client Company",
  companyLogo: {
    localPath: "",
    description: "",
    sourceURL: "",
  },
  companyEvidence: {},
  analysis: {
    scientificTalentValueProposition: {
      primaryHeadline: {
        text: "Add the client's primary employer brand headline.",
        sourceURL: "",
      },
      keyPillarStatements: [
        {
          statement: "Add a supporting proof point or pillar statement.",
          sourceURL: "",
        },
      ],
      summary: "Summarize the client's current employer brand value proposition.",
      sourceURLs: [],
    },
    kilosFrameworkAnalysis: {},
  },
};

const competitors = [];

const comparison = {
  executiveSummary: {
    sharedThemes: "Document the common themes you see across the competitive set.",
    keyDifferentiators: "Document the sharpest differentiators between brands.",
    whiteSpaceOpportunities: "Document whitespace and strategic opportunities.",
    sourceURLs: [],
  },
  kilosMessagingMatrix: [
    /*
    {
      theme: "Diversity, inclusion, equality",
      dimension: "Kinship",
      companyScores: {
        "Client Company": "Strong",
        "Competitor One": "Present",
      },
    },
    */
  ],
};

const introContent = {
  auditPreamble: {
    title: "Replace with your audit title.",
    introduction: "Add a short introduction explaining the scope of the review and the audience you assessed.",
    methodologyTitle: "Methodology",
    methodology: "Explain how you gathered and compared the evidence.",
    methodologyFocusAreas: [
      "Add the first focus area.",
      "Add the second focus area.",
      "Add the third focus area.",
    ],
    closing: "Add a closing statement about how the audit will be used.",
    frameworkIntroduction: "Optional: explain how the KILOS framework was applied.",
  },
};
