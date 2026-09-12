# Cheque Register: Zero-to-Hero Engineering Syllabus

**Project:** `cheque-tracker`  
**Repository:** `github.com/escorpyy/chqmgmt`  
**Audience:** A learner who can use a terminal and read basic JavaScript, but wants to become capable of understanding, extending, testing, and operating this application independently.  
**Recommended pace:** 10–12 weeks at 6–8 hours per week, or an intensive 3–4 week sprint.  
**Primary outcome:** Build production-quality confidence across the full stack by learning through this real application rather than through disconnected toy examples.

> This syllabus treats the repository as the textbook, laboratory, and capstone. Every module points to concrete files, commands, questions, and deliverables in the codebase.

## 1. What You Will Be Able to Do

By the end of the syllabus, you should be able to explain the business domain, install the application locally, trace a browser action through the API and database, modify the Prisma schema safely, add a complete feature, preserve company and user isolation, test business rules, diagnose failures, and prepare a change for review and deployment.

| Capability | Evidence of mastery |
|---|---|
| JavaScript and Node.js | You can explain ES modules, asynchronous control flow, environment variables, npm scripts, and process errors used by the server and scripts. |
| HTTP and Express | You can trace middleware order, authentication, route mounting, validation, status codes, and centralized error handling. |
| PostgreSQL and Prisma | You can read the schema, inspect generated queries, create migrations, and distinguish ORM constraints from database constraints and triggers. |
| Domain modeling | You can explain received and issued cheque lifecycles, payments, follow-ups, check logs, replacements, soft deletion, and daily balance computation. |
| Browser engineering | You can follow state, fetch calls, forms, drawers, tabs, modals, date handling, and plain JavaScript module boundaries in `public/js`. |
| Security and correctness | You can preserve session security, role checks, company scoping, input validation, and defense-in-depth payment limits. |
| Maintenance | You can add a vertical slice, document it, test it, review it, and debug it from logs and database state. |

## 2. Application Map Before You Start

The application is a single Node.js service. Express serves the JSON API and the static frontend. Prisma connects the application to PostgreSQL through `@prisma/adapter-pg` and the `pg` driver. The frontend is plain HTML, CSS, and JavaScript with no bundler or frontend framework.

| Layer | Repository location | Questions to answer |
|---|---|---|
| Process entrypoint | `server.js` | In what order are dotenv, middleware, sessions, authentication, company scope, routes, static files, and error handling installed? |
| Database model | `prisma/schema.prisma` | Which entities are shared reference data, which are company-scoped, and which record financial history? |
| Database hardening | `prisma/manual-migration-additions.sql` | Which rules require `CHECK` constraints, functional indexes, or triggers? |
| Database adapter | `lib/prisma.js` | How does a `pg.Pool` become a Prisma client through the driver adapter? |
| Cross-cutting backend helpers | `lib/*.js` | How are authentication, company scope, pagination, sorting, async errors, and derived cheque fields centralized? |
| API domains | `routes/*.js` | How are CRUD endpoints separated from lifecycle actions such as payments, replacements, follow-ups, and check-log resolution? |
| Browser shell | `public/index.html`, `public/login.html`, `public/style.css` | How is the application rendered without a build step? |
| Browser modules | `public/js/*.js` | How do state, API calls, tabs, forms, drawers, date utilities, and feature screens collaborate? |
| Operational scripts | `scripts/*.js` | How are manual database additions applied and the first administrator created? |

The project README is the first reading assignment. It describes installation, migrations, authentication, UI capabilities, business rules, and the driver-adapter setup.

## 3. Prerequisites and Environment Setup

### 3.1 Required knowledge

You should be comfortable with files and directories, Git clone and branch operations, basic SQL concepts, JSON, browser developer tools, and JavaScript functions. If any of these are unfamiliar, complete the foundation modules before changing application code.

### 3.2 Required tools

Install Node.js 18 or newer, npm, PostgreSQL, Git, and a code editor. The package manifest identifies Express, Prisma, PostgreSQL drivers, sessions, password hashing, file uploads, and spreadsheet libraries as the main dependencies.

### 3.3 First successful run

From the application directory:

```bash
cd /home/ubuntu/chqmgmt/cheque-tracker
npm install
cp .env.example .env
# Set DATABASE_URL and SESSION_SECRET in .env.
createdb cheque_tracker
npx prisma migrate dev --name init
npm run db:apply-manual
npm run create-admin -- admin 'change-this-password'
npm run dev
```

Open `http://localhost:3000`, sign in, create or select a company, and confirm that the dashboard loads. If `.env.example` is absent in your checkout, create it from the variables referenced by `lib/prisma.js` and `server.js`, then document the setup gap rather than committing secrets.

### 3.4 Setup lab

Record the output of `node --version`, `npm --version`, and `psql --version`. Check `/api/health`. Inspect the database tables and the Prisma migration directory. Write a short setup note explaining which step creates tables, which step adds SQL rules, and which step creates a user.

**Exit criterion:** You can destroy and recreate a local database, repeat the setup, and reach a working login without copying a production credential.

## 4. Learning Path at a Glance

| Phase | Modules | Main result |
|---|---:|---|
| Foundation | 0–2 | You can navigate the codebase and run small changes safely. |
| Backend core | 3–6 | You can trace and extend authenticated API behavior. |
| Data and domain | 7–9 | You can reason about financial invariants and lifecycle state. |
| Frontend | 10–12 | You can extend the no-build browser application. |
| Engineering maturity | 13–16 | You can test, secure, debug, document, and ship a vertical slice. |
| Capstone | 17 | You can design, implement, verify, and present a substantial feature. |

Each module should produce a tangible artifact. Do not advance merely because you have read the files; advance when the exit criterion is demonstrated.

## 5. Detailed Modules

### Module 0 — Orientation: Read the Product as a User

**Goal:** Understand what the application does before learning how it does it.

**Study:** Read `README.md`. Walk through login, company selection, dashboard, reference data, received cheques, issued cheques, daily balance, and import/export. Sketch the two major flows: money expected from a received cheque and money owed through an issued cheque.

**Hands-on lab:** Create one company, one bank, one party, one company bank account, one received cheque, and one issued cheque. Change a status, add a follow-up, record a partial payment, and inspect the dashboard totals. Note every visible state transition.

**Deliverable:** A one-page domain glossary defining party, firm, individual, bearer, account payee, received cheque, issued cheque, follow-up, check log, replacement, fiscal year, and daily balance.

**Exit criterion:** You can explain the product to a non-technical accountant without referring to source code.

### Module 1 — Git, Repository Navigation, and Change Discipline

**Goal:** Work safely in a shared codebase.

**Study:** The repository root, `main` branch, `.gitignore`, package lockfile, and directory layout. Learn focused commits, branch naming, diffs, blame, and reverting a local change.

**Hands-on lab:** Create a feature branch. Make a documentation-only improvement to the README or this syllabus. Inspect `git diff`, commit it, and reset a temporary uncommitted experiment.

**Deliverable:** A change log containing the command used, the reason for the change, and the verification performed.

**Exit criterion:** You can locate a behavior by searching for its UI label, API path, route declaration, schema model, and database constraint.

### Module 2 — JavaScript and Node.js Foundations in Context

**Goal:** Understand the language features used throughout the server.

**Study:** ES modules and `import`/`export`, `async`/`await`, promises, destructuring, optional chaining, nullish coalescing, arrays, objects, exceptions, and process arguments. Read `scripts/create-admin.js`, `lib/asyncHandler.js`, `lib/enums.js`, and `lib/listQuery.js`.

**Hands-on lab:** Write a small local script that parses a list of cheque statuses, rejects invalid values, and prints a safe summary. Do not add credentials or database writes. Compare synchronous exceptions with rejected promises.

**Deliverable:** Annotated notes explaining why route handlers use `asyncHandler`, why `process.argv` is used by the admin script, and how a default export differs from named exports.

**Exit criterion:** You can modify a helper without accidentally changing its return shape or losing an asynchronous error.

### Module 3 — HTTP, Express, and Middleware Order

**Goal:** Trace a request from socket to response.

**Study:** `server.js`, especially JSON parsing, compression, CORS, session setup, public routes, `requireAuth`, `loadCompanyScope`, `requireCompanyContext`, static serving, the fallback route, and the final error handler.

**Hands-on lab:** Use browser developer tools or `curl` to inspect `/api/health`, an unauthenticated API request, a login request, and an authenticated request. Record the status code, cookies, response body, and middleware behavior.

**Deliverable:** A request-flow diagram from browser to Express route to Prisma query to JSON response.

**Exit criterion:** You can predict the result of moving a middleware line and explain why route order is security-sensitive.

### Module 4 — Authentication, Sessions, Roles, and Company Scope

**Goal:** Understand the application’s access boundaries.

**Study:** `routes/auth.js`, `lib/auth.js`, `lib/companyScope.js`, `routes/users.js`, and the session configuration in `server.js`. Follow password hashing, login, logout, active users, admin-only routes, selected company state, and company-scoped routes.

**Hands-on lab:** Create an administrator and a staff account. Confirm which user can manage users. Select a company, make a request with no company context, and attempt to access data belonging to another company.

**Deliverable:** An access-control matrix covering anonymous users, staff users, administrators, company selection, and company-scoped resources.

**Exit criterion:** You can add a route and demonstrate that it has the correct authentication, role, and company-scope guards.

### Module 5 — REST API Design and Route Modules

**Goal:** Read and extend the backend API consistently.

**Study:** `routes/companies.js`, `routes/parties.js`, `routes/banks.js`, `routes/staff.js`, `routes/companyBankAccounts.js`, and `routes/fiscalYears.js`. Compare list, detail, create, update, delete, restore, and select actions.

**Hands-on lab:** Add a harmless read-only endpoint or improve an existing response with a clearly documented field. Follow existing patterns for `asyncHandler`, Prisma access, validation, status codes, and errors.

**Deliverable:** An endpoint catalogue with method, path, authentication requirement, company-scope requirement, input, output, and expected failure cases.

**Exit criterion:** You can implement a small CRUD route without leaking records across company boundaries or returning inconsistent errors.

### Module 6 — Prisma Client, Driver Adapters, and Database Operations

**Goal:** Understand how JavaScript objects become database queries.

**Study:** `lib/prisma.js`, the `generator` and `datasource` blocks in `prisma/schema.prisma`, relation fields, enum fields, `select`, `include`, `where`, `orderBy`, pagination, and transactions where present.

**Hands-on lab:** Use Prisma Studio and SQL inspection tools to compare an application query with the stored rows. Modify a safe query to return only the fields a screen needs. Explain why selecting fewer fields can improve clarity and reduce accidental exposure.

**Deliverable:** A query notebook containing three examples: a filtered list, a relation include, and a paginated/sorted query.

**Exit criterion:** You can distinguish a Prisma schema change, a generated client change, a migration, and a manual SQL addition.

### Module 7 — Relational Modeling and Migration Safety

**Goal:** Read the complete data model as a set of invariants.

**Study:** All models and enums in `prisma/schema.prisma`. Group them into identity and access (`User`, `Company`), reference data (`Party`, `Bank`, `Staff`, `CompanyBankAccount`, `FiscalYear`), cheque records, lifecycle logs, payments, receipts, and daily balances.

**Hands-on lab:** Draw the relationship graph. Identify primary keys, foreign keys, optional relationships, unique fields, timestamps, soft-delete fields, and status enums. Create a migration in a disposable database, inspect it, and reset the database safely.

**Deliverable:** A data dictionary listing each model, its purpose, important fields, relationships, and deletion behavior.

**Exit criterion:** You can predict the impact of adding a required field, changing an enum, or deleting a referenced row before running a migration.

### Module 8 — Financial Invariants and Database Defense in Depth

**Goal:** Learn why business rules must be enforced in more than one layer.

**Study:** `prisma/manual-migration-additions.sql`, validation in cheque routes, the error handling in `server.js`, and the payment routes. Focus on positive amounts, date ordering, non-negative balances, case-insensitive bank uniqueness, and aggregate payment triggers.

**Hands-on lab:** Attempt invalid operations through the UI, API, and direct SQL where safe. Test a payment that exceeds the remaining balance. Observe the client-side response, server-side response, and database trigger behavior.

**Deliverable:** An invariant table with rule, enforcement layer, failure response, and a test that proves the rule.

**Exit criterion:** You can explain why an aggregate payment limit cannot be represented by a simple row-level `CHECK` constraint and why a database trigger is a final safeguard rather than a replacement for application validation.

### Module 9 — Received and Issued Cheque Lifecycles

**Goal:** Understand the central business state machines.

**Study:** `routes/cheques.js`, `routes/issuedCheques.js`, `lib/chequeHelpers.js`, `lib/enums.js`, and the corresponding frontend modules `public/js/received.js` and `public/js/issued.js`.

**Hands-on lab:** For both directions, execute a lifecycle: create, list, inspect, change status, add follow-up, add partial payment, mark `ON_CHECK`, resolve a check log, and create a replacement where supported. Record the status and date after every action.

**Deliverable:** Two state diagrams and a comparison table showing where received and issued flows are symmetric and where they differ, including stop payment and replacement behavior.

**Exit criterion:** You can add a new lifecycle action while preserving previous status snapshots, date calculations, payment totals, and audit history.

### Module 10 — Plain Browser JavaScript and Application State

**Goal:** Become productive in a frontend without React, Vue, or a build system.

**Study:** `public/js/main.js`, `state.js`, `api.js`, `tabs.js`, `drawer.js`, `modal.js`, `toast.js`, `utils.js`, and `constants.js`. Trace how an event updates state, calls the API, rerenders a region, and reports errors.

**Hands-on lab:** Add a small read-only dashboard indicator or improve an empty-state message. Use the browser Network and Console panels to trace the complete interaction.

**Deliverable:** A component map describing each frontend module’s inputs, outputs, DOM responsibilities, and API dependencies.

**Exit criterion:** You can fix a frontend bug without introducing duplicate event listeners, stale state, or an unhandled rejected promise.

### Module 11 — Forms, Dates, Accessibility, and Financial Data Entry

**Goal:** Handle user input accurately and accessibly.

**Study:** `public/js/bsDatePicker.js`, `nepaliDate.js`, `autocomplete.js`, `combobox.js`, form markup in `index.html`, and relevant CSS. Pay attention to required fields, date ordering, numeric amounts, keyboard operation, focus, and visible error messages.

**Hands-on lab:** Test keyboard-only entry, invalid dates, a partial payment, autocomplete selection, and a form submission with missing required data. Fix one accessibility or validation defect and document it.

**Deliverable:** A manual test script for cheque entry that includes valid, invalid, boundary, keyboard, and recovery cases.

**Exit criterion:** You can add a form field with consistent parsing, validation, server payload construction, error display, and keyboard behavior.

### Module 12 — Dashboard, Daily Balance, Import, Export, and Spreadsheet Workflows

**Goal:** Understand derived views and file-based workflows.

**Study:** `routes/dashboard.js`, `routes/dailyBalance.js`, `routes/importExport.js`, `public/js/dashboard.js`, `dailyBalance.js`, and `importExport.js`. Review ExcelJS/XLSX usage and the daily balance rule that includes all still-issued cheques due on or before the selected day.

**Hands-on lab:** Create daily balances for more than one bank account and date. Export a report. Import a sample dataset in a disposable database. Verify totals against a manual calculation.

**Deliverable:** A reconciliation worksheet documenting source records, formula, expected result, exported result, and any rounding assumptions.

**Exit criterion:** You can distinguish stored values from computed values and explain how an export can be validated against the source query.

### Module 13 — Testing Strategy for a Financial CRUD System

**Goal:** Build confidence before changing behavior.

**Study:** Existing project support for testing, route validation, manual SQL, and the most failure-prone business rules. If the repository has no test suite, design one before implementing it.

**Hands-on lab:** Create a test plan with unit tests for pure helpers, API tests for authentication and company scope, integration tests for payment limits and status transitions, and browser-level smoke tests for login and one cheque flow. Use isolated databases or fixtures.

**Deliverable:** A risk-prioritized test matrix. Highest priority should include cross-company access, inactive users, admin-only actions, overpayment, date ordering, soft deletion, replacement rules, and daily balance calculation.

**Exit criterion:** You can reproduce a defect with a failing test and demonstrate that the fix does not weaken another invariant.

### Module 14 — Security, Privacy, and Operational Hardening

**Goal:** Treat financial records and credentials as sensitive data.

**Study:** Session cookies, password hashing, secret management, CORS, file uploads, import validation, SQL injection boundaries, authorization, logging, error details, and soft deletion. Review what the production environment should and should not expose.

**Hands-on lab:** Perform a small threat model. Attempt unauthorized record access, malformed inputs, oversized uploads, invalid file types, and error-triggering requests in a disposable environment. Recommend fixes for any gaps.

**Deliverable:** A threat register with asset, threat, likelihood, impact, current control, and proposed mitigation.

**Exit criterion:** You can review a new endpoint and identify authentication, authorization, validation, data exposure, upload, and logging concerns before approval.

### Module 15 — Debugging and Observability

**Goal:** Diagnose issues systematically instead of guessing.

**Study:** Server logs, browser console and network panels, `/api/health`, PostgreSQL logs, Prisma errors, status codes, and the centralized error handler. Learn to separate client, API, ORM, database, and environment failures.

**Hands-on lab:** Introduce and diagnose three controlled failures: a missing environment variable, an invalid request, and a database constraint violation. Capture the evidence used to locate each fault.

**Deliverable:** A troubleshooting runbook organized by symptom, likely layer, evidence to collect, safe next action, and escalation point.

**Exit criterion:** You can explain a failure with a reproducible sequence and a minimal fix rather than only describing the visible symptom.

### Module 16 — Production Readiness and Maintainable Delivery

**Goal:** Prepare a change for real users.

**Study:** npm scripts, Node version constraints, migrations, backups, session persistence, environment configuration, static caching, graceful shutdown considerations, rollback planning, and documentation.

**Hands-on lab:** Create a release checklist. Perform a clean install in a fresh directory, apply migrations to a disposable database, run the smoke test, inspect the generated diff, and write rollback steps for a schema change.

**Deliverable:** A release note containing summary, migration impact, security impact, test evidence, operational steps, rollback plan, and known limitations.

**Exit criterion:** Another developer can deploy and verify your change using only the repository documentation and release note.

## 6. Capstone: Add a Complete Vertical Slice

Choose one feature that is useful but bounded. Suitable options include cheque reminders, a payment-history summary, a printable cheque detail view, a party activity report, a duplicate-import preview, or an audit activity screen. Avoid a feature that only changes CSS or adds a single field.

### Required capstone phases

1. **Problem definition:** State the user, workflow, current limitation, success metric, and non-goals.
2. **Domain design:** Identify models, relationships, statuses, invariants, and whether the feature belongs to received cheques, issued cheques, or both.
3. **API design:** Define routes, authentication, company scope, request shape, response shape, validation, and errors.
4. **Database plan:** Decide whether a schema change is necessary. Prepare a migration and identify any manual SQL rule.
5. **Backend implementation:** Add the route, use shared helpers where appropriate, preserve existing error conventions, and prevent cross-company leakage.
6. **Frontend implementation:** Add state handling, API calls, loading and empty states, validation, accessible controls, and error recovery.
7. **Verification:** Add unit, API/integration, and browser smoke coverage. Test boundary and unauthorized cases.
8. **Documentation:** Update the README or a feature note, add a data or API reference, and write release notes.
9. **Review:** Inspect the diff as a reviewer. Remove unrelated changes. Explain trade-offs and known limitations.

### Capstone acceptance rubric

| Area | Weight | Passing evidence |
|---|---:|---|
| Domain correctness | 20% | The feature matches the cheque and company model and handles boundary states. |
| Authorization and isolation | 20% | Anonymous, wrong-role, and wrong-company cases are rejected. |
| Data integrity | 15% | Validation exists at the appropriate application and database layers. |
| Backend quality | 15% | Routes are consistent, errors are handled, and queries are scoped and efficient enough for the use case. |
| Frontend quality | 15% | The UI provides loading, empty, success, error, and keyboard-accessible states. |
| Testing | 10% | Tests cover happy path, invalid input, boundary values, and authorization. |
| Documentation and delivery | 5% | Setup, migration, verification, and rollback information are clear. |

A passing capstone requires at least 70% overall and no critical failure in authorization, company isolation, credential handling, or financial invariant enforcement.

## 7. Suggested Weekly Schedule

| Week | Focus | Concrete output |
|---:|---|---|
| 1 | Modules 0–2 | Working local setup, glossary, repository map, first focused commit |
| 2 | Modules 3–4 | Request-flow diagram and access-control matrix |
| 3 | Modules 5–6 | Endpoint catalogue and query notebook |
| 4 | Modules 7–8 | Data dictionary and invariant table |
| 5 | Module 9 | Received and issued lifecycle diagrams |
| 6 | Modules 10–11 | Frontend component map and manual form test script |
| 7 | Module 12 | Reconciliation worksheet and export/import exercise |
| 8 | Modules 13–14 | Test matrix and threat register |
| 9 | Modules 15–16 | Troubleshooting runbook and release checklist |
| 10–12 | Capstone | Design, implementation, verification, review, and presentation |

## 8. Daily Study Loop

Begin each session by stating one question that the code should answer. Read the smallest relevant set of files. Reproduce the behavior locally. Make one focused change. Verify both the happy path and the nearest failure path. Record what changed, what you learned, and what remains uncertain. End by committing only work that has a clear purpose.

A useful investigation sequence is:

1. Find the user-visible label or API path.
2. Find the frontend event handler or fetch call.
3. Find the Express route.
4. Find the authorization and company-scope guards.
5. Find the Prisma query and schema relation.
6. Find the database constraint or trigger.
7. Reproduce the behavior with valid and invalid data.
8. Change the narrowest responsible layer.
9. Verify the entire flow.

## 9. Completion Checklist

You are ready to call yourself independent on this project when you can complete all of the following without step-by-step assistance:

- Explain the architecture and major business terms.
- Recreate the local environment from documented instructions.
- Add a company-scoped CRUD resource safely.
- Trace login and session behavior.
- Explain the difference between received and issued cheque flows.
- Add and test a lifecycle action.
- Preserve soft deletion and financial history.
- Prevent overpayment at the UI, API, and database layers.
- Diagnose a migration, validation, session, and database failure.
- Add a frontend screen using the existing no-build patterns.
- Validate an import and reconcile an export.
- Write tests for an authorization boundary and a financial invariant.
- Produce a release note with migration and rollback information.
- Defend the design decisions in a code review.

## 10. Recommended References

Use the repository documentation as the authoritative source for project-specific behavior. Use the external references below to clarify the underlying technologies.

### References

[1]: https://nodejs.org/docs/latest/api/ "Node.js Documentation"

[2]: https://expressjs.com/en/guide/using-middleware.html "Express Middleware Guide"

[3]: https://www.prisma.io/docs/orm "Prisma ORM Documentation"

[4]: https://www.postgresql.org/docs/current/ddl-constraints.html "PostgreSQL Constraints Documentation"

[5]: https://developer.mozilla.org/en-US/docs/Web/JavaScript "MDN JavaScript Guide and Reference"

[6]: https://developer.mozilla.org/en-US/docs/Web/HTTP "MDN HTTP Documentation"

[7]: https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Accessibility "MDN Accessibility Guide"

[8]: https://git-scm.com/book/en/v2 "Pro Git Book"

[9]: https://github.com/escorpyy/chqmgmt "Cheque Register Repository"

## 11. Instructor or Self-Study Notes

The syllabus intentionally moves from user behavior to architecture, then from architecture to invariants, and finally from invariants to delivery. The most important habit is to resist treating the application as a collection of screens. A financial workflow is a set of records, transitions, permissions, and non-negotiable rules. Every feature exercise should therefore answer four questions: **Who may perform the action? Which company does it affect? What state transition does it cause? Which layer guarantees that invalid data cannot persist?**

When you cannot answer one of those questions, pause implementation and investigate the relevant route, helper, schema model, or SQL constraint. That discipline is the difference between making a page appear to work and becoming capable of maintaining the system.