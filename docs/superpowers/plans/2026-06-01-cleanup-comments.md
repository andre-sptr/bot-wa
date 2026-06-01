# Cleanup Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up excessive comments across the codebase, removing decoration lines (`===`), trimming verbose comments into single concise sentences, and ensuring consistent style.

**Architecture:** We will systematically go through the `server.js`, `chatContext.js`, and files within the `modules/` directory to strip redundant documentation and standardize remaining comments to exactly what is needed for clarity. Test files will also be briefly checked.

**Tech Stack:** Node.js, JavaScript

---

### Task 1: Clean root files (server.js, chatContext.js)

**Files:**
- Modify: `server.js`
- Modify: `chatContext.js`

- [ ] **Step 1: Write a script to find excessive comments**
```bash
grep -n "====" server.js chatContext.js
```

- [ ] **Step 2: Clean up server.js**
Use `sed` or node to remove header blocks and simplify inline comments to a single sentence. Ensure logical sections only retain short context notes.
*(Agent will use Edit or Write tools to manually apply cleanups)*

- [ ] **Step 3: Clean up chatContext.js**
Remove heavy comment boxes and verbose explanations.
*(Agent will use Edit or Write tools to manually apply cleanups)*

- [ ] **Step 4: Run tests to verify no syntax error introduced**
```bash
npm test
```
Expected: PASS

- [ ] **Step 5: Commit changes**
```bash
git add server.js chatContext.js
git commit -m "refactor: clean up excessive comments in root files"
```

### Task 2: Clean modules (Part 1 - Core AI and API wrappers)

**Files:**
- Modify: `modules/aiAdvanced.js`
- Modify: `modules/aiFeatures.js`
- Modify: `modules/bubuPersona.js`
- Modify: `modules/reasoning.js`

- [ ] **Step 1: Simplify modules/aiAdvanced.js**
Remove the banner `// =====` and `// Local intent classification...`.

- [ ] **Step 2: Simplify modules/aiFeatures.js**
Remove comment boxes and condense documentation of function parameters.

- [ ] **Step 3: Simplify modules/bubuPersona.js & reasoning.js**
Condense prompt design documentation into succinct 1-sentence explanations if present.

- [ ] **Step 4: Run tests**
```bash
npm test
```

- [ ] **Step 5: Commit changes**
```bash
git add modules/aiAdvanced.js modules/aiFeatures.js modules/bubuPersona.js modules/reasoning.js
git commit -m "refactor: clean up comments in core AI modules"
```

### Task 3: Clean modules (Part 2 - Infrastructure & Messaging)

**Files:**
- Modify: `modules/automation.js`
- Modify: `modules/commands.js`
- Modify: `modules/webhookProcessor.js`
- Modify: `modules/webhookDebug.js`
- Modify: `modules/messageTriggers.js`

- [ ] **Step 1: Remove block comments from infrastructure modules**
Strip decorative block comments and shorten multi-line comments.

- [ ] **Step 2: Consolidate comments to single sentences**

- [ ] **Step 3: Run tests**
```bash
npm test
```

- [ ] **Step 4: Commit changes**
```bash
git add modules/automation.js modules/commands.js modules/webhookProcessor.js modules/webhookDebug.js modules/messageTriggers.js
git commit -m "refactor: clean up comments in infrastructure modules"
```

### Task 4: Clean remaining modules

**Files:**
- Modify: `modules/crypto.js`
- Modify: `modules/storage.js`
- Modify: `modules/systemBlocks.js`
- Modify: `modules/dmSafety.js`
- Modify: `modules/groupRoster.js`
- Modify: `modules/lidResolver.js`
- Modify: `modules/lifecycle.js`
- Modify: `modules/mentionHelper.js`
- Modify: `modules/proactiveGuard.js`
- Modify: `modules/cooldownStore.js`

- [ ] **Step 1: Strip remaining headers and excessive docs**
Make sure all of these remaining files only have one-sentence context markers where absolutely necessary.

- [ ] **Step 2: Run tests**
```bash
npm test
```

- [ ] **Step 3: Commit changes**
```bash
git add modules/
git commit -m "refactor: clean up comments in remaining modules"
```
