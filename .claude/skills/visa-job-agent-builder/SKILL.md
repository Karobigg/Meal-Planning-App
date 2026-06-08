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
- `minimum_salary_gbp`: `26200` (current Skilled Worker general threshold as of 2024)
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

**Phase gate:** Do not proceed to Phase 4 for any job where `on_register: false` unless the user explicitly overrides.

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
| Employer on UKVI sponsor register | +35 | `EmployerSponsorLookup.on_register: true` with source |
| Licence rating is "A" (not "B") | +10 | `EmployerSponsorLookup.licence_rating: "A"` |
| Worker licence includes "Skilled Worker" | +15 | `worker_licence_types` contains "Skilled Worker" |
| Job description explicitly states sponsorship available | +20 | `sponsorship_language_positive` extracted from JD |
| Salary meets or exceeds going rate for SOC code | +10 | `salary_analysis.meets_going_rate: true` |
| Salary meets general threshold (£26,200) | +5 | `salary_analysis.meets_general_threshold: true` |
| Negative sponsorship language detected | -50 | `sponsorship_explicitly_refused: true` |
| Employer not on register | -35 | `on_register: false` |
| Salary stated below going rate | -10 | `salary_analysis.meets_going_rate: false` |
| Salary not stated | -5 | `salary_stated: null` |

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

- `sponsorship_explicitly_refused: true` — job has disqualifying language
- `on_register: false` — employer is not a licensed sponsor
- `on_register: UNKNOWN` and `lookup_method: MANUAL_REQUIRED` — register not checked programmatically
- `licence_rating: "B"` — employer is on a time-limited action plan; may not assign new CoS
- `salary_analysis.meets_going_rate: false` — salary below occupation going rate
- `CandidateFitScore < 40` — significant skills gap detected
- `cv_status: MISSING` — no CV available; scores are based on defaults

---

## Verification Checklist

Before marking any job as "recommended":

- [ ] `EmployerSponsorLookup.source_url` is populated and is a gov.uk URL
- [ ] `SponsorshipScore.evidence_found` contains at least one retrieved item
- [ ] `SponsorshipScore.confidence >= 0.5`
- [ ] No red flags are unacknowledged by the user
- [ ] `salary_analysis.meets_general_threshold: true`
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
  "licence_rating": "A | B | UNKNOWN",
  "worker_licence_types": ["string"],
  "skilled_worker_eligible": "boolean | UNKNOWN",
  "lookup_method": "PROGRAMMATIC | MANUAL_REQUIRED",
  "source_url": "string | null",
  "last_verified_date": "ISO8601 date | null",
  "lookup_notes": "string | null"
}
```

### SponsorshipScore
```json
{
  "job_id": "string",
  "total": "integer",
  "confidence": "float",
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

### checkSalaryAgainstGoingRate(salary_gbp: integer, soc_code: string) → object
- Returns: `{ meets_general_threshold, meets_going_rate, going_rate_gbp, general_threshold_gbp, source }`
- General threshold: £26,200 (verify against current UKVI guidance before using)
- Going rate is SOC-code-specific; if SOC unknown, can only check general threshold
- Source field must identify where the going rate figure was obtained

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
- **Input:** Stated salary £28,000. SOC code going rate £35,000. General threshold £26,200.
- **Expected:** `meets_general_threshold: true`, `meets_going_rate: false`, score -10 from going rate rule, red flag surfaced

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

6. **Going-rate figures must be sourced.** `checkSalaryAgainstGoingRate` must identify where the going-rate figure came from. Stale figures must be flagged with `source_date` if older than 6 months.
