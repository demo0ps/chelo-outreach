# Chelo privacy notice (POPIA)

_Effective 26 October 2026 · Responsible party: Chelo (cheloapp.com), Johannesburg, South Africa._

Chelo connects verified school needs with funders, suppliers and the media. To do that we process a small amount of
personal information about the people we write to and the staff who use this workspace. This notice says what, why,
for how long, and where it is kept.

## What we process and why

| Who | What | Why (lawful basis) |
|---|---|---|
| Funder and CSI contacts | Name, work title, work email, work phone, company, public statements about giving | Legitimate interest: a relevant, one-to-one approach about a verified school project. Every email carries a one-click opt-out. |
| School principals and staff | Name, title, school phone/email as published by the Department of Basic Education, notes from our calls | Legitimate interest and, for project work, performance of the arrangement with the school. We ask before we photograph or name learners — and we do not store learner information at all. |
| Journalists and editors | Name, outlet, beat, work email, published articles | Legitimate interest: offering a story in their beat. Opt-out on every email. |
| Suppliers | Company, contact name, work email/phone, registration numbers, trades, provinces, references | Consent given on the sign-up form; then performance of the quote process. |
| Chelo staff | Name, work email, role, sign-in events, actions taken (audit trail) | Employment / contract, and our security obligations (POPIA s19). |

We do not process special personal information, information about children, or financial account details. Money is
not handled in this system.

## Where it is kept (section 72 — transfers outside South Africa)

The workspace runs on Vercel and its database is held on Supabase. Both store data in data centres outside South Africa
(European Union and/or United States regions) under contracts that bind them to a level of protection substantially
similar to POPIA (Vercel DPA with EU Standard Contractual Clauses; Supabase DPA with EU Standard Contractual Clauses).
Emails you receive from us are sent through Google Workspace or a mailbox provider on the same basis. Where consent is
our basis (suppliers), you consent to this transfer when you sign up.

## How long

- Prospect and media contacts: while there is a live conversation, then 24 months from the last contact, after which
  the record is deleted or anonymised. Opt-outs are kept indefinitely on a suppression list so we never write again.
- School records: for the life of the project plus 5 years (funder reporting).
- Supplier records: while approved, then 24 months.
- Staff audit trail: 365 days, hash-chained, then rolled off.

## Your rights

You may ask what we hold about you, ask us to correct or delete it, or object to processing. Email
privacy@cheloapp.com. We answer within 30 days. You may also complain to the Information Regulator
(South Africa): inforeg@justice.gov.za.

## Security in short

Staff sign in with a password and, for administrators, a two-step code. Secrets are encrypted at rest; every action is
written to a tamper-evident audit trail; the application is rate-limited and served over HTTPS only.
