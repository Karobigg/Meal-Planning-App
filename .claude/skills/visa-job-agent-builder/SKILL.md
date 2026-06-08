---
name: visa-job-agent
version: 1.0.0
description: UK-first Skilled Worker visa sponsorship job search agent
trigger: user asks to find visa-sponsored jobs, check if an employer sponsors visas, analyse a job advert for sponsorship, or build a job application for a role requiring sponsorship
country_default: GB
visa_route_default: Skilled Worker
tools_required:
  - search_jobs
  - get_job_details
  - get_resume
  - get_company_data
output_dir: ./visa-job-agent/output
tracker_file: ./visa-job-agent/tracker.json
---

# Visa Job Agent — UK Skilled Worker Route

## Overview

This skill builds and runs a job-search agent specialised for candidates who require UK Skilled Worker visa sponsorship. It covers the full pipeline from CV ingestion, job discovery, and employer sponsor verification through to scored shortlisting and application-asset generation.

The agent is **rule-based first**: every sponsorship score is computed from a deterministic ruleset before any LLM explanation is added. LLMs explain scores; they do not invent them.

**Scope boundary:** This skill provides factual analysis only. It does not give legal immigration advice. Always direct the user to a regulated immigration adviser or solicitor (OISC Level 2+ or SRA-regulated) for advice on their personal immigration situation.

---

## When to Use

| Trigger phrase | Action |
|---|---|
| "find me visa-sponsored jobs" | Run full pipeline from Phase 1 |
| "does [employer] sponsor visas?" | Run Phase 3 (lookupSponsorRegister) only |
| "analyse this job for sponsorship" | Run Phase 4 (analyseJobDescription) only |
| "write me a cover letter for [job]" | Run Phase 6 (generateApplicationAssets) only |
| "show my application tracker" | Read tracker.json and render |

---

## Decision Tree

```
START
│
├─ Is a CV/resume available?
│   ├─ YES → parseCV() → continue
│   └─ NO  → ask user to paste CV or upload file
│              └─ still NO after one ask → use EMPTY_PROFILE default, mark cv_status: MISSING
│
├─ Is a job URL or job description provided?
│   ├─ YES → get_job_details() or parse inline text → continue
│   └─ NO  → ask for role/location/keywords
│              └─ still NO → use defaults: role=Software Engineer, location=London, country=GB
│
├─ Is the employer name known?
│   ├─ YES → lookupSponsorRegister() → continue
│   └─ NO  → extract from job description or get_company_data()
│              └─ still UNKNOWN → set sponsor_register_status: UNKNOWN
│
├─ sponsorship_score >= 70?
│   ├─ YES → calculateCandidateFitScore() → generateApplicationAssets()
│   └─ NO  → report score, surface red_flags, ask user if they want to proceed anyway
│
└─ END
```

---

## Process

### Phase 0 — Initialisation
**Done when:** output directory exists, tracker.json initialised, user profile hydrated.

1. Create `./visa-job-agent/output/` directory.
2. Create `./visa-job-agent/tracker.json` as an empty JSON array `[]` if not present.
3. Call `get_resume()` to hydrate `UserProfile`.
4. If `get_resume()` returns empty or errors, set `cv_status: MISSING` and prompt user once.

**Default assumptions when inputs are missing:**
- `target_role`: `"Software Engineer"`
- `target_location`: `"London, UK"`
- `country_code`: `"GB"`
- `minimum_salary_gbp`: retrieved at runtime via `checkSalaryAgainstGoingRate`; never hard-coded
- `seniority`: `"mid"`

---

### Phase 1 — CV Analysis
**Done when:** `CVAnalysis` object is fully populated with no REQUIRED fields set to UNKNOWN.

1. Call `parseCV()` on resume text.
2. Extract: name, skills, years of experience, highest qualification level, current visa status, nationality.
3. Infer likely SOC codes from job titles in CV history using `inferOccupationCode()`.
4. Validate: if `nationality` is UNKNOWN, prompt once; if still UNKNOWN after prompt, do not infer right-to-work eligibility.

**Files created:** `./visa-job-agent/output/cv_analysis.json`

---

### Phase 2 — Job Discovery
**Done when:** at least 5 `JobAnalysis` stubs are populated (or fewer if search returns fewer).

1. Call `search_jobs(search, location, country_code)` using values from UserProfile or defaults.
2. For each result, call `get_job_details(job_id)` to get full description.
3. Store stub `JobAnalysis` objects (id, title, employer, location, salary_stated, description_raw).
4. Deduplicate by job_id.

**Files created:** `./visa-job-agent/output/jobs_raw.json`

---

### Phase 3 — Employer Sponsor Register Lookup
**Done when:** each `JobAnalysis` has an `EmployerSponsorLookup` record attached.

1. For each unique employer, call `lookupSponsorRegister(employer_name)`.
2. The lookup **must** resolve against the official UKVI register of licensed sponsors.
   - Source URL: `https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers`
   - If the register cannot be queried programmatically in this environment, set `lookup_method: MANUAL_REQUIRED` and surface the employer name and register URL to the user.
3. Record: `on_register`, `licence_rating`, `worker_licence_types`, `last_verified_date`.
4. **Never** assert an employer is a licensed sponsor without a retrieved source. If unsure, set `on_register: UNKNOWN`.

**Licence rating interpretation:**
- `licence_rating: "A"` — full sponsor capability; score as a positive signal.
- `licence_rating: "B"` — employer is on a time-limited UKVI action plan. A B-rating means UKVI has identified compliance concerns; the employer **may not be able to assign new Certificates of Sponsorship** until it is upgraded. Treat as `HIGH_RISK`.
- `licence_rating: "SUSPENDED"` — employer cannot assign CoS. Treat as `HIGH_RISK`; surface immediately.
- `licence_rating: "UNKNOWN"` or field absent — cannot confirm capability. Set `sponsor_capability: MANUAL_REQUIRED`.

**Critical constraint:** Being on the register confirms a licence exists. It does **not** confirm the employer will sponsor this specific role. `licensed_sponsor_confirmed` and `this_role_sponsored` are always independent fields with independent evidence requirements.

**Phase gate:** Do not proceed to Phase 4 for any job where `on_register: false` unless the user explicitly overrides. Also gate on `licence_rating` not being `HIGH_RISK` unless user overrides.

---

### Phase 3b — Salary Rules Retrieval
**Done when:** `SalaryRules` object is populated with a retrieved (not assumed) source.

1. Fetch the current Skilled Worker salary requirements from GOV.UK before any salary scoring is performed.
   - Primary source: `https://www.gov.uk/skilled-worker-visa/your-job` and the associated Appendix Skilled Worker.
   - Record the retrieved general threshold, the retrieval URL, and the retrieval timestamp.
2. For the inferred SOC code, retrieve the occupation-specific going rate from the same source.
3. If the salary rules page cannot be fetched, set `salary_check_status: MANUAL_REQUIRED`. Do not score salary as verified in this state.
4. Salary must meet the **higher** of:
   - the current general Skilled Worker threshold, and
   - the occupation-specific SOC 2020 going rate.
5. **Pro-rating:** If the job is not based on a 37.5-hour week, pro-rate the going rate proportionally before comparison. Record `contracted_hours` and `going_rate_prorated_gbp` in the `SalaryCheck` output.

---

### Phase 4 — Job Description Analysis
**Done when:** each shortlisted job has a populated `JobAnalysis` including `sponsorship_language` and `salary_analysis`.

For each job:
1. Call `analyseJobDescription(description_raw)`.
2. Extract: stated salary or salary range, explicit sponsorship language (positive or negative), required skills list, required qualifications, SOC-eligible occupation signals.
3. Apply **right-to-work negative language detection** — scan for any of these disqualifying phrases (case-insensitive):

```
"no sponsorship"
"must have right to work"
"cannot sponsor"
"not able to sponsor"
"sponsorship not available"
"must be eligible to work in the UK without sponsorship"
"visa sponsorship is not offered"
"only applicants with existing right to work"
```

4. If any negative phrase is found, set `sponsorship_explicitly_refused: true` and add to `red_flags`.
5. Distinguish: `licensed_sponsor_confirmed` (employer is on register) ≠ `this_role_sponsored` (this specific posting offers sponsorship). Both must be independently determined.

---

### Phase 5 — Scoring
**Done when:** each shortlisted job has a `SponsorshipScore` and a `CandidateFitScore`.

#### 5a. calculateSponsorshipScore()
Rule-based. Weights are fixed. LLM may add `explanation` text but must not change `total`.

| Rule | Points | Evidence Required |
|---|---|---|
| Employer on UKVI sponsor register | +35 | `EmployerSponsorLookup.on_register: true` with `source_url` |
| Licence rating is "A" | +10 | `EmployerSponsorLookup.licence_rating: "A"` (retrieved, not assumed) |
| Worker licence includes "Skilled Worker" | +15 | `worker_licence_types` contains "Skilled Worker" |
| Job description explicitly states sponsorship available | +20 | `sponsorship_language_positive` extracted from JD |
| Salary meets or exceeds retrieved going rate (pro-rated if applicable) | +10 | `salary_check.meets_going_rate: true` AND `salary_check_status: VERIFIED` |
| Salary meets retrieved general threshold | +5 | `salary_check.meets_general_threshold: true` AND `salary_check_status: VERIFIED` |
| Negative sponsorship language detected | -50 | `sponsorship_explicitly_refused: true` |
| Employer not on register | -35 | `on_register: false` |
| Licence rating is B, SUSPENDED, or UNKNOWN | -20 | `licence_rating` is not "A" |
| Salary stated below going rate (retrieved) | -10 | `salary_check.meets_going_rate: false` AND `salary_check_status: VERIFIED` |
| Salary rules not retrieved (`salary_check_status: MANUAL_REQUIRED`) | -5 | salary scoring suspended; neither +10/+5 nor -10 applied |
| Salary not stated in job advert | -5 | `salary_stated: null` |

**Salary scoring constraint:** The +10 (going rate) and +5 (general threshold) rules may only award positive points when `salary_check_status: VERIFIED`. If `MANUAL_REQUIRED`, both award 0 and the -5 salary-unavailable penalty applies instead.

**Confidence calculation:**
```
evidence_count = count of rules where evidence was retrieved (not UNKNOWN)
total_applicable_rules = count of rules that could apply to this job
confidence = evidence_count / total_applicable_rules  (0.0–1.0)
```

**Output format:**
```json
{
  "total": <integer -100 to 100>,
  "confidence": <float 0.0 to 1.0>,
  "evidence_found": [...],
  "evidence_missing": [...],
  "red_flags": [...],
  "recommended_next_action": "<string>"
}
```

#### 5b. calculateCandidateFitScore()
| Dimension | Weight |
|---|---|
| Skill overlap (CV skills vs required skills) | 40% |
| Experience level match | 25% |
| Qualification match | 20% |
| Location match / willingness to relocate | 15% |

Score is 0–100. Below 40 = do not auto-generate assets; surface gap analysis instead.

---

### Phase 6 — Application Asset Generation
**Done when:** assets written to output directory and `ApplicationTrackerItem` saved to tracker.

**Only run if:** `SponsorshipScore.total >= 50` AND `CandidateFitScore >= 40`.

Call `generateApplicationAssets(job_analysis, cv_analysis, user_profile)`.

Produces:
- `tailored_cv.md` — CV reordered and reworded to match JD keywords. **Must not add experience the candidate does not have.** All additions are reframings of existing evidence.
- `cover_letter.md` — addresses role, employer, and sponsorship pathway directly.
- `sponsorship_talking_points.md` — factual notes on the employer's sponsor licence and what to expect in the process.

**Hallucination guard:** Each bullet in `tailored_cv.md` must map to a source item in `CVAnalysis.experience`. If no mapping exists, the bullet must not be written.

**Files created:**
```
./visa-job-agent/output/<job_id>/tailored_cv.md
./visa-job-agent/output/<job_id>/cover_letter.md
./visa-job-agent/output/<job_id>/sponsorship_talking_points.md
```

Call `saveApplicationTrackerItem()` to append to `tracker.json`.

---

## Rationalisations and Rebuttals

**"Just check if the company is big — big companies always sponsor."**
Reject. Employer size is not a proxy for licence status. Only the UKVI register is authoritative.

**"The job doesn't mention sponsorship so it's probably fine."**
Reject. Silence on sponsorship is not consent. Absence of negative language is weak positive evidence (+0 in the scoring rubric). The register lookup is the primary signal.

**"I can infer they'll sponsor because they hired internationally before."**
Reject. Past behaviour is not evidence for this role. Set `this_role_sponsored: UNKNOWN` unless the current posting explicitly confirms it.

**"The salary is close enough to the going rate."**
Reject. The Skilled Worker route requires the salary to meet both the general threshold AND the occupation-specific going rate, whichever is higher. "Close" fails the check.

---

## Red Flags

Surface any of the following to the user before proceeding:

- `sponsorship_explicitly_refused: true` — job has disqualifying language; do not proceed without explicit user override
- `on_register: false` — employer is not a licensed sponsor; Phase 3 gate blocks progression
- `on_register: UNKNOWN` and `lookup_method: MANUAL_REQUIRED` — register not checked programmatically; user must verify manually before any application assets are generated
- `licence_rating: "B"` — employer on time-limited UKVI action plan; new CoS assignment may be blocked (`sponsor_capability: HIGH_RISK`)
- `licence_rating: "SUSPENDED"` — employer cannot currently assign CoS (`sponsor_capability: HIGH_RISK`); treat as blocking unless user overrides
- `licence_rating: "UNKNOWN"` — capability unconfirmed (`sponsor_capability: MANUAL_REQUIRED`); surface to user
- `licensed_sponsor_confirmed: true` but `this_role_sponsored: UNKNOWN` — register confirms licence only; role-level sponsorship unconfirmed; advise user to contact employer
- `salary_check_status: MANUAL_REQUIRED` — salary rules could not be retrieved; salary scoring suspended; surface retrieval URL to user
- `salary_check.meets_going_rate: false` — stated salary is below the retrieved occupation going rate (pro-rated where applicable)
- `salary_check.source_stale: true` — going-rate data is more than 6 months old; advise user to re-check before applying
- `CandidateFitScore < 40` — significant skills gap detected
- `cv_status: MISSING` — no CV available; scores are unreliable

---

## Verification Checklist

Before marking any job as "recommended":

- [ ] `EmployerSponsorLookup.source_url` is populated and resolves to a gov.uk URL
- [ ] `EmployerSponsorLookup.lookup_method: "PROGRAMMATIC"` OR user has confirmed manual register check
- [ ] `EmployerSponsorLookup.sponsor_capability: "CONFIRMED"` (licence_rating is "A")
- [ ] `SponsorshipScore.evidence_found` contains at least one retrieved item
- [ ] `SponsorshipScore.confidence >= 0.5`
- [ ] `SponsorshipScore.salary_check_status: "VERIFIED"` — salary rules were retrieved, not assumed
- [ ] `SalaryCheck.source_url` is populated and `SalaryCheck.source_stale: false`
- [ ] `SalaryCheck.meets_general_threshold: true` (against retrieved threshold, not a hard-coded value)
- [ ] `SalaryCheck.meets_going_rate: true` (pro-rated if contracted hours < 37.5/week)
- [ ] No red flags are unacknowledged by the user
- [ ] `licensed_sponsor_confirmed` and `this_role_sponsored` have been evaluated independently
- [ ] `CVAnalysis.source_status != "FABRICATED"`
- [ ] All `tailored_cv.md` bullets have a `source_item_id` mapping

---

## JSON Schemas

### UserProfile
```json
{
  "name": "string | UNKNOWN",
  "email": "string | UNKNOWN",
  "phone": "string | UNKNOWN",
  "nationality": "string | UNKNOWN",
  "current_visa_status": "string | UNKNOWN",
  "current_location": "string",
  "target_role": "string",
  "target_location": "string",
  "target_salary_min_gbp": "integer | null",
  "willing_to_relocate": "boolean",
  "cv_status": "PRESENT | MISSING",
  "cv_raw_text": "string | null"
}
```

### CVAnalysis
```json
{
  "candidate_name": "string | UNKNOWN",
  "skills": ["string"],
  "years_of_experience": "integer | UNKNOWN",
  "highest_qualification": "string | UNKNOWN",
  "qualification_level": "integer | UNKNOWN",
  "inferred_soc_codes": ["string"],
  "experience": [
    {
      "item_id": "string",
      "employer": "string",
      "title": "string",
      "start_date": "string | UNKNOWN",
      "end_date": "string | UNKNOWN",
      "description": "string"
    }
  ],
  "source_status": "PARSED | MISSING | FABRICATED",
  "parse_warnings": ["string"]
}
```

### JobAnalysis
```json
{
  "job_id": "string",
  "title": "string",
  "employer": "string | UNKNOWN",
  "location": "string",
  "salary_stated": "string | null",
  "salary_min_gbp": "integer | null",
  "salary_max_gbp": "integer | null",
  "description_raw": "string",
  "required_skills": ["string"],
  "required_qualifications": ["string"],
  "inferred_soc_code": "string | UNKNOWN",
  "sponsorship_language_positive": ["string"],
  "sponsorship_language_negative": ["string"],
  "sponsorship_explicitly_refused": "boolean",
  "this_role_sponsored": "true | false | UNKNOWN",
  "source_url": "string",
  "retrieved_at": "ISO8601 datetime"
}
```

### EmployerSponsorLookup
```json
{
  "employer_name": "string",
  "employer_name_normalised": "string",
  "on_register": "true | false | UNKNOWN",
  "licence_rating": "A | B | SUSPENDED | UNKNOWN",
  "sponsor_capability": "CONFIRMED | HIGH_RISK | MANUAL_REQUIRED",
  "worker_licence_types": ["string"],
  "skilled_worker_eligible": "boolean | UNKNOWN",
  "lookup_method": "PROGRAMMATIC | MANUAL_REQUIRED",
  "source_url": "string | null",
  "last_verified_date": "ISO8601 date | null",
  "lookup_notes": "string | null"
}
```

### SalaryCheck
```json
{
  "salary_check_status": "VERIFIED | MANUAL_REQUIRED",
  "salary_stated_gbp": "integer | null",
  "contracted_hours_per_week": "number | null",
  "general_threshold_gbp": "integer | UNKNOWN",
  "going_rate_gbp": "integer | UNKNOWN",
  "going_rate_prorated_gbp": "integer | UNKNOWN",
  "effective_threshold_gbp": "integer | UNKNOWN",
  "meets_general_threshold": "boolean | UNKNOWN",
  "meets_going_rate": "boolean | UNKNOWN",
  "source_url": "string | null",
  "source_retrieved_at": "ISO8601 datetime | null",
  "source_stale": "boolean",
  "notes": "string | null"
}
```

### SponsorshipScore
```json
{
  "job_id": "string",
  "total": "integer",
  "confidence": "float",
  "salary_check_status": "VERIFIED | MANUAL_REQUIRED | NOT_ATTEMPTED",
  "rule_breakdown": [
    {
      "rule_id": "string",
      "points_awarded": "integer",
      "evidence_retrieved": "boolean",
      "evidence_summary": "string | UNKNOWN"
    }
  ],
  "evidence_found": ["string"],
  "evidence_missing": ["string"],
  "red_flags": ["string"],
  "recommended_next_action": "string",
  "explanation": "string",
  "source_status": "RULE_BASED | LLM_ONLY | HYBRID"
}
```

### CandidateFitScore
```json
{
  "job_id": "string",
  "total": "integer",
  "skill_overlap_score": "integer",
  "skill_overlap_matched": ["string"],
  "skill_overlap_missing": ["string"],
  "experience_match_score": "integer",
  "qualification_match_score": "integer",
  "location_match_score": "integer",
  "overall_recommendation": "APPLY | APPLY_WITH_GAPS | DO_NOT_APPLY",
  "gap_analysis": ["string"]
}
```

### GeneratedApplicationAssets
```json
{
  "job_id": "string",
  "tailored_cv_path": "string",
  "cover_letter_path": "string",
  "sponsorship_talking_points_path": "string",
  "cv_bullets": [
    {
      "text": "string",
      "source_item_id": "string",
      "source_status": "MAPPED | INFERRED | FABRICATED"
    }
  ],
  "fabrication_check_passed": "boolean",
  "generated_at": "ISO8601 datetime"
}
```

### ApplicationTrackerItem
```json
{
  "id": "string (uuid)",
  "job_id": "string",
  "employer": "string",
  "title": "string",
  "location": "string",
  "applied_date": "ISO8601 date | null",
  "status": "DISCOVERED | SHORTLISTED | APPLIED | INTERVIEW | OFFER | REJECTED | WITHDRAWN",
  "sponsorship_score": "integer",
  "candidate_fit_score": "integer",
  "sponsor_register_confirmed": "boolean",
  "assets_generated": "boolean",
  "notes": "string",
  "source_url": "string",
  "updated_at": "ISO8601 datetime"
}
```

---

## Module Interfaces

### parseCV(raw_text: string) → CVAnalysis
- Input: raw CV text (plain text or markdown)
- If `raw_text` is null/empty, return `{ source_status: "MISSING", ...defaults }`
- Must not invent experience items. Extract only what is present.
- Set `parse_warnings` for any ambiguous dates, overlapping roles, or unexplained gaps.

### analyseJobDescription(job: JobAnalysis) → JobAnalysis (enriched)
- Input: populated `JobAnalysis` stub with `description_raw`
- Extract all required fields listed in the schema
- Run negative language scan against the disqualifying phrases list
- Set `this_role_sponsored: UNKNOWN` if neither positive nor negative language found

### lookupSponsorRegister(employer_name: string) → EmployerSponsorLookup
- Normalise employer name (remove Ltd/PLC/Inc suffixes for matching)
- Attempt register lookup; if not possible, set `lookup_method: MANUAL_REQUIRED`
- Source URL must be `https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers` or a derived programmatic endpoint
- Never assert `on_register: true` without a retrieved source

### inferOccupationCode(job_title: string, description: string) → string (SOC code or "UNKNOWN")
- Map job title and description to the most likely 4-digit SOC 2020 code
- Return `"UNKNOWN"` rather than guess if confidence is low
- Attach the SOC code name alongside the code

### checkSalaryAgainstGoingRate(salary_gbp: integer, soc_code: string, contracted_hours?: number) → SalaryCheck
- **Must fetch** current Skilled Worker salary rules from GOV.UK before any comparison. Never use a hard-coded threshold.
- Primary retrieval target: GOV.UK Skilled Worker visa guidance and the current Appendix Skilled Worker.
- If retrieval fails, return `{ salary_check_status: "MANUAL_REQUIRED" }` immediately. Do not estimate or fall back to a cached value.
- Returns a fully populated `SalaryCheck` object including `source_url` and `source_retrieved_at`.
- `effective_threshold_gbp` = `max(general_threshold_gbp, going_rate_prorated_gbp)`.
- If `contracted_hours` is provided and differs from 37.5, pro-rate: `going_rate_prorated_gbp = going_rate_gbp * (contracted_hours / 37.5)`. Record `contracted_hours_per_week`.
- If SOC code is UNKNOWN, `going_rate_gbp` and `going_rate_prorated_gbp` are set to `"UNKNOWN"`; only `meets_general_threshold` can be evaluated.
- Set `source_stale: true` if `source_retrieved_at` is more than 6 months before the current date.

### calculateSponsorshipScore(job: JobAnalysis, lookup: EmployerSponsorLookup, salary_check: object) → SponsorshipScore
- Apply the rule table from Phase 5a deterministically
- `source_status` must be `"RULE_BASED"` unless a rule could not be evaluated, in which case use `"HYBRID"`
- Never set `source_status: "LLM_ONLY"`

### calculateCandidateFitScore(job: JobAnalysis, cv: CVAnalysis) → CandidateFitScore
- Apply the dimension weights from Phase 5b
- Skill overlap: intersection of `cv.skills` and `job.required_skills` divided by `job.required_skills` length
- If `cv.source_status == "MISSING"`, all dimension scores are 0 and `overall_recommendation: "DO_NOT_APPLY"` pending CV upload

### generateApplicationAssets(job: JobAnalysis, cv: CVAnalysis, user: UserProfile) → GeneratedApplicationAssets
- Every CV bullet must include `source_item_id` mapping to `CVAnalysis.experience[*].item_id`
- If no mapping exists, do not write the bullet
- Set `fabrication_check_passed: false` and abort if any bullet has `source_status: "FABRICATED"`
- Cover letter must not claim the employer will definitely sponsor — use hedged language ("based on publicly available records, [Employer] holds a Skilled Worker sponsor licence")

### saveApplicationTrackerItem(item: ApplicationTrackerItem) → void
- Append to `./visa-job-agent/tracker.json`
- Generate a uuid for `id` if not provided
- Set `updated_at` to current ISO8601 datetime

---

## Files and Modules to Create

```
visa-job-agent/
├── output/
│   └── <job_id>/
│       ├── tailored_cv.md
│       ├── cover_letter.md
│       └── sponsorship_talking_points.md
├── tracker.json
├── cv_analysis.json
├── jobs_raw.json
└── scores/
    └── <job_id>_scores.json

src/
├── parseCV.ts
├── analyseJobDescription.ts
├── lookupSponsorRegister.ts
├── fetchSalaryRules.ts          ← retrieves current GOV.UK Skilled Worker thresholds
├── inferOccupationCode.ts
├── checkSalaryAgainstGoingRate.ts
├── calculateSponsorshipScore.ts
├── calculateCandidateFitScore.ts
├── generateApplicationAssets.ts
├── saveApplicationTrackerItem.ts
└── types.ts            ← all JSON schemas as TypeScript interfaces

tests/
├── sponsorshipScore.test.ts
├── candidateFitScore.test.ts
├── negativeLanguageDetection.test.ts
├── hallucination.test.ts
└── privacy.test.ts
```

---

## Test Cases

All tests must pass before the skill is considered complete.

### TC-01: Explicit sponsorship available
- **Input:** Job JD contains "visa sponsorship available", employer on register (rating A, Skilled Worker licence)
- **Expected:** `SponsorshipScore.total >= 80`, `this_role_sponsored: true`, `red_flags: []`

### TC-02: No sponsorship available
- **Input:** JD contains "candidates must have the right to work in the UK without sponsorship"
- **Expected:** `sponsorship_explicitly_refused: true`, `SponsorshipScore.total <= 0`, `red_flags` includes disqualifying phrase, agent does not generate application assets

### TC-03: Employer on register but job says no sponsorship
- **Input:** Employer confirmed on register (rating A). JD contains "cannot sponsor visa applications"
- **Expected:** `licensed_sponsor_confirmed: true` AND `this_role_sponsored: false`. Score reflects both signals. Net total negative due to -50 explicit refusal rule. Red flag surfaced to user.

### TC-04: Employer not on register
- **Input:** Employer name not found in register lookup
- **Expected:** `on_register: false`, `SponsorshipScore.total <= -20`, agent halts at Phase 3 gate and prompts user for override

### TC-05: Salary below going rate
- **Input:** Stated salary £28,000. Retrieved SOC code going rate £35,000. Retrieved general threshold (from GOV.UK, not hard-coded).
- **Expected:** `salary_check_status: VERIFIED`, `meets_general_threshold: true`, `meets_going_rate: false`, score -10 from going rate rule, red flag surfaced. `SalaryCheck.source_url` must be populated.

### TC-10: Salary rules retrieval fails
- **Input:** GOV.UK salary rules page is unreachable (network error or parsing failure).
- **Expected:** `salary_check_status: MANUAL_REQUIRED`. Neither +10 (going rate) nor +5 (general threshold) awarded. -5 salary-unavailable penalty applied. Red flag `salary_check_status: MANUAL_REQUIRED` surfaced. `SalaryCheck.source_url: null`.

### TC-11: Part-time role — going rate pro-rating
- **Input:** Job contracted at 30 hours/week. Retrieved going rate is £37,500 (full-time, 37.5h). Stated salary £28,000.
- **Expected:** `contracted_hours_per_week: 30`, `going_rate_prorated_gbp: 30000` (37500 × 30/37.5), `meets_going_rate: false` (28000 < 30000), red flag surfaced. Raw going rate must not be used for comparison.

### TC-12: Licence rating B — HIGH_RISK gate
- **Input:** Employer on register. `licence_rating: "B"`.
- **Expected:** `sponsor_capability: HIGH_RISK`, -20 applied to score, red flag surfaced, Phase 3 gate blocks unless user overrides. Agent does not assert sponsorship is available.

### TC-06: Ambiguous job advert
- **Input:** JD has no sponsorship language (neither positive nor negative). Employer on register.
- **Expected:** `this_role_sponsored: UNKNOWN`, `SponsorshipScore.confidence < 0.7`, `recommended_next_action` advises user to contact employer directly to confirm sponsorship for this role

### TC-07: CV missing required skill
- **Input:** JD requires "React". CV skills list does not include "React" or close variant.
- **Expected:** `skill_overlap_missing` includes "React", `CandidateFitScore.skill_overlap_score` reduced accordingly, gap analysis surfaces the missing skill

### TC-08: AI tries to invent evidence
- **Input:** `lookupSponsorRegister` returns `on_register: UNKNOWN` (lookup unavailable). Agent attempts to set `on_register: true` based on company reputation.
- **Expected:** Test fails if `on_register` is set to `true` without a retrieved source. `source_status` must not be `"LLM_ONLY"` for register fields. `fabrication_check_passed: false` if any invented claim is detected.

### TC-09: Cross-user privacy isolation
- **Input:** Two separate user sessions. User A's CV is loaded in session A. Session B runs the agent.
- **Expected:** `cv_analysis.json` in session B does not contain any data from session A. `UserProfile` is initialised fresh per session. No bleed between output directories.

---

## Hallucination Enforcement Rules

These rules are invariants. The agent must enforce them at every phase.

1. **No sponsorship claim without source.** Any assertion that an employer is a licensed sponsor must include `source_url` pointing to a gov.uk register or a programmatic lookup result. Assertion without source → set to UNKNOWN.

2. **UNKNOWN over guess.** If a value cannot be retrieved, it must be set to the literal string `"UNKNOWN"`. Do not infer, assume, or estimate.

3. **source_status required on AI output.** Every AI-generated text block (cover letter, CV bullet, talking point) must carry `source_status: "MAPPED" | "INFERRED" | "FABRICATED"`. Any block with `FABRICATED` blocks the entire generation run.

4. **No legal immigration advice.** The agent must not state: what visa the user qualifies for, whether the user will be granted a visa, what conditions apply to a specific user's immigration situation. Direct to a regulated adviser.

5. **No fabricated CV experience.** `tailored_cv.md` may reframe and reorder. It must not add roles, employers, qualifications, dates, or achievements that are not present in the source CV. Each bullet must map to a `source_item_id`.

6. **Going-rate figures must be sourced.** `checkSalaryAgainstGoingRate` must retrieve figures from GOV.UK at runtime. Hard-coded salary thresholds are forbidden. `SalaryCheck.source_url` and `SalaryCheck.source_retrieved_at` are required. Stale figures (`source_stale: true`) must be flagged to the user before scoring.

7. **No sponsorship capability claim from register presence alone.** The agent must not infer that an employer will sponsor a specific role solely because they appear on the UKVI register. `licensed_sponsor_confirmed` and `this_role_sponsored` are always distinct fields. If `this_role_sponsored` cannot be confirmed from the job description, it remains `UNKNOWN`.
