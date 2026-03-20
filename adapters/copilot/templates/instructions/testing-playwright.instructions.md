---
applyTo: '**/*.spec.ts'
---

# Playwright Testing Best Practices

## Project Structure

```
e2e/
├── tests/              # Test files organized by feature
├── pages/              # Page Object Model files
├── fixtures/           # Custom fixtures (auth, database state)
├── utils/              # Shared helpers
└── playwright.config.ts
```

## Page Object Model

```typescript
// pages/login.page.ts
import { Page, Locator, expect } from "@playwright/test";

export class LoginPage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;

  constructor(private readonly page: Page) {
    this.emailInput = page.getByLabel("Email");
    this.passwordInput = page.getByLabel("Password");
    this.submitButton = page.getByRole("button", { name: "Sign in" });
  }

  async goto() { await this.page.goto("/login"); }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }
}
```

## Test Structure

```typescript
import { test, expect } from "@playwright/test";
import { LoginPage } from "../pages/login.page";

test.describe("Login", () => {
  test("logs in with valid credentials", async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login("user@example.com", "password123");
    await expect(page).toHaveURL("/dashboard");
  });

  test("shows error with wrong password", async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login("user@example.com", "wrong");
    await expect(page.getByRole("alert")).toContainText("Invalid credentials");
  });
});
```

## Locator Priority (use in this order)

1. `getByRole("button", { name: "Submit" })` — most resilient
2. `getByLabel("Email")` — for form fields
3. `getByText("Click here")` — for visible text
4. `getByTestId("submit-btn")` — when semantic locators aren't enough
5. `locator(".class")` — last resort

## Authentication Fixture

```typescript
// fixtures/auth.fixture.ts
import { test as base } from "@playwright/test";

export const test = base.extend({
  authenticatedPage: async ({ page }, use) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(process.env.TEST_USER_EMAIL!);
    await page.getByLabel("Password").fill(process.env.TEST_USER_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");
    await use(page);
  },
});
```

## Common Mistakes to Avoid

- ❌ `page.waitForTimeout(2000)` → use `waitForSelector` or `expect` assertions
- ❌ Hard-coded selectors (`.btn-primary`) → use semantic locators
- ❌ Tests that depend on each other → each test must be independent
- ❌ No cleanup after tests → use `test.afterEach` or fixtures
- ❌ Testing visual styling → test behavior and content, not CSS classes
