---
agent: 'agent'
description: 'Visual UI verification — inspect layout, responsiveness, and interactions (limited without Chrome DevTools)'
---

# Visual Review

Perform visual verification of UI changes.

> **Note:** Full visual review with automated screenshots requires the Chrome DevTools MCP server, which is only available in Claude Code. In GitHub Copilot, this workflow guides you through a structured manual visual check.

## What to Verify

### Layout and Responsiveness

Run the application locally:

```bash
npm run dev     # Start frontend
dotnet run      # Start backend (if needed)
```

Open the browser and check each changed UI component:

**Desktop (>= 1280px)**
- [ ] Layout matches design intent
- [ ] No overflow or clipping
- [ ] Spacing and alignment are consistent

**Tablet (768px – 1279px)**
- [ ] Layout adapts correctly (no broken stacks)
- [ ] Touch targets are large enough (min 44px)

**Mobile (< 768px)**
- [ ] Layout is usable on small screens
- [ ] No horizontal scrollbar
- [ ] Navigation is accessible

### Component States

For each changed component, verify all states:

- [ ] **Default** — initial render
- [ ] **Loading** — async operations in flight
- [ ] **Empty** — no data / empty list
- [ ] **Error** — failed request / validation error shown
- [ ] **Success** — completed action feedback

### Interactions

- [ ] **Click targets** — buttons and links respond correctly
- [ ] **Hover states** — visual feedback on interactive elements
- [ ] **Focus states** — keyboard navigation works (Tab, Enter, Escape)
- [ ] **Form validation** — inline errors appear at the right time

### Accessibility

- [ ] Color contrast — text is readable (WCAG AA: 4.5:1 for normal text)
- [ ] Icons have labels or `aria-label`
- [ ] Images have `alt` text
- [ ] Form fields have associated labels

## Checklist Template

Fill in this checklist in your review notes:

```markdown
## Visual Review Checklist

**Date:** YYYY-MM-DD
**Branch:** feature/...
**Changes reviewed:** <list of changed components>

### Layout
- [ ] Desktop layout correct
- [ ] Tablet layout correct
- [ ] Mobile layout correct

### States
- [ ] Default state
- [ ] Loading state
- [ ] Error state
- [ ] Empty state

### Interactions
- [ ] Click/tap works
- [ ] Keyboard navigation works
- [ ] Form validation shows errors

### Accessibility
- [ ] Color contrast
- [ ] Focus indicators
- [ ] Screen reader labels

**Result:** ✅ Pass / ❌ Fail — <notes>
```

## If Issues Are Found

Document each issue:

```
Issue: <Component> <screen size> — <description>
Screenshot: [attach if possible]
Expected: <what should happen>
Actual: <what is happening>
```

Fix the issue, then re-run the visual check for that component.
