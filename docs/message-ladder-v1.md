# Message ladder v1 — draft for discussion (2026-10-25)

Decisions so far: small first email · meeting offered at **step 2** · **funder is the hero** · Chelo's own identity from cheloapp.com:
"Make traceable social impact … every rand used for its intended purpose … Verified Recipients · Traceable Transactions · Impact Reports."
Proof point on the site: Motse School e-learning screens, partnered with Chelo & Bolt.

Positioning insight: Chelo is not "an NGO asking for money". Chelo is **the traceability layer** — a corporate funds a
verified school project and gets proof automatically. That reframes the ask from charity to a *de-risked CSI spend with
a built-in impact report*, which is exactly what a CSI manager needs for the board and the B-BBEE SED verification.

---

## Step 1 — plain text, 84 words, one soft CTA (interest, not meeting)

Subject: `{{Company}} + one verified school in {{Province}}`

```
Hi {{FirstName or "there"}},

{{Company}}'s CSI work in {{focus area, e.g. education in Limpopo}} is why I'm writing.

Picture March 2027: a classroom at {{School}} in {{Town}} with e-learning screens that
{{Company}} switched on — 312 learners, a principal who writes to you about it, and
every rand traceable to the invoice on your dashboard.

Chelo verified the school; we handle the reporting. You take the credit.

Worth a one-page look?

{{StaffName}}
Chelo · cheloapp.com · {{StaffPhone}}
```

Why it's built this way: funder is grammatical subject of the picture ("that {{Company}} switched on"); one concrete place, number and date (identified intervention); instrumental line (traceable, dashboard) answers "how do I justify this"; CTA is interest-based, last sentence; no links, no images, no attachment → plain-text deliverability.

## Step 2 (3–4 days later, same thread) — offer + meeting, the "button" lives on our page

```
Hi {{FirstName}},

Here's the one page: {{hosted link, chelo domain}}

It shows the {{School}} project, what {{Company}} would fund, and the impact report you'd
receive — the same format our partners at Bolt get.

If it fits your {{FY}} planning, pick a 15-minute slot on the page, or just reply with a time.

{{StaffName}}
```

**Hosted page (logo lives here, not in the email):** Chelo logo + "{{Company}} × {{School}}" headline · the picture paragraph with the funder as hero · three numbers (learners, rand, date) · "What you receive": verified recipient, traceable transactions, impact report (mirrors cheloapp.com) · two meeting slots + `.ics` · one button. Click = warmth signal for fit score.

## Step 3 (5 days later) — timeline ask, 2 lines
```
{{FirstName}}, two slots left this week that work on our side: {{Tue 10:00}} / {{Thu 14:00}}. Either useful?
```

## Step 4 (7 days later) — graceful close, door open
```
Closing the loop for now, {{FirstName}}. If {{School}} comes up in {{FY+1}} planning, the page stays live. Thank you for the work {{Company}} already does in {{focus area}}.
```

Human reply at any step halts the ladder (Batch 2 rule). Ethics linter (I6): every number must trace to the Verified Project record; no "last chance"/scarcity language except the real slots in step 3.

---

## Decisions 2026-10-25 (user)
- Figures (user screenshot 2026-10-25): **500+ lives impacted · 500+ verified schools · R7m+ donated · 500+ donors**. ⚠ "500+ lives" vs "500+ schools" look like shared placeholders — confirm before quoting in a cold email; quote only "R7m+ traceably donated" and "500+ donors" until then. Text-readable facts: "over 500 donors"; live project Philemon Montsho Primary — repainting 24 classrooms, R35.3K of R84.2K raised, 21 contributors; Motse School e-learning screens with Bolt. Homepage counters render as animated widgets ("-1,416+", "R-20m+") in server HTML → exact totals to be confirmed by user before quoting.
- Mechanism we can promise (from /how-it-works): verified quotes → funds paid **directly to the supplier** → milestone verification → success story shared, recognising donors. This is the instrumental line for CSI managers.
- Logo: user says use the cheloapp.com favicon. Sandbox cannot download from cheloapp.com (egress blocked) → user to upload the file, or we reference the live favicon URL at build time. Used on hosted page, booking confirmation and .ics only — never in step 1.
- Hero: funder, via **co-branded pictures** (may change). Every ladder promise = "a co-branded photo of the finished classroom with {{Company}}", nothing more.
- Sender: each staff member from their own mailbox (named).
- Booking: Chelo-hosted slots + .ics (existing calendar-ics lib).

## Step 1 — revised with real mechanism (82 words)
```
Subject: {{Company}} + 24 classrooms at Philemon Montsho Primary

Hi {{FirstName}},

{{Company}}'s CSI work in {{focus area}} is why I'm writing.

Picture the first day of term: 24 freshly painted classrooms at Philemon Montsho Primary,
{{Town}} — and a co-branded photo of {{Company}} on the wall that made it happen.

Chelo verified the quotes, pays the painter directly, and signs off each milestone, so your
board sees every rand land. You take the credit.

Worth a one-page look?

{{StaffName}} · Chelo · cheloapp.com
```

## Open questions (asked 2026-10-25)
1. Numbers: cheloapp.com shows "-1,416+" and "R-20m+" placeholders — what are the real figures (lives, schools, rand, donors) I may quote?
2. Logo: send the SVG/PNG (or confirm I may pull `cheloapp.com` assets) — needed for the hosted page and the `.ics`/confirmation emails only.
3. "Funder is the hero" — how far? Co-branded plaque/photo at the school, named in the impact report, or logo on cheloapp.com project page? Each is a promise we must be able to keep.
4. Sender: emails go from a named staff member (`{{StaffName}}`) or from "Chelo Partnerships"? Named outperforms; needs each staff member's own mailbox (Batch 1 model).
5. Meeting at step 2: a Chelo-hosted booking page (our slots, `.ics`) or your existing calendar tool link?
6. Proof partner names (Bolt, SAB Foundation, TIA, Approved) — permission to cite them in cold emails?

## Picture decisions (2026-10-25)
- Imagery: generated for now; switch to real photos once a consent process exists (POPIA — children).
- Placement: hosted page only; emails stay plain text.
- Funder identity: typography "{{Company}} ×" only; logo only after a signed partnership.
- Templates: 3, matched to cheloapp.com project categories (classroom/renovation · construction · ICT), auto-selected by Verified Project type.
