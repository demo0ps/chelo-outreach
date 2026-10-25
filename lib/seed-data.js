function isoDay(dayOffset = 0, hour = 9) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function seededProjects() {
  return [
    {
      id: 'proj-chelo-solar-gp',
      name: 'Solar Classrooms & Off-Grid Digital Labs',
      recipientName: 'Tshwane & Ekurhuleni Public Secondary Cluster',
      recipientType: 'Section 21 Quintile 2–3 Public Schools',
      province: 'Gauteng',
      sector: 'Energy & Digital Education',
      targetAmount: 1250000,
      committedAmount: 400000,
      status: 'Verified · Seeking Partners',
      grantCycleWindow: 'Q1–Q3 delivery · Section 18A & B-BBEE SED verified',
      sourceUrl: 'https://cheloapp.com',
      verifiedAt: '2026-10-05',
      summary: 'Hybrid 15kWp solar PV and lithium backup installations powering smart classrooms and computer labs across three load-shedding-affected secondary schools, with inverter telemetry and termly school usage reporting.',
      verifiedMetrics: [
        { label: 'Uninterrupted digital lab hours', baselineValue: 11, currentValue: 28, unit: 'hrs/week', period: 'Term 1 2025 to Term 2 2026', source: 'Chelo pilot school inverter telemetry log, p. 3' },
        { label: 'Grade 11–12 CAT & IT practical completion', baselineValue: 64, currentValue: 92, unit: '%', period: '2025 academic cycle', source: 'District HOD curriculum sign-off schedule' }
      ],
      createdAt: isoDay(-45),
      updatedAt: isoDay(-4)
    },
    {
      id: 'proj-chelo-literacy-wc',
      name: 'Foundation Phase Reading Corners & Bilingual Libraries',
      recipientName: 'Cape Flats & Winelands Early Literacy Network',
      recipientType: 'Verified Section 18A Education NPO',
      province: 'Western Cape',
      sector: 'Foundation Phase Literacy',
      targetAmount: 640000,
      committedAmount: 320000,
      status: 'Verified · Seeking Partners',
      grantCycleWindow: 'Annual school-year intake · Section 18A verified',
      sourceUrl: 'https://cheloapp.com',
      verifiedAt: '2026-09-22',
      summary: 'isiXhosa, Afrikaans and English levelled classroom libraries, educator reading-club coaching, and quarterly EGRA oral-reading fluency benchmarks across eight no-fee primary schools.',
      verifiedMetrics: [
        { label: 'Grade 3 learners meeting reading benchmark', baselineValue: 38, currentValue: 61, unit: '%', period: 'Baseline Feb 2025 to Sep 2026', source: 'Verified NPO quarterly literacy assessment, Table 2' },
        { label: 'Weekly structured library sessions', baselineValue: 4, currentValue: 16, unit: 'sessions/wk', period: '2025 to 2026', source: 'School principal signed reading register' }
      ],
      createdAt: isoDay(-40),
      updatedAt: isoDay(-6)
    },
    {
      id: 'proj-chelo-wash-ec',
      name: 'Safe School Water Harvesting & Dignified Sanitation',
      recipientName: 'OR Tambo & Amathole Rural Schools Infrastructure Trust',
      recipientType: 'Verified Implementing NGO & School Governing Bodies',
      province: 'Eastern Cape',
      sector: 'WASH & School Infrastructure',
      targetAmount: 950000,
      committedAmount: 300000,
      status: 'Verified · Seeking Partners',
      grantCycleWindow: 'Dry-season civil works window · Milestone audited',
      sourceUrl: 'https://cheloapp.com',
      verifiedAt: '2026-10-10',
      summary: 'Rainwater harvesting tanks, solar borehole filtration, handwashing stations, and safe ablution refurbishments for rural schools, paired with caretaker maintenance training and monthly water-uptime audits.',
      verifiedMetrics: [
        { label: 'Potable water availability per month', baselineValue: 12, currentValue: 21, unit: 'school days', period: 'Term 3 2025 to Term 3 2026', source: 'Implementing engineer commissioning & SGB log' },
        { label: 'Functional learner sanitation cubicles', baselineValue: 6, currentValue: 18, unit: 'units', period: 'Pre-works to Post-audit 2026', source: 'Quantity surveyor practical completion certificate' }
      ],
      createdAt: isoDay(-35),
      updatedAt: isoDay(-3)
    },
    {
      id: 'proj-chelo-stem-kzn',
      name: 'Mobile Physical Science & Robotics Labs + Teacher Hubs',
      recipientName: 'uMgungundlovu & King Cetshwayo STEM Teacher Hub',
      recipientType: 'Verified STEM Education NPO',
      province: 'KwaZulu-Natal',
      sector: 'STEM & Teacher Development',
      targetAmount: 540000,
      committedAmount: 180000,
      status: 'Verified · Seeking Partners',
      grantCycleWindow: 'Termly educator cohorts · SACE-endorsed workshops',
      sourceUrl: 'https://cheloapp.com',
      verifiedAt: '2026-09-29',
      summary: 'CAPS-aligned Physical Science experiment kits, micro-controller robotics sets, and accredited Saturday educator lab practicums serving twelve under-resourced secondary schools.',
      verifiedMetrics: [
        { label: 'CAPS prescribed practicals completed', baselineValue: 35, currentValue: 88, unit: '%', period: '2025 to Q3 2026', source: 'Subject advisor moderated portfolio audit' },
        { label: 'Educators completing hands-on lab practicum', baselineValue: 9, currentValue: 26, unit: 'teachers', period: 'Cohort 1 to Cohort 2 (2026)', source: 'SACE-endorsed attendance & assessment register' }
      ],
      createdAt: isoDay(-30),
      updatedAt: isoDay(-5)
    },
    {
      id: 'proj-chelo-ecd-lp',
      name: 'Early Childhood Nutrition Gardens & Classroom Renewal',
      recipientName: 'Capricorn & Vhembe Registered ECD Collective',
      recipientType: 'Verified Community ECD Centres',
      province: 'Limpopo',
      sector: 'Early Childhood Development & Food Security',
      targetAmount: 780000,
      committedAmount: 280000,
      status: 'Verified · Seeking Partners',
      grantCycleWindow: 'Rolling community cohorts · DSD compliance aligned',
      sourceUrl: 'https://cheloapp.com',
      verifiedAt: '2026-10-12',
      summary: 'Drip-irrigated permaculture food gardens, safe kitchen upgrades, and weatherproof play-based learning classrooms enabling rural community ECD centres to meet full registration standards.',
      verifiedMetrics: [
        { label: 'Daily cooked meals with fresh garden produce', baselineValue: 120, currentValue: 310, unit: 'meals/day', period: 'Q4 2025 to Q3 2026', source: 'Centre practitioner daily meal & harvest ledger' },
        { label: 'ECD centres passing municipal health inspection', baselineValue: 2, currentValue: 5, unit: 'centres', period: '2025 to 2026', source: 'Municipal environmental health compliance certificates' }
      ],
      createdAt: isoDay(-25),
      updatedAt: isoDay(-2)
    },
    {
      id: 'proj-chelo-youth-za',
      name: 'TVET & Youth Digital Employability Work-Readiness Bridge',
      recipientName: 'Mzansi Youth Tech & Artisan Pathways NPC',
      recipientType: 'Verified Youth Skills NPC (PBO)',
      province: 'Gauteng / KwaZulu-Natal',
      sector: 'Youth Employability & Skills',
      targetAmount: 880000,
      committedAmount: 0,
      status: 'Verified · Seeking Partners',
      grantCycleWindow: 'Bi-annual intakes (Feb & Jul) · B-BBEE Skills & SED',
      sourceUrl: 'https://cheloapp.com',
      verifiedAt: '2026-10-15',
      summary: 'Sixteen-week practical cloud/IT support, solar installation assistantship, and workplace-readiness bootcamps connecting unemployed youth with verified host employers.',
      verifiedMetrics: [
        { label: 'Cohort learners completing industry capstone', baselineValue: 71, currentValue: 89, unit: '%', period: 'Cohort 2025 to Cohort 2026', source: 'External assessor moderation report, p. 6' }
      ],
      createdAt: isoDay(-20),
      updatedAt: isoDay(-1)
    }
  ];
}

function seededDb() {
  return {
    version: 2,
    projects: seededProjects(),
    leads: [
      {
        id: 'lead-demo-101', isDemo: true, company: 'Metsi Energy Group · Demo', contactName: 'Lerato Mokoena', title: 'Head of Sustainability', email: 'lerato@example.com', phone: '+27 11 555 0101', sector: 'Energy', sourceUrl: 'https://example.com/impact-report', sourceName: 'Public sustainability report', sourceLastVerifiedAt: '2026-10-14', contactLastVerifiedAt: '2026-10-14', relationshipContext: 'Met at Gauteng Clean Energy CSI Roundtable; warm intro available via advisory board.', partnerPriorities: 'Just Energy Transition community investment, township STEM & solar classrooms. Annual CSI budget finalised in November.', grantWindowOpenMonth: 10, grantWindowCloseMonth: 11, nextGrantDeadline: isoDay(28).slice(0, 10), projectId: 'proj-chelo-solar-gp', project: 'Solar Classrooms & Off-Grid Digital Labs', amount: 850000, stage: 'Proposal sent', fitScore: 92, notes: 'Demo record. Interested in education access and measurable outcomes.', owner: 'Nandi', nextAction: 'Follow up on proposal', doNotContact: false, emailStatus: 'Draft', emailDraft: null, proposalData: null, proposalFile: null, proposalToken: null, bookingToken: 'demo-booking-101', lastContactedAt: null, followUpAt: null, createdAt: isoDay(-18), updatedAt: isoDay(-2)
      },
      {
        id: 'lead-demo-102', isDemo: true, company: 'Kganya Capital Foundation · Demo', contactName: 'Sibongile Dube', title: 'Programme Director', email: 'sibongile@example.com', phone: '+27 11 555 0102', sector: 'Foundation', sourceUrl: 'https://example.com/grant-programmes', sourceName: 'Foundation funding page', sourceLastVerifiedAt: '2026-10-10', contactLastVerifiedAt: '2026-10-10', relationshipContext: 'Direct foundation enquiry guidelines.', partnerPriorities: 'Early childhood & foundation-phase learning spaces; trustees meet quarterly.', grantWindowOpenMonth: 9, grantWindowCloseMonth: 11, nextGrantDeadline: isoDay(19).slice(0, 10), projectId: 'proj-chelo-ecd-lp', project: 'Early Childhood Nutrition Gardens & Classroom Renewal', amount: 500000, stage: 'Briefing requested', fitScore: 88, notes: 'Demo record. Requested an introductory briefing.', owner: 'Nandi', nextAction: 'Confirm preferred briefing time', doNotContact: false, emailStatus: 'Sent (demo)', emailDraft: null, proposalData: null, proposalFile: null, proposalToken: null, bookingToken: 'demo-booking-102', lastContactedAt: isoDay(-2), followUpAt: null, createdAt: isoDay(-12), updatedAt: isoDay(-1)
      },
      {
        id: 'lead-demo-103', isDemo: true, company: 'Ubuntu Retail Collective · Demo', contactName: 'Ayesha Khumalo', title: 'CSI Manager', email: 'ayesha@example.com', phone: '+27 11 555 0103', sector: 'Retail', sourceUrl: 'https://example.com/community-investment', sourceName: 'Community investment page', sourceLastVerifiedAt: '2026-09-28', contactLastVerifiedAt: '2026-09-28', relationshipContext: 'Previous co-funder on Western Cape literacy drive.', partnerPriorities: 'Foundation-phase reading, bilingual school libraries and staff book-drive volunteering.', grantWindowOpenMonth: 10, grantWindowCloseMonth: 12, nextGrantDeadline: isoDay(45).slice(0, 10), projectId: 'proj-chelo-literacy-wc', project: 'Foundation Phase Reading Corners & Bilingual Libraries', amount: 320000, stage: 'Interested', fitScore: 84, notes: 'Demo record. Asked for examples of project reporting.', owner: 'Thabo', nextAction: 'Share impact report', doNotContact: false, emailStatus: 'Sent (demo)', emailDraft: null, proposalData: null, proposalFile: null, proposalToken: null, bookingToken: 'demo-booking-103', lastContactedAt: isoDay(-3), followUpAt: null, createdAt: isoDay(-10), updatedAt: isoDay(-2)
      },
      {
        id: 'lead-demo-104', isDemo: true, company: 'BrightPath Trust · Demo', contactName: 'Neo Radebe', title: 'Grants Lead', email: 'neo@example.com', phone: '+27 11 555 0104', sector: 'Trust', sourceUrl: 'https://example.com/education-grants', sourceName: 'Education grants page', sourceLastVerifiedAt: '2026-10-02', contactLastVerifiedAt: '2026-10-02', relationshipContext: '', partnerPriorities: 'Secondary STEM practicals and teacher development in KZN.', grantWindowOpenMonth: 1, grantWindowCloseMonth: 3, nextGrantDeadline: '', projectId: 'proj-chelo-stem-kzn', project: 'Mobile Physical Science & Robotics Labs + Teacher Hubs', amount: 275000, stage: 'Researched', fitScore: 79, notes: 'Demo record. Research fit and grant cycle before contact.', owner: 'Thabo', nextAction: 'Personalise first outreach', doNotContact: false, emailStatus: 'Not started', emailDraft: null, proposalData: null, proposalFile: null, proposalToken: null, bookingToken: 'demo-booking-104', lastContactedAt: null, followUpAt: null, createdAt: isoDay(-7), updatedAt: isoDay(-3)
      },
      {
        id: 'lead-demo-105', isDemo: true, company: 'NorthStar Foods · Demo', contactName: 'Kea Molefe', title: 'Corporate Affairs Manager', email: 'kea@example.com', phone: '+27 11 555 0105', sector: 'Consumer goods', sourceUrl: 'https://example.com/sustainability', sourceName: 'Sustainability overview', sourceLastVerifiedAt: '2026-10-18', contactLastVerifiedAt: '', relationshipContext: '', partnerPriorities: 'Rural WASH, safe school water and community nutrition.', grantWindowOpenMonth: 10, grantWindowCloseMonth: 11, nextGrantDeadline: isoDay(21).slice(0, 10), projectId: 'proj-chelo-wash-ec', project: 'Safe School Water Harvesting & Dignified Sanitation', amount: 400000, stage: 'New', fitScore: 73, notes: 'Demo record. Confirm the relevant decision-maker.', owner: 'Nandi', nextAction: 'Verify public source', doNotContact: false, emailStatus: 'Not started', emailDraft: null, proposalData: null, proposalFile: null, proposalToken: null, bookingToken: 'demo-booking-105', lastContactedAt: null, followUpAt: null, createdAt: isoDay(-2), updatedAt: isoDay(-2)
      },
      {
        id: 'lead-demo-106', isDemo: true, company: 'Vela Infrastructure · Demo', contactName: 'Lutho Jacobs', title: 'Social Impact Executive', email: 'lutho@example.com', phone: '+27 11 555 0106', sector: 'Infrastructure', sourceUrl: 'https://example.com/impact', sourceName: 'Impact report', sourceLastVerifiedAt: '2026-09-15', contactLastVerifiedAt: '2026-09-15', relationshipContext: 'Multi-year CSI infrastructure partner.', partnerPriorities: 'Rural school water, sanitation and classroom infrastructure.', projectId: 'proj-chelo-wash-ec', project: 'Safe School Water Harvesting & Dignified Sanitation', amount: 300000, stage: 'Won', fitScore: 96, notes: 'Demo won deal. Partner record is linked below.', owner: 'Nandi', nextAction: 'Share quarterly impact update', doNotContact: false, emailStatus: 'Partner', emailDraft: null, proposalData: null, proposalFile: null, proposalToken: null, bookingToken: 'demo-booking-106', lastContactedAt: isoDay(-40), followUpAt: null, createdAt: isoDay(-90), updatedAt: isoDay(-8)
      },
      {
        id: 'lead-demo-107', isDemo: true, company: 'Pula Learning Fund · Demo', contactName: 'Mpho Nkosi', title: 'Partnerships Officer', email: 'mpho@example.com', phone: '+27 11 555 0107', sector: 'Foundation', sourceUrl: 'https://example.com/education', sourceName: 'Public programme page', sourceLastVerifiedAt: '2026-10-12', contactLastVerifiedAt: '2026-10-12', relationshipContext: '', partnerPriorities: 'Educator STEM hubs and digital employability pathways.', projectId: 'proj-chelo-stem-kzn', project: 'Mobile Physical Science & Robotics Labs + Teacher Hubs', amount: 180000, stage: 'Contacted', fitScore: 76, notes: 'Demo record. First introduction sent; wait before follow-up.', owner: 'Thabo', nextAction: 'Check for reply', doNotContact: false, emailStatus: 'Sent (demo)', emailDraft: null, proposalData: null, proposalFile: null, proposalToken: null, bookingToken: 'demo-booking-107', lastContactedAt: isoDay(-1), followUpAt: null, createdAt: isoDay(-5), updatedAt: isoDay(-1)
      }
    ],
    candidates: [
      { id: 'candidate-demo-201', isDemo: true, company: 'Imbizo Digital Trust · Demo', contactName: 'Zola Maseko', title: 'Education Programme Lead', email: 'zola@example.com', phone: '+27 11 555 0201', sector: 'Technology', sourceUrl: 'https://example.com/education-grants', sourceName: 'Imported sample CSV · 24 Oct 2026', sourceLastVerifiedAt: '2026-10-20', contactLastVerifiedAt: '2026-10-20', relationshipContext: 'Trustee spoke on digital inclusion panel with Chelo.', partnerPriorities: 'Youth digital employability and off-grid solar computer labs; Q4 review cycle.', grantWindowOpenMonth: 10, grantWindowCloseMonth: 11, projectId: 'proj-chelo-youth-za', project: 'TVET & Youth Digital Employability Work-Readiness Bridge', amount: 300000, fitScore: 89, notes: 'Fictional candidate for the demo pool. Verify fit and source before adding.', owner: 'Nandi', status: 'New candidate', promotedLeadId: null, createdAt: isoDay(-1) },
      { id: 'candidate-demo-202', isDemo: true, company: 'Khanya Consumer Foundation · Demo', contactName: 'Lindiwe Mokoena', title: 'CSI Portfolio Manager', email: 'lindiwe@example.com', phone: '+27 11 555 0202', sector: 'Retail', sourceUrl: 'https://example.com/community-investment', sourceName: 'Imported sample CSV · 24 Oct 2026', sourceLastVerifiedAt: '2026-10-18', contactLastVerifiedAt: '', relationshipContext: '', partnerPriorities: 'Foundation-phase reading corners and bilingual libraries in WC/EC.', grantWindowOpenMonth: 11, grantWindowCloseMonth: 2, projectId: 'proj-chelo-literacy-wc', project: 'Foundation Phase Reading Corners & Bilingual Libraries', amount: 220000, fitScore: 82, notes: 'Fictional candidate; confirm current giving priorities.', owner: 'Thabo', status: 'New candidate', promotedLeadId: null, createdAt: isoDay(-2) },
      { id: 'candidate-demo-203', isDemo: true, company: 'Tshiamo Community Fund · Demo', contactName: 'Kabelo Dlamini', title: 'Partnerships Officer', email: 'kabelo@example.com', phone: '+27 11 555 0203', sector: 'Foundation', sourceUrl: 'https://example.com/funding-guidelines', sourceName: 'Imported sample CSV · 24 Oct 2026', sourceLastVerifiedAt: '2026-10-15', contactLastVerifiedAt: '', relationshipContext: '', partnerPriorities: 'Safe rural school water harvesting and dignified ablutions.', grantWindowOpenMonth: 2, grantWindowCloseMonth: 5, projectId: 'proj-chelo-wash-ec', project: 'Safe School Water Harvesting & Dignified Sanitation', amount: 450000, fitScore: 77, notes: 'Fictional candidate record.', owner: 'Nandi', status: 'New candidate', promotedLeadId: null, createdAt: isoDay(-4) }
    ],
    partners: [
      { id: 'partner-demo-1', isDemo: true, leadId: 'lead-demo-106', company: 'Vela Infrastructure · Demo', contactName: 'Lutho Jacobs', title: 'Social Impact Executive', email: 'lutho@example.com', phone: '+27 11 555 0106', projectId: 'proj-chelo-wash-ec', project: 'Safe School Water Harvesting & Dignified Sanitation', amount: 300000, sourceName: 'Impact report', sourceUrl: 'https://example.com/impact', sourceLastVerifiedAt: '2026-09-15', contactLastVerifiedAt: '2026-09-15', relationshipContext: 'Multi-year CSI infrastructure partner.', partnerPriorities: 'Rural school water, sanitation and classroom infrastructure.', status: 'Active', partnerSince: isoDay(-36), owner: 'Nandi', notes: 'Demo partner. Quarterly impact update due.' },
      { id: 'partner-demo-2', isDemo: true, leadId: null, company: 'Umoya Community Fund · Demo', contactName: 'Zinhle Maseko', title: 'Executive Director', email: 'zinhle@example.com', phone: '+27 11 555 0192', projectId: 'proj-chelo-literacy-wc', project: 'Foundation Phase Reading Corners & Bilingual Libraries', amount: 320000, sourceName: 'Grant award schedule', sourceUrl: 'https://example.com/grants', sourceLastVerifiedAt: '2026-08-20', contactLastVerifiedAt: '2026-08-20', relationshipContext: 'Long-standing Western Cape literacy co-funder.', partnerPriorities: 'Mother-tongue foundation-phase literacy and teacher coaching.', status: 'Active', partnerSince: isoDay(-60), owner: 'Thabo', notes: 'Demo partner record.' }
    ],
    messages: [],
    emailEvents: [],
    suppressedEmailHashes: [],
    bookings: [
      { id: 'booking-demo-1', isDemo: true, leadId: 'lead-demo-102', contactName: 'Sibongile Dube', email: 'sibongile@example.com', phone: '+27 11 555 0102', organization: 'Kganya Capital Foundation · Demo', date: isoDay(4, 10).slice(0, 10), time: '10:30', durationMinutes: 20, meetingType: 'Introductory video briefing', videoPlatform: 'google_meet', meetingUrl: '', status: 'Requested', note: 'Demo booking request', createdAt: isoDay(-1) },
      { id: 'booking-demo-2', isDemo: true, leadId: 'lead-demo-103', contactName: 'Ayesha Khumalo', email: 'ayesha@example.com', phone: '+27 11 555 0103', organization: 'Ubuntu Retail Collective · Demo', date: isoDay(6, 14).slice(0, 10), time: '14:00', durationMinutes: 20, meetingType: 'Introductory video briefing', videoPlatform: 'microsoft_teams', meetingUrl: 'https://teams.microsoft.com/l/meetup-join/demo-chelo-briefing', status: 'Confirmed', note: 'Demo confirmed meeting', createdAt: isoDay(-2) }
    ],
    activities: [
      { id: 'activity-demo-1', isDemo: true, text: 'Vela Infrastructure · Demo converted to partner', type: 'won', createdAt: isoDay(-8) },
      { id: 'activity-demo-2', isDemo: true, text: 'Briefing requested by Kganya Capital Foundation · Demo', type: 'booking', createdAt: isoDay(-1) },
      { id: 'activity-demo-3', isDemo: true, text: 'Proposal prepared for Metsi Energy Group · Demo', type: 'proposal', createdAt: isoDay(-2) }
    ]
  };
}

module.exports = { isoDay, seededProjects, seededDb };
