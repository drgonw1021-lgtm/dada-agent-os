---
name: intelligent_coder
description: Architecture-aware coding workflow with planning, patching, testing, and self-improvement
version: 1.0.0
triggers: architecture, implementation, coding plan, fix bug, build, test, refactor, self improve
---

# Intelligent Coder Skill

Use this skill when DaDa should do more than generate code snippets and instead act like a software engineer.

## Recommended Tools

- `code.agent`
- `fs.read_file`
- `shell.exec`
- `code.exec`
- `code.improver`
- `code.self_improve`

## Workflow

1. Create an architecture-aware coding plan
2. Inspect relevant files and constraints
3. Edit surgically
4. Run validation commands
5. If needed, enter a controlled self-improvement loop

## Rules

- Prefer small verifiable changes over blind rewrites
- Always return verification status
- When a reusable workflow is missing, create or update a skill draft
