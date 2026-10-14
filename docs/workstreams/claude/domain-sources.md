# Domain source requirements and limitations (#20)

Scope: what each domain agent must retrieve before a model may answer, the metadata every citation needs, and the known gaps. This is a design input for Phase 2 source ingestion (#4) and Phase 7 agents (#9); nothing here is implemented. Sources were reviewed 2026-10-13. Treat URLs as starting points and re-verify terms before building an adapter.

Rule for all domains (from the [domain-agent plan](../../specs/domain-agent-plan.md)): the model interprets **retrieved, dated sources** and deterministic calculations. Model memory is never authority for law, prices, filings or account balances. Retrieved text is data, never instructions.

## Required citation metadata (all domains)

Every source chunk handed to a model must carry the following fields. The fixtures in [`evals/domain`](../../../evals/domain/README.md) use these fields in synthetic form.

| Field                             | Meaning                                                                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `source_id`                       | Stable ID used in citations (`[SRC-ID]`)                                                                          |
| `title`, `authority`              | Human title; issuing body (legislature, court, agency, company, ledger)                                           |
| `jurisdiction`                    | e.g. `US-TX`, `US-federal`. Required for legal, recorded for others                                               |
| `document_date`                   | Date the document was issued, filed or exported                                                                   |
| `effective_from` / `effective_to` | Legal effective period, fiscal period or statement period; `null` if unknown (unknown must be shown, not guessed) |
| `retrieved_at`                    | When the system fetched it; drives staleness checks                                                               |
| `version` / `content_hash`        | Edition, amendment, accession number or import batch; hash of the stored text                                     |
| `locator`                         | Section/subsection, page, table/line, or row range used in a citation                                             |
| `status_flags`                    | e.g. `superseded`, `amended`, `restated`, `unverified`, `synthetic`                                               |

## `legal-us-tx`: United States / Texas legal research

**Primary sources needed**

| Source                                                                                                                                                           | Use                                                                                                  | Notes / limitation                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Texas Constitution and Statutes](https://statutes.capitol.texas.gov/) (Texas Legislative Council)                                                               | Codified Texas statutes by code/section                                                              | The online codification can lag recent session laws; record the "current through" note and session. Effective dates come from session law, not the code page alone. |
| [Texas Legislature Online](https://capitol.texas.gov/)                                                                                                           | Bills, enrolled session laws, effective-date clauses                                                 | Needed to tell an enacted-but-not-yet-effective amendment apart from current law.                                                                                   |
| [Texas Administrative Code](https://www.sos.state.tx.us/tac/) and [Texas Register](https://www.sos.state.tx.us/texreg/)                                          | Agency rules; proposed vs adopted rules                                                              | Proposed rules are not law; carry a `proposed` flag.                                                                                                                |
| [Texas Judicial Branch](https://www.txcourts.gov/) opinions and rules                                                                                            | Supreme Court, Court of Criminal Appeals, courts of appeals; Texas Rules of Civil Procedure/Evidence | Precedential weight differs by court and by published/unpublished status. Record the court and status. Rules are amended by court order: version by order date.     |
| [U.S. Code](https://uscode.house.gov/), [eCFR](https://www.ecfr.gov/), [Federal Register](https://www.federalregister.gov/), [govinfo](https://www.govinfo.gov/) | Federal statutes/regulations when federal law governs or preempts                                    | eCFR is editorially current but not the official legal edition; record which edition was used.                                                                      |
| [CourtListener](https://www.courtlistener.com/) (Free Law Project)                                                                                               | Case-law search across federal/state courts                                                          | Third-party aggregation; check its API terms and rate limits before ingesting. Coverage gaps are possible.                                                          |
| [Texas State Law Library guides](https://guides.sll.texas.gov/)                                                                                                  | Orientation, self-help, finding the right primary source                                             | Secondary; never cited as the authority itself.                                                                                                                     |

**Known gaps that must surface as uncertainty, not be papered over:**

- **No free citator.** Without Shepard's/KeyCite-type history the system can't confirm a case is still good law. Answers citing cases must flag "subsequent history not verified".
- **Local law** (city/county ordinances, HOA instruments) and private contracts are out of scope unless the owner supplies the document.
- **Fact-specific advice** is out of scope: the agent produces a research memo separating quoted authority, inference and open questions, and recommends a licensed Texas attorney for decisions.
- **Effective-date traps:** amendments with future effective dates, sunset provisions, and law changed after a model's training cutoff. Saul's corpus predates March 2024.

## `finance`: financial analysis and investment research

**Primary sources needed**

| Source                                                                                                                                                           | Use                                                          | Notes / limitation                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [SEC EDGAR](https://www.sec.gov/edgar/search/) filings and [data.sec.gov](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) XBRL APIs | 10-K/10-Q/8-K text, company facts, period/unit-tagged values | SEC fair-access rules require a declared User-Agent and rate limiting. XBRL tags can be wrong or company-specific; amendments (`10-K/A`) restate prior values. Record accession number, period, units, scale.                              |
| Owner CSV exports (existing Phase 7 plan)                                                                                                                        | Personal spending analysis (retained workflow)               | Bank-specific column mappers; duplicate imports; sign conventions differ by bank.                                                                                                                                                          |
| Market prices / quotes (provider **not chosen**)                                                                                                                 | Valuation multiples, returns                                 | No free authoritative feed was selected. Market-data licensing, latency and corporate-action adjustment (splits/dividends) must be settled before enabling. Every price carries an `as_of` timestamp; stale prices are refused or flagged. |
| [FRED](https://fred.stlouisfed.org/) / [U.S. Treasury rates](https://home.treasury.gov/)                                                                         | Risk-free rates, macro series                                | FRED API needs a key and has terms of use; series get revised. Record vintage/date.                                                                                                                                                        |
| [Investor.gov](https://www.investor.gov/)                                                                                                                        | Concept explanations (SEC investor education)                | Secondary; for definitions, not data.                                                                                                                                                                                                      |

**Known gaps:**

- **No autonomous trading or personalized investment advice.** The agent shows assumptions, inputs with dates, deterministic calculations and risks. "Should I buy X?" is answered with an analysis framework and a referral, not a recommendation.
- **Fiscal periods, units and currencies** vary (thousands vs millions; non-calendar fiscal years; non-USD reporters). Mismatched periods must be refused or reconciled explicitly.
- **Non-GAAP measures** (adjusted EBITDA etc.) are company-defined; never treat them as GAAP.
- **Forecasts** are scenarios with stated assumptions, never facts.

## `accountant`: accounting

**Primary sources needed**

| Source                                                                                  | Use                                              | Notes / limitation                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ledger / chart of accounts / bank and card exports (read-only import preview)           | Classification, reconciliation, proposed entries | **Synthetic only** until the owner decides personal vs business/entity scope and reporting basis (STATUS Blocked #6). Record import batch, row range, hash.                                             |
| Source documents (invoices, receipts, statements)                                       | Evidence for proposed entries                    | Extraction/OCR quality must be recorded; missing evidence blocks a proposal.                                                                                                                            |
| [FASB Accounting Standards Codification](https://asc.fasb.org/) (authoritative US GAAP) | Recognition/measurement rules                    | Access and reuse are subject to FASB terms; don't assume bulk ingestion is allowed. Cite topic/subtopic/section (e.g. ASC 606-10-25). Only relevant if the owner chooses GAAP-basis business reporting. |
| Owner-defined policies (capitalization threshold, depreciation method, cash vs accrual) | Deterministic rules for the agent                | Must be explicit configuration; a model must not invent a policy.                                                                                                                                       |

**Known gaps:**

- **Tax is out of scope** for `accountant` (proposed separate `tax-us-tx` agent). Questions about deductibility, filing or tax basis are deferred.
- **No ledger writes.** Output is a proposed entry with evidence and a debit = credit check; posting goes through the approval queue.
- **Basis matters:** cash vs accrual and GAAP vs tax basis change answers; an unknown basis is an abstention reason.
- **Arithmetic** (totals, balances, depreciation schedules, reconciliations) is computed by deterministic decimal code; the fixtures carry the exact expected values.

## Why the fixtures are synthetic

Fixtures cite clearly marked **synthetic sources** (IDs like `SYN-TX-…`, titles prefixed `[SYNTHETIC]`, fictional entities). They test grounded reading, citation, date/jurisdiction discipline, arithmetic hand-off and abstention, **without asserting current real-world law, prices or standards**. A later, separately tracked set built from real official sources needs qualified review before it can measure real-world legal or accounting correctness. No private owner data appears anywhere.
