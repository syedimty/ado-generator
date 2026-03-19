# CSV Format Reference

This document describes the structure, column definitions, escaping rules, and import guidance for the CSV file exported by the **ADO Work Item Generator**.

---

## Table of Contents

1. [Overview](#overview)
2. [Column Definitions](#column-definitions)
3. [Row Types](#row-types)
4. [Escaping Rules](#escaping-rules)
5. [Example CSV](#example-csv)
6. [Importing into Azure DevOps](#importing-into-azure-devops)
7. [File Naming Convention](#file-naming-convention)

---

## Overview

The exported file is a plain-text **comma-separated values (CSV)** file that follows [RFC 4180](https://www.rfc-editor.org/rfc/rfc4180). It is encoded as **UTF-8** and saved to the operating system's temporary directory.

Each file contains:
- **1 header row**
- **1 EPIC row**
- **2–8 User Story rows** (one per generated story)

---

## Column Definitions

| # | Column name          | Epic row value         | User Story row value           | Notes |
|---|----------------------|------------------------|--------------------------------|-------|
| 1 | `Work Item Type`     | `Epic`                 | `User Story`                   | Literal string; used to identify the row type on import. |
| 2 | `Title`              | EPIC title             | User Story title               | Short, descriptive name. |
| 3 | `Description`        | EPIC description       | "As a… I want… So that…" text  | User Stories use the standard agile user-story narrative format. |
| 4 | `Acceptance Criteria`| Semicolon-joined list  | Semicolon-joined list          | Multiple criteria are joined with `; ` into a single cell value. |
| 5 | `Priority`           | `Critical`/`High`/`Medium`/`Low` | same | Maps directly to Azure DevOps priority values. |
| 6 | `Story Points`       | *(empty)*              | Fibonacci number (1,2,3,5,8,13)| Empty for Epics because Epics do not receive story-point estimates. |
| 7 | `Effort`             | Estimated hours        | *(empty)*                      | Total estimated effort in hours; only set for the Epic. |
| 8 | `Tasks`              | *(empty)*              | Semicolon-joined list          | Individual subtasks; only set for User Stories. |
| 9 | `Parent`             | *(empty)*              | EPIC title                     | References the parent EPIC by title to establish the hierarchy. |
| 10| `Change Request Type`| Type from input        | Same as EPIC row               | Echoes the `ChangeRequestType` field from the original input. |

---

## Row Types

### Epic Row

```
Epic,"<epic title>","<description>","<crit 1>; <crit 2>",High,,40,,,"New Feature"
```

- Columns `Story Points` (6) and `Tasks` (8) are **empty**.
- Column `Parent` (9) is **empty** (the Epic itself is the top-level item).
- Column `Effort` (7) contains the total estimated hours.

### User Story Row

```
User Story,"<story title>","As a user I want...","<crit 1>; <crit 2>",Medium,5,,
"<task 1>; <task 2>","<epic title>","New Feature"
```

- Column `Effort` (7) is **empty** (story-point estimates are used instead).
- Column `Parent` (9) contains the **exact title** of the parent Epic.
- Column `Story Points` (6) is a Fibonacci integer.

---

## Escaping Rules

The `convertToCSV` function applies the following escaping logic to every cell value:

| Condition | Action |
|-----------|--------|
| `null` or `undefined` | Replaced with an empty string `""` |
| Contains a comma (`,`) | Entire value wrapped in double-quotes |
| Contains a double-quote (`"`) | All double-quotes doubled (`""`) and value wrapped in double-quotes |
| Contains a newline (`\n`) | Entire value wrapped in double-quotes |
| None of the above | Written as-is (no quoting) |

This is standard RFC 4180 escaping and is compatible with Excel, Google Sheets, and the Azure DevOps CSV importer.

**Example – value with a comma:**

Raw value: `Performance, reliability, and security`
CSV cell: `"Performance, reliability, and security"`

**Example – value with a double-quote:**

Raw value: `Support "dark mode" toggle`
CSV cell: `"Support ""dark mode"" toggle"`

---

## Example CSV

The following example shows a complete exported file for a simple authentication feature request.

```csv
Work Item Type,Title,Description,Acceptance Criteria,Priority,Story Points,Effort,Tasks,Parent,Change Request Type
Epic,User Authentication System,"Implement a secure, scalable authentication system with login, registration, and password reset flows","Users can register with email and password; Users can log in and receive a JWT; Password reset emails are sent within 30 seconds",High,,80,,,"New Feature"
User Story,User Registration,"As a new user I want to create an account so that I can access the application","Registration form accepts email and password; Passwords are hashed with bcrypt; Duplicate email addresses are rejected with a clear error",High,5,,,"Create React registration form; Implement bcrypt password hashing; Add email uniqueness validation; Write unit tests for registration endpoint","User Authentication System","New Feature"
User Story,User Login,"As a registered user I want to log in so that I can access my personal data","Login form accepts email and password; A JWT is returned on success; Invalid credentials show a generic error message",High,3,,,"Build login API endpoint; Implement JWT generation; Add rate limiting to login route; Write integration tests","User Authentication System","New Feature"
User Story,Password Reset,"As a user who has forgotten their password I want to reset it via email so that I can regain access to my account","A reset-password email is sent within 30 seconds; Reset links expire after 1 hour; Users are redirected to a new-password form on clicking the link",Medium,5,,,"Create password reset request endpoint; Integrate email service; Implement token expiry logic; Test full reset flow end-to-end","User Authentication System","New Feature"
```

---

## Importing into Azure DevOps

Azure DevOps supports CSV import via the **Boards → Work Items → Import** feature (available in some plans and configurations). The expected column names may differ from this extension's output; you may need to perform a column-mapping step.

### Recommended import steps

1. Export the CSV from the extension (command palette → `ADO Work Item Generator: Download Work Items CSV`).
2. Open the CSV in a spreadsheet application (Excel, Google Sheets, LibreOffice Calc) to review and optionally modify values.
3. In Azure DevOps, navigate to **Boards → Work Items**.
4. Click the **⚙ Settings** or **Import** option (exact location varies by version).
5. Upload the CSV and map columns to Azure DevOps fields as prompted.
6. Review the imported items and adjust story points, priorities, and tasks as needed.

> **Tip:** The `Parent` column establishes the Epic → User Story hierarchy when the Azure DevOps importer supports hierarchical imports. If your import tool does not support this column directly, link parent and child items manually after import.

---

## File Naming Convention

Exported files are named using the pattern:

```
ado-workitems-<timestamp>.csv
```

Where `<timestamp>` is the ISO 8601 date-time at the moment of export, with `:` and `.` replaced by `-` to satisfy Windows and macOS file-system constraints:

```
ado-workitems-2024-06-01T14-30-00-000Z.csv
```

Files are written to the operating system's **temporary directory** (`os.tmpdir()`):
- **macOS / Linux:** typically `/tmp`
- **Windows:** typically `C:\Users\<username>\AppData\Local\Temp`

The file is opened automatically in the default application for `.csv` files immediately after writing.
