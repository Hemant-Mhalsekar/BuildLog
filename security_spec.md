# BuildLog 2.0 Firestore Security Specification

## 1. Data Invariants
1. **Authentication Mandatory**: Zero anonymous or unauthenticated read/list/create/update/delete access across all collections.
2. **Strict Owner Isolation**: Every document in `integrations`, `repositories`, `activity_events`, `activity_summaries`, and `project_memory` carries an immutable `ownerId` matching `request.auth.uid`. `users/{userId}` matches `request.auth.uid == userId` and forbids `list`.
3. **Referential Master Gates**:
   - `repositories` require `integrationId` referencing an existing `/integrations/{id}` owned by `request.auth.uid`.
   - `activity_events`, `activity_summaries`, and `project_memory` require `repositoryId` referencing an existing `/repositories/{id}` owned by `request.auth.uid`.
4. **Immutable Ownership & Bounded Payloads**: Strict `keys().hasAll(...)`, `keys().hasOnly(...)`, `affectedKeys().hasOnly(...)`, bounded string lengths, bounded list sizes, and regex-guarded document IDs.

## 2. Adversarial Payloads (Must Return PERMISSION_DENIED)
1. Unauthenticated `list` on `/repositories` or `/activity_events`.
2. Account A reading Account B's `/integrations/{idB}`, `/repositories/{idB}`, or `/project_memory/{idB}`.
3. Query scraping `/activity_events` without `where('ownerId', '==', uid)`.
4. Creating a repository referencing another user's `integrationId`.
5. Creating an `activity_event` referencing a non-existent or another user's `repositoryId`.
6. Modifying `ownerId` or `repositoryId` on update.
7. Injecting shadow fields (`isAdmin: true`, `rawSecretToken: "..."`) on create or update.
8. Listing `/users` to enumerate emails.
9. Updating `/users/{uidB}` from Account A.
10. Supplying invalid `provider` (`"bitbucket"`) or invalid `processingStatus` (`"hacked"`).
11. Resource poisoning via > 128 char document ID or oversized `changedFiles` / `description`.
12. Spoofing `connectedAt` / `generatedAt` / `lastUpdatedAt` away from `request.time`.
