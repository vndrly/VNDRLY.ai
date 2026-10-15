# Sample quiz CSV format

Open training-quiz-template.csv in Excel or another spreadsheet editor. Each row is one question; the first row contains column names. These are fictional product-training examples, not an approved company policy.

| Column | Meaning |
|---|---|
| question_id | Unique stable ID, such as q1 or q2. |
| question | Full question text. |
| choice_a through choice_d | Two to four answers; unused trailing choices may be blank. |
| correct_answers | One uppercase letter, or semicolon-separated letters such as B;C. |
| multiple_answers | TRUE when employees must select more than one answer; otherwise FALSE. |
| explanation | Optional author explanation. Kept private during retries unless a future reviewed feedback rule permits it. |

Save as UTF-8 CSV. Spreadsheet software handles commas, quotes and line breaks by quoting cells. Keep the header unchanged, use unique question IDs, and make sure each correct-answer letter refers to a nonempty choice. A multiple-answer question requires all correct selections and no incorrect selections to receive credit.

Passing score, retry limits, lessons and completion checkoffs belong to the training editor rather than repeating on each question row.

The CSV includes the answer key: keep it with administrators, not employee downloads. The planned employee question projection excludes those keys.

Status: this is a proposed import-compatible template for review. The current application has no CSV quiz importer, so this file cannot be uploaded into the app yet. Implementing an importer would require matching these columns, validation and draft preview before saving; importing must never publish or assign automatically.
