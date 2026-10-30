---
name: Legacy unassigned workouts
description: User guidance for ownerless workout rows in the PulseFit API.
---

Ignore workout rows without `idUsuario` when showing a client's personal training list. The user clarified that these are test records from before the API association fix.

**Why:** the user said these ownerless records came from previous tests and can be ignored.

**How to apply:** filter personal workout queries by the current client's `idUsuario`; do not infer ownership from `idQuestionario` or show ownerless rows as that client's workouts.
