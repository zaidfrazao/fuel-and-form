# CLAUDE.md

This file provides guidance to Claude Code when working with this project.

## Project Overview

**Fuel & Form** (`fuel-and-form`): A personal fitness & nutrition tracker — meal planning with swaps, workout scheduling, and weekly check-in exports. Public repository, also serving as a portfolio piece.

## Project Documentation

Key project documents are stored in the `docs/` folder:
- `docs/PRD.md` - Product requirements document
- `docs/BRAND_GUIDE.md` - Brand and UX guidelines
- `docs/TESTING_STRATEGY.md` - Testing approach and strategy

## Configuration

Project settings are in `.claude/project.yaml`. This includes:
- Build commands and tooling
- Git branch conventions
- Project-management workflow statuses
- Team configuration

## Slash Commands

### Project Setup (`/fra:` commands)
- `/fra:status` - Check project setup progress
- `/fra:prd` - Define product requirements
- `/fra:brand` - Define brand and UX guidelines
- `/fra:testing` - Define testing strategy
- `/fra:setup-pm` - Create the project-management structure
- `/fra:save` - Commit and push changes

### Development (`/zao:` commands) — branch + PR workflow
- `/zao:workflow` - View the development workflow
- `/zao:begin-task TSK-XXX` - Start working on a task (creates a branch)
- `/zao:implement-task` - Build the planned task
- `/zao:test-task` - Run tests and checks
- `/zao:submit-task` - Create PR for review
- `/zao:finish-task` - Merge and complete task
- `/zao:check-status` - Check current task status

**PR approval is not required** on this project (`git.require_pr_approval: false`). PRs are still created for a reviewable diff and CI, but `/zao:finish-task` may merge as soon as checks pass — do not wait for an approving review.

## Security Note

This repository is **public**. Never commit the owner password, session secret, or database connection string — keep them in `.env.local` (gitignored) and configure them as environment variables in Vercel.
